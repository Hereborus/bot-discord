/**
 * Discord Audio Level Bot
 * ========================
 * TOKEN SYSTEM : toutes les routes HTTP utilisent un token opaque (HMAC-SHA256 tronqué).
 * Le userId Discord ne quitte JAMAIS ce processus Node — ni dans les URLs, ni dans les
 * réponses JSON, ni dans les noms de fichiers sur disque.
 *
 * ENDPOINTS :
 *   GET  /levels                        → niveaux audio  (clés = tokens)
 *   GET  /status                        → état du bot
 *   GET  /bot-info                      → info bot connecté
 *   POST /bot-token                     → valider + sauvegarder le token Discord
 *   GET  /images/{token}/{state}/{file} → image uploadée
 *   GET  /frames/{token}                → frames par état
 *   GET  /user-config/{token}           → config audio d'un user
 *   POST /user-config/{token}           → sauvegarder config audio
 *   GET  /known-users                   → liste users (token + displayName)
 *   POST /upload                        → upload image (champ "token")
 *   POST /reorder                       → réordonner frames
 *   POST /delete-frame                  → supprimer une frame
 *
 * ENV : DISCORD_TOKEN, USER_HASH_SECRET (auto-généré), LEVELS_PORT (défaut 3000)
 */

import { Client, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, EndBehaviorType, getVoiceConnection } from "@discordjs/voice";
import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import prism from "prism-media";
import dotenv from "dotenv";
import fftPkg from "fft-js";

const { fft, util: fftUtil } = fftPkg;
const ROOT       = process.cwd();
const IMAGES_DIR = path.join(ROOT, "images");
const META_DIR   = path.join(ROOT, "meta");
const ENV_PATH   = path.join(ROOT, ".env");

// ════════════════════════════════════════════════════════════════
// .ENV — généré automatiquement au premier lancement si absent
// ════════════════════════════════════════════════════════════════
function readEnvFile()         { try { return fs.readFileSync(ENV_PATH,'utf-8'); } catch { return ''; } }
function writeEnvFile(content) { fs.writeFileSync(ENV_PATH, content, 'utf-8'); }

function ensureEnvKey(key, value) {
  let env = readEnvFile();
  if (new RegExp(`^${key}=`, 'm').test(env)) return; // déjà présent
  env += (env.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
  writeEnvFile(env);
  console.log(`✓ .env : ${key} généré`);
}

function setEnvKey(key, value) {
  let env = readEnvFile();
  if (new RegExp(`^${key}=`, 'm').test(env)) {
    env = env.replace(new RegExp(`^${key}=.*`, 'm'), `${key}=${value}`);
  } else {
    env += (env.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
  }
  writeEnvFile(env);
}

// Créer .env avec valeurs par défaut si absent
if (!fs.existsSync(ENV_PATH)) {
  writeEnvFile('# PNGTuber Bot — généré automatiquement\n# Ajoute DISCORD_TOKEN= après avoir configuré le bot via l\'UI\n');
  console.log('✓ .env créé');
}
ensureEnvKey('LEVELS_PORT', '3000');
ensureEnvKey('USER_HASH_SECRET', crypto.randomBytes(32).toString('hex'));

dotenv.config();

if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
if (!fs.existsSync(META_DIR))   fs.mkdirSync(META_DIR,   { recursive: true });

// ════════════════════════════════════════════════════════════════
// SYSTÈME DE TOKEN — userId Discord → token opaque 16 hex
// HMAC-SHA256(userId, SECRET) — non-réversible sans la clé secrète
// ════════════════════════════════════════════════════════════════
const HASH_SECRET = process.env.USER_HASH_SECRET;

// hash stable du userId — utilisé pour nommer les fichiers sur disque
function hashUid(userId) {
  return crypto.createHmac('sha256', HASH_SECRET).update(String(userId)).digest('hex').slice(0, 16);
}

// Maps en mémoire — le userId Discord ne sort jamais de ce processus
const tokenToUid = new Map(); // token → userId
const uidToToken = new Map(); // userId → token

function tokenFor(userId) {
  if (uidToToken.has(userId)) return uidToToken.get(userId);
  const token = hashUid(userId);
  tokenToUid.set(token, userId); uidToToken.set(userId, token);
  return token;
}
function uidFor(token) { return tokenToUid.get(token) || null; }

// ════════════════════════════════════════════════════════════════
// AUDIO CONFIG
// ════════════════════════════════════════════════════════════════
const AUDIO = {
  sampleRate: 48000, sampleInterval: 50, durationWindow: 200, fftSize: 1024,
  freqBands: { low:{min:20,max:500}, mid:{min:500,max:2000}, high:{min:2000,max:10000} },
};
const userLevels = new Map();
let botConnected=false, currentConnection=null, connectedGuildId=null, connectedChannelId=null;
let tokenRejected=false;
const PORT = process.env.LEVELS_PORT || 3000;

// ════════════════════════════════════════════════════════════════
// UTILITAIRES HTTP
// ════════════════════════════════════════════════════════════════
const MIME = {
  ".html":"text/html; charset=utf-8",".js":"application/javascript",".css":"text/css",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".gif":"image/gif",
  ".webp":"image/webp",".svg":"image/svg+xml",".ico":"image/x-icon",".json":"application/json",
};
const CORS = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
};
function serveFile(res, filePath) {
  if (!fs.existsSync(filePath)||!fs.statSync(filePath).isFile()) return false;
  res.writeHead(200,{"Content-Type":MIME[path.extname(filePath).toLowerCase()]||"application/octet-stream",...CORS});
  fs.createReadStream(filePath).pipe(res); return true;
}
function json(res, data, status=200) {
  res.writeHead(status,{"Content-Type":"application/json",...CORS}); res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((res,rej)=>{const c=[];req.on("data",d=>c.push(d));req.on("end",()=>res(Buffer.concat(c)));req.on("error",rej);});
}

// ════════════════════════════════════════════════════════════════
// FICHIERS — nommés par hash, jamais par userId
// ════════════════════════════════════════════════════════════════
function metaPath(userId)    { return path.join(META_DIR, `${hashUid(userId)}.json`); }
function configPath(userId)  { return path.join(META_DIR, `${hashUid(userId)}_config.json`); }
function readMeta(userId)    { try{return JSON.parse(fs.readFileSync(metaPath(userId),"utf-8"));}catch{return {};} }
function writeMeta(userId,m) { fs.writeFileSync(metaPath(userId),JSON.stringify(m,null,2)); }
function readCfg(userId)     { try{return JSON.parse(fs.readFileSync(configPath(userId),"utf-8"));}catch{return null;} }
function writeCfg(userId,c)  { fs.writeFileSync(configPath(userId),JSON.stringify(c,null,2)); }
function stateDir(userId,sk) { return path.join(IMAGES_DIR,hashUid(userId),sk); }

function getFrames(userId) {
  const token=tokenFor(userId), meta=readMeta(userId), result={};
  const dir=path.join(IMAGES_DIR,hashUid(userId));
  if (!fs.existsSync(dir)) return result;
  for (const state of fs.readdirSync(dir).filter(s=>fs.statSync(path.join(dir,s)).isDirectory())) {
    const order=meta[state]||[], sd=stateDir(userId,state);
    const existing=fs.readdirSync(sd).filter(f=>MIME[path.extname(f).toLowerCase()]);
    const ordered=order.filter(f=>existing.includes(f)), unordered=existing.filter(f=>!ordered.includes(f));
    result[state]=[...ordered,...unordered].map(f=>({file:f,url:`/images/${token}/${state}/${f}`}));
  }
  return result;
}

// ════════════════════════════════════════════════════════════════
// MULTIPART PARSER
// ════════════════════════════════════════════════════════════════
function indexOf(buf,search,start=0){for(let i=start;i<=buf.length-search.length;i++){let ok=true;for(let j=0;j<search.length;j++){if(buf[i+j]!==search[j]){ok=false;break;}}if(ok)return i;}return -1;}
function parseMultipart(body,boundary){
  const parts=[],sep=Buffer.from(`--${boundary}`);let offset=0;
  while(offset<body.length){
    const start=indexOf(body,sep,offset);if(start===-1)break;offset=start+sep.length;
    if(body[offset]===45&&body[offset+1]===45)break;if(body[offset]===13)offset+=2;
    const he=indexOf(body,Buffer.from("\r\n\r\n"),offset);if(he===-1)break;
    const hs=body.slice(offset,he).toString();offset=he+4;
    const ns=indexOf(body,sep,offset),de=ns===-1?body.length:ns-2,data=body.slice(offset,de);
    offset=ns===-1?body.length:ns;
    parts.push({name:hs.match(/name="([^"]+)"/)?.[1]||"",filename:hs.match(/filename="([^"]+)"/)?.[1]||"",contentType:hs.match(/Content-Type:\s*(.+)/i)?.[1]?.trim()||"",data});
  }
  return parts;
}

// ════════════════════════════════════════════════════════════════
// HTTP SERVER
// ════════════════════════════════════════════════════════════════
http.createServer(async (req,res)=>{
  const url=new URL(req.url,`http://localhost`);
  if (req.method==="OPTIONS"){res.writeHead(200,CORS);res.end();return;}

  // GET /levels — tokens opaques comme clés, aucun userId
  if (req.method==="GET"&&url.pathname==="/levels") {
    const p={_bot:{connected:botConnected,updatedAt:new Date().toISOString()}};
    for (const [uid,d] of userLevels) p[tokenFor(uid)]={db:d.db,rms:d.rms,freq:d.freq,speaking:d.speaking,displayName:d.displayName,updated:d.updated};
    return json(res,p);
  }

  // GET /status
  if (req.method==="GET"&&url.pathname==="/status") return json(res,{botConnected,usersActive:userLevels.size});

  // GET /bot-info
  if (req.method==="GET"&&url.pathname==="/bot-info") {
    const hasToken=!!process.env.DISCORD_TOKEN;
    return json(res,{configured:hasToken,connected:botConnected,tokenInvalid:hasToken&&!botConnected&&tokenRejected,tag:botConnected?client.user?.tag:null,id:botConnected?client.user?.id:null});
  }

  // POST /bot-token
  if (req.method==="POST"&&url.pathname==="/bot-token") {
    try {
      const {token}=JSON.parse((await readBody(req)).toString());
      if (!token||token.trim().length<50) return json(res,{ok:false,error:"Token trop court"},400);
      const vRes=await fetch("https://discord.com/api/v10/users/@me",{headers:{Authorization:`Bot ${token.trim()}`}});
      if (!vRes.ok){const e=await vRes.json().catch(()=>({}));return json(res,{ok:false,error:`Rejeté: ${e.message||vRes.status}`},401);}
      const botUser=await vRes.json();
      setEnvKey('DISCORD_TOKEN', token.trim());
      console.log(`Token mis à jour → redémarrage...`);
      setTimeout(()=>process.exit(0),500);
      return json(res,{ok:true,tag:botUser.username});
    } catch(err){return json(res,{ok:false,error:err.message},500);}
  }

  // GET /frames/:token
  if (req.method==="GET"&&url.pathname.startsWith("/frames/")) {
    const t=url.pathname.split("/")[2], uid=uidFor(t);
    if (!uid) return json(res,{error:"token inconnu"},404);
    return json(res,getFrames(uid));
  }

  // GET /images/:token/:state/:file
  if (req.method==="GET"&&url.pathname.startsWith("/images/")) {
    const parts=url.pathname.split("/");
    if (parts.length>=5) {
      const uid=uidFor(parts[2]);
      if (!uid){res.writeHead(404);res.end("Not found");return;}
      const fp=path.join(IMAGES_DIR,hashUid(uid),parts[3],parts.slice(4).join("/"));
      if (!fp.startsWith(IMAGES_DIR)){res.writeHead(403);res.end();return;}
      if (serveFile(res,fp)) return;
    }
    res.writeHead(404);res.end("Not found");return;
  }

  // GET /user-config/:token
  if (req.method==="GET"&&url.pathname.startsWith("/user-config/")) {
    const uid=uidFor(url.pathname.split("/")[2]);
    if (!uid) return json(res,{error:"token inconnu"},404);
    return json(res,readCfg(uid)||{});
  }

  // POST /user-config/:token
  if (req.method==="POST"&&url.pathname.startsWith("/user-config/")) {
    try {
      const uid=uidFor(url.pathname.split("/")[2]);
      if (!uid) return json(res,{error:"token inconnu"},404);
      writeCfg(uid,JSON.parse((await readBody(req)).toString()));
      return json(res,{ok:true});
    } catch(err){return json(res,{error:err.message},500);}
  }

  // GET /known-users — token + displayName uniquement
  if (req.method==="GET"&&url.pathname==="/known-users") {
    const users=[];
    // Users actifs en mémoire
    for (const [uid,token] of uidToToken) {
      const cfg=readCfg(uid);
      users.push({token,displayName:cfg?.displayName||'???',hasConfig:!!cfg});
    }
    // Users persistés sur disque (sessions précédentes)
    if (fs.existsSync(META_DIR)) {
      for (const f of fs.readdirSync(META_DIR)) {
        if (!f.endsWith('_config.json')) continue;
        const fileHash=f.replace('_config.json','');
        if (users.find(u=>hashUid(uidFor(u.token)||'')=== fileHash)) continue;
        try {
          const cfg=JSON.parse(fs.readFileSync(path.join(META_DIR,f),'utf-8'));
          if (cfg?.displayName) users.push({token:fileHash,displayName:cfg.displayName,hasConfig:true,offline:true});
        } catch {}
      }
    }
    return json(res,users);
  }

  // POST /upload — champ "token" au lieu de "userId"
  if (req.method==="POST"&&url.pathname==="/upload") {
    try {
      const body=await readBody(req),ct=req.headers["content-type"]||"",bm=ct.match(/boundary=([^\s;]+)/);
      if (!bm) return json(res,{error:"boundary manquant"},400);
      const parts=parseMultipart(body,bm[1]),fields={};
      for (const p of parts) if (!p.filename) fields[p.name]=p.data.toString();
      const imgPart=parts.find(p=>p.filename);
      const {token,stateKey}=fields, uid=uidFor(token);
      if (!uid||!stateKey||!imgPart) return json(res,{error:"token invalide, stateKey ou image manquant"},400);
      const ext=path.extname(imgPart.filename).toLowerCase();
      if (!MIME[ext]||!MIME[ext].startsWith("image/")) return json(res,{error:"Format non supporté"},400);
      const dir=stateDir(uid,stateKey);fs.mkdirSync(dir,{recursive:true});
      const fname=`${Date.now()}_${imgPart.filename.replace(/[^a-zA-Z0-9._-]/g,"_")}`;
      fs.writeFileSync(path.join(dir,fname),imgPart.data);
      const meta=readMeta(uid);if(!meta[stateKey])meta[stateKey]=[];meta[stateKey].push(fname);writeMeta(uid,meta);
      return json(res,{ok:true,file:fname,url:`/images/${token}/${stateKey}/${fname}`});
    } catch(err){return json(res,{error:err.message},500);}
  }

  // POST /reorder  { token, stateKey, order:[] }
  if (req.method==="POST"&&url.pathname==="/reorder") {
    try {
      const {token,stateKey,order}=JSON.parse((await readBody(req)).toString());
      const uid=uidFor(token);
      if (!uid||!stateKey||!Array.isArray(order)) return json(res,{error:"params manquants"},400);
      const meta=readMeta(uid);meta[stateKey]=order;writeMeta(uid,meta);
      return json(res,{ok:true});
    } catch(err){return json(res,{error:err.message},500);}
  }

  // POST /delete-frame  { token, stateKey, file }
  if (req.method==="POST"&&url.pathname==="/delete-frame") {
    try {
      const {token,stateKey,file}=JSON.parse((await readBody(req)).toString());
      const uid=uidFor(token);
      if (!uid||!stateKey||!file) return json(res,{error:"params manquants"},400);
      const fp=path.join(IMAGES_DIR,hashUid(uid),stateKey,file);
      if (!fp.startsWith(IMAGES_DIR)) return json(res,{error:"Interdit"},403);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      const meta=readMeta(uid);if(meta[stateKey])meta[stateKey]=meta[stateKey].filter(f=>f!==file);writeMeta(uid,meta);
      return json(res,{ok:true});
    } catch(err){return json(res,{error:err.message},500);}
  }

  // POST /delete-user/:token — supprimer toutes les données d'un user
  if (req.method==="POST" && url.pathname.startsWith("/delete-user/")) {
    const token = url.pathname.split("/")[2];
    const uid   = uidFor(token);
    if (!uid) return json(res,{error:"token inconnu"},404);
    try {
      // Supprimer dossier images
      const imgDir = path.join(IMAGES_DIR, hashUid(uid));
      if (fs.existsSync(imgDir)) fs.rmSync(imgDir, { recursive:true, force:true });
      // Supprimer meta et config
      [metaPath(uid), configPath(uid)].forEach(p => { try { fs.unlinkSync(p); } catch {} });
      // Retirer de la mémoire
      tokenToUid.delete(token);
      uidToToken.delete(uid);
      userLevels.delete(uid);
      console.log(`🗑 User supprimé: [token]`);
      return json(res,{ok:true});
    } catch(err) { return json(res,{error:err.message},500); }
  }

  // Fichiers statiques
  let pathname=url.pathname;
  if (pathname==="/"||pathname==="") pathname="/index.html";
  const fp=path.join(ROOT,pathname);
  if (!fp.startsWith(ROOT)){res.writeHead(403);res.end();return;}
  if (serveFile(res,fp)) return;
  res.writeHead(404);res.end("Not found");

}).listen(PORT,()=>{
  console.log(`✓ HTTP → http://localhost:${PORT}/`);
  console.log(`  ├─ Config UI : http://localhost:${PORT}/index.html`);
  console.log(`  └─ API data  : http://localhost:${PORT}/levels`);
});

// ════════════════════════════════════════════════════════════════
// FFT
// ════════════════════════════════════════════════════════════════
function computeFreqBands(buffer){
  if(buffer.length<AUDIO.fftSize)return{low:0,mid:0,high:0};
  try{
    const mags=fftUtil.fftMag(fft(buffer.slice(0,AUDIO.fftSize))),binHz=AUDIO.sampleRate/AUDIO.fftSize,result={};
    for(const[name,band]of Object.entries(AUDIO.freqBands)){let sum=0,count=0;for(let i=Math.floor(band.min/binHz);i<=Math.ceil(band.max/binHz)&&i<mags.length;i++){sum+=mags[i];count++;}result[name]=count?Math.round((sum/count)*1000)/1000:0;}
    return result;
  }catch{return{low:0,mid:0,high:0};}
}

// ════════════════════════════════════════════════════════════════
// AUDIO SUBSCRIPTION
// ════════════════════════════════════════════════════════════════
function subscribeUser(receiver,userId,displayName){
  try{
    const opusStream=receiver.subscribe(userId,{end:{behavior:EndBehaviorType.AfterSilence,duration:150}});
    const decoder=new prism.opus.Decoder({frameSize:960,channels:2,rate:AUDIO.sampleRate});
    opusStream.pipe(decoder);
    let sumSq=0,sampleCount=0;const history=[],freqBuf=[];
    const tick=setInterval(()=>{
      if(!sampleCount)return;
      const rms=Math.sqrt(sumSq/sampleCount)/32768,db=rms>0?20*Math.log10(rms):-100,now=Date.now();
      history.push({db,t:now});while(history.length&&now-history[0].t>AUDIO.durationWindow)history.shift();
      const avgDb=history.reduce((a,v)=>a+v.db,0)/history.length;
      userLevels.set(userId,{db:Math.round(avgDb*100)/100,rms:Math.round(rms*10000)/10000,freq:computeFreqBands(freqBuf),speaking:true,displayName,updated:now});
      sumSq=0;sampleCount=0;
    },AUDIO.sampleInterval);
    decoder.on("data",chunk=>{for(let i=0;i<chunk.length;i+=2){const s=chunk.readInt16LE(i);sumSq+=s*s;sampleCount++;freqBuf.push(s/32768);if(freqBuf.length>AUDIO.fftSize*2)freqBuf.shift();}});
    const cleanup=()=>{clearInterval(tick);try{opusStream.destroy();}catch(_){};try{decoder.destroy();}catch(_){};const prev=userLevels.get(userId)||{};userLevels.set(userId,{...prev,db:-100,rms:0,freq:{low:0,mid:0,high:0},speaking:false,updated:Date.now()});};
    opusStream.on("end",cleanup);opusStream.on("close",cleanup);decoder.on("end",cleanup);
    opusStream.on("error",err=>{if(err?.message?.includes("DecryptionFailed")||err?.code==="GenericFailure")return;console.error(`opusStream error:`,err);});
    decoder.on("error",err=>console.error(`decoder error:`,err));
  }catch(err){console.error(`Audio error:`,err);}
}

// ════════════════════════════════════════════════════════════════
// DISCORD CLIENT
// ════════════════════════════════════════════════════════════════
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildVoiceStates]});
client.once("clientReady",()=>{botConnected=true;tokenRejected=false;console.log(`✓ Bot ready — ${client.user.tag}`);});
client.on("error",err=>{if(err?.message?.includes("TOKEN_INVALID")||err?.code===4004){tokenRejected=true;console.error("❌ Token Discord invalide");}});

client.on("messageCreate",async message=>{
  if (message.author.bot) return;

  if (message.content==="!join") {
    const channel=message.member?.voice.channel;
    if (!channel) return message.reply("❌ Tu dois être dans un canal vocal.");
    try {
      const connection=joinVoiceChannel({channelId:channel.id,guildId:channel.guild.id,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:false});
      currentConnection=connection;connectedGuildId=channel.guild.id;connectedChannelId=channel.id;
      console.log(`📍 Joined: ${channel.guild.name} / ${channel.name}`);
      const receiver=connection.receiver;
      receiver.speaking.on("start",userId=>{
        const member=channel.guild.members.cache.get(userId);
        const displayName=member?.displayName||member?.user?.username||'???';
        console.log(`🔊 ${displayName}`);
        tokenFor(userId); // enregistrer le token en mémoire
        const existing=readCfg(userId)||{};
        if (existing.displayName!==displayName) writeCfg(userId,{...existing,displayName});
        subscribeUser(receiver,userId,displayName);
      });
      receiver.speaking.on("end",userId=>{
        const prev=userLevels.get(userId)||{};
        userLevels.set(userId,{...prev,db:-100,rms:0,freq:{low:0,mid:0,high:0},speaking:false,updated:Date.now()});
      });
      // URLs viewer avec TOKEN opaque — jamais l'userId Discord
      const members=channel.members.filter(m=>!m.user.bot);
      const links=members.map(m=>{
        const t=tokenFor(m.id);
        return `  • **${m.displayName||m.user?.username||'???'}** → http://localhost:${PORT}/viewer.html?t=${t}`;
      }).join("\n");
      return message.reply(
        `✅ Connecté à **${channel.name}** !\n\n` +
        `⚙️ Config UI : http://localhost:${PORT}/index.html\n\n` +
        `🎬 Viewers OBS :\n${links||"  (aucun membre)"}`
      );
    } catch(err){console.error("Join error:",err);return message.reply("❌ Impossible de rejoindre le canal.");}
  }

  if (message.content==="!disconnect") {
    if (!currentConnection) return message.reply("❌ Pas connecté.");
    currentConnection.destroy();currentConnection=null;connectedGuildId=null;connectedChannelId=null;userLevels.clear();
    return message.reply("👋 Déconnecté.");
  }

  if (message.content==="!status") {
    const lines=[...userLevels.entries()].map(([,v])=>`  • **${v.displayName||'???'}** — ${v.db} dB ${v.speaking?"🎙":"🔇"}`).join("\n")||"  (aucun)";
    return message.reply(`**Bot** Discord:${botConnected?"✅":"❌"} Voice:${connectedGuildId?"✅":"❌"}\n${lines}`);
  }
});

client.on("voiceStateUpdate",oldState=>{
  const guild=oldState.guild;if(!guild)return;
  const connection=getVoiceConnection(guild.id);if(!connection)return;
  const channel=guild.channels.cache.get(connection.joinConfig.channelId);if(!channel)return;
  if(channel.members.filter(m=>!m.user.bot).size>0)return;
  setTimeout(()=>{
    const ch=guild.channels.cache.get(connection.joinConfig.channelId);
    if(ch?.members.filter(m=>!m.user.bot).size===0){
      connection.destroy();currentConnection=null;connectedGuildId=null;connectedChannelId=null;userLevels.clear();
      console.log("🔇 Seul → déconnexion auto");
    }
  },5000);
});

if (!process.env.DISCORD_TOKEN) {
  console.warn("⚠ DISCORD_TOKEN absent — configure-le via http://localhost:"+PORT+"/index.html");
} else {
  client.login(process.env.DISCORD_TOKEN).catch(err=>{tokenRejected=true;console.error("❌ Login échoué:",err.message);});
}
console.log("✓ Bot initialized");
