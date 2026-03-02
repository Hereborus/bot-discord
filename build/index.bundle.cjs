var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var import_discord = require("discord.js");
var import_voice = require("@discordjs/voice");
var import_http = __toESM(require("http"), 1);
var import_fs = __toESM(require("fs"), 1);
var import_path = __toESM(require("path"), 1);
var import_crypto = __toESM(require("crypto"), 1);
var import_os = __toESM(require("os"), 1);
var import_prism_media = __toESM(require("prism-media"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_fft_js = __toESM(require("fft-js"), 1);
var import_child_process = require("child_process");
const { fft, util: fftUtil } = import_fft_js.default;
const IS_PACKAGED = Boolean(process.pkg);
const SOURCE_ROOT = process.cwd();
const STATIC_ROOT = IS_PACKAGED ? import_path.default.dirname(process.execPath) : SOURCE_ROOT;
const DATA_ROOT = IS_PACKAGED ? import_path.default.join(process.env.APPDATA || import_os.default.homedir(), "PNGTuberBot") : SOURCE_ROOT;
const IMAGES_DIR = import_path.default.join(DATA_ROOT, "images");
const META_DIR = import_path.default.join(DATA_ROOT, "meta");
const ENV_PATH = import_path.default.join(DATA_ROOT, ".env");
if (!import_fs.default.existsSync(DATA_ROOT)) import_fs.default.mkdirSync(DATA_ROOT, { recursive: true });
if (!import_fs.default.existsSync(IMAGES_DIR)) import_fs.default.mkdirSync(IMAGES_DIR, { recursive: true });
if (!import_fs.default.existsSync(META_DIR)) import_fs.default.mkdirSync(META_DIR, { recursive: true });
function readEnvFile() {
  try {
    return import_fs.default.readFileSync(ENV_PATH, "utf-8");
  } catch {
    return "";
  }
}
function writeEnvFile(content) {
  import_fs.default.writeFileSync(ENV_PATH, content, "utf-8");
}
function ensureEnvKey(key, value) {
  let env = readEnvFile();
  if (new RegExp(`^${key}=`, "m").test(env)) return;
  env += (env.endsWith("\n") ? "" : "\n") + `${key}=${value}
`;
  writeEnvFile(env);
  console.log(`\u2713 .env : ${key} g\xE9n\xE9r\xE9`);
}
function setEnvKey(key, value) {
  let env = readEnvFile();
  if (new RegExp(`^${key}=`, "m").test(env)) {
    env = env.replace(new RegExp(`^${key}=.*`, "m"), `${key}=${value}`);
  } else {
    env += (env.endsWith("\n") ? "" : "\n") + `${key}=${value}
`;
  }
  writeEnvFile(env);
}
if (!import_fs.default.existsSync(ENV_PATH)) {
  writeEnvFile(
    "# PNGTuber Bot \u2014 g\xE9n\xE9r\xE9 automatiquement\n# Ajoute DISCORD_TOKEN= apr\xE8s avoir configur\xE9 le bot via l'UI\n"
  );
  console.log("\u2713 .env cr\xE9\xE9");
}
ensureEnvKey("LEVELS_PORT", "3000");
ensureEnvKey("USER_HASH_SECRET", import_crypto.default.randomBytes(32).toString("hex"));
import_dotenv.default.config();
const HASH_SECRET = process.env.USER_HASH_SECRET;
function hashUid(userId) {
  return import_crypto.default.createHmac("sha256", HASH_SECRET).update(String(userId)).digest("hex").slice(0, 16);
}
const tokenToUid = /* @__PURE__ */ new Map();
const uidToToken = /* @__PURE__ */ new Map();
function tokenFor(userId) {
  if (uidToToken.has(userId)) return uidToToken.get(userId);
  const token = hashUid(userId);
  tokenToUid.set(token, userId);
  uidToToken.set(userId, token);
  return token;
}
function uidFor(token) {
  return tokenToUid.get(token) || null;
}
const AUDIO = {
  sampleRate: 48e3,
  sampleInterval: 50,
  durationWindow: 200,
  fftSize: 1024,
  freqBands: {
    low: { min: 20, max: 500 },
    mid: { min: 500, max: 2e3 },
    high: { min: 2e3, max: 1e4 }
  }
};
const userLevels = /* @__PURE__ */ new Map();
let botConnected = false, currentConnection = null, connectedGuildId = null, connectedChannelId = null;
let tokenRejected = false;
const PORT = process.env.LEVELS_PORT || 3e3;
let httpServer = null;
let isShuttingDown = false;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json"
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
function serveFile(res, filePath) {
  if (!import_fs.default.existsSync(filePath) || !import_fs.default.statSync(filePath).isFile())
    return false;
  res.writeHead(200, {
    "Content-Type": MIME[import_path.default.extname(filePath).toLowerCase()] || "application/octet-stream",
    ...CORS
  });
  import_fs.default.createReadStream(filePath).pipe(res);
  return true;
}
function json(res, data, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((res, rej) => {
    const c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => res(Buffer.concat(c)));
    req.on("error", rej);
  });
}
function openDefaultBrowser(url) {
  if (process.env.PNGTUBER_NO_BROWSER === "1") return;
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  (0, import_child_process.exec)(cmd, (err) => {
    if (err)
      console.warn(
        `\u26A0 Impossible d'ouvrir automatiquement le navigateur: ${err.message}`
      );
  });
}
function metaPath(userId) {
  return import_path.default.join(META_DIR, `${hashUid(userId)}.json`);
}
function configPath(userId) {
  return import_path.default.join(META_DIR, `${hashUid(userId)}_config.json`);
}
function readMeta(userId) {
  try {
    return JSON.parse(import_fs.default.readFileSync(metaPath(userId), "utf-8"));
  } catch {
    return {};
  }
}
function writeMeta(userId, m) {
  import_fs.default.writeFileSync(metaPath(userId), JSON.stringify(m, null, 2));
}
function readCfg(userId) {
  try {
    return JSON.parse(import_fs.default.readFileSync(configPath(userId), "utf-8"));
  } catch {
    return null;
  }
}
function writeCfg(userId, c) {
  import_fs.default.writeFileSync(configPath(userId), JSON.stringify(c, null, 2));
}
function stateDir(userId, sk) {
  return import_path.default.join(IMAGES_DIR, hashUid(userId), sk);
}
function getFrames(userId) {
  const token = tokenFor(userId), meta = readMeta(userId), result = {};
  const dir = import_path.default.join(IMAGES_DIR, hashUid(userId));
  if (!import_fs.default.existsSync(dir)) return result;
  for (const state of import_fs.default.readdirSync(dir).filter((s) => import_fs.default.statSync(import_path.default.join(dir, s)).isDirectory())) {
    const order = meta[state] || [], sd = stateDir(userId, state);
    const existing = import_fs.default.readdirSync(sd).filter((f) => MIME[import_path.default.extname(f).toLowerCase()]);
    const ordered = order.filter((f) => existing.includes(f)), unordered = existing.filter((f) => !ordered.includes(f));
    result[state] = [...ordered, ...unordered].map((f) => ({
      file: f,
      url: `/images/${token}/${state}/${f}`
    }));
  }
  return result;
}
function indexOf(buf, search, start = 0) {
  for (let i = start; i <= buf.length - search.length; i++) {
    let ok = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}
function parseMultipart(body, boundary) {
  const parts = [], sep = Buffer.from(`--${boundary}`);
  let offset = 0;
  while (offset < body.length) {
    const start = indexOf(body, sep, offset);
    if (start === -1) break;
    offset = start + sep.length;
    if (body[offset] === 45 && body[offset + 1] === 45) break;
    if (body[offset] === 13) offset += 2;
    const he = indexOf(body, Buffer.from("\r\n\r\n"), offset);
    if (he === -1) break;
    const hs = body.slice(offset, he).toString();
    offset = he + 4;
    const ns = indexOf(body, sep, offset), de = ns === -1 ? body.length : ns - 2, data = body.slice(offset, de);
    offset = ns === -1 ? body.length : ns;
    parts.push({
      name: hs.match(/name="([^"]+)"/)?.[1] || "",
      filename: hs.match(/filename="([^"]+)"/)?.[1] || "",
      contentType: hs.match(/Content-Type:\s*(.+)/i)?.[1]?.trim() || "",
      data
    });
  }
  return parts;
}
function shutdownApp() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("\n\u{1F6D1} Fermeture de l'application...");
  if (currentConnection) {
    currentConnection.destroy();
    currentConnection = null;
  }
  connectedGuildId = null;
  connectedChannelId = null;
  userLevels.clear();
  if (httpServer) {
    httpServer.close(() => {
      console.log("\u2713 Serveur HTTP ferm\xE9");
      console.log("\u2713 Port lib\xE9r\xE9");
      process.exit(0);
    });
    setTimeout(() => {
      console.log("\u26A0 Fermeture forc\xE9e");
      process.exit(0);
    }, 2e3);
  } else {
    process.exit(0);
  }
}
httpServer = import_http.default.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  if (req.method === "OPTIONS") {
    res.writeHead(200, CORS);
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/levels") {
    const p = {
      _bot: {
        connected: botConnected,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    };
    for (const [uid, d] of userLevels)
      p[tokenFor(uid)] = {
        db: d.db,
        rms: d.rms,
        freq: d.freq,
        speaking: d.speaking,
        displayName: d.displayName,
        updated: d.updated
      };
    return json(res, p);
  }
  if (req.method === "GET" && url.pathname === "/status")
    return json(res, { botConnected, usersActive: userLevels.size });
  if (req.method === "GET" && url.pathname === "/bot-info") {
    const hasToken = !!process.env.DISCORD_TOKEN;
    return json(res, {
      configured: hasToken,
      connected: botConnected,
      tokenInvalid: hasToken && !botConnected && tokenRejected,
      tag: botConnected ? client.user?.tag : null,
      id: botConnected ? client.user?.id : null
    });
  }
  if (req.method === "POST" && url.pathname === "/bot-token") {
    try {
      const { token } = JSON.parse((await readBody(req)).toString());
      if (!token || token.trim().length < 50)
        return json(
          res,
          { ok: false, error: "Token trop court" },
          400
        );
      const vRes = await fetch(
        "https://discord.com/api/v10/users/@me",
        {
          headers: { Authorization: `Bot ${token.trim()}` }
        }
      );
      if (!vRes.ok) {
        const e = await vRes.json().catch(() => ({}));
        return json(
          res,
          {
            ok: false,
            error: `Rejet\xE9: ${e.message || vRes.status}`
          },
          401
        );
      }
      const botUser = await vRes.json();
      setEnvKey("DISCORD_TOKEN", token.trim());
      console.log(`Token mis \xE0 jour \u2192 red\xE9marrage...`);
      setTimeout(() => process.exit(0), 500);
      return json(res, { ok: true, tag: botUser.username });
    } catch (err) {
      return json(res, { ok: false, error: err.message }, 500);
    }
  }
  if (req.method === "GET" && url.pathname.startsWith("/frames/")) {
    const t = url.pathname.split("/")[2], uid = uidFor(t);
    if (!uid) return json(res, { error: "token inconnu" }, 404);
    return json(res, getFrames(uid));
  }
  if (req.method === "GET" && url.pathname.startsWith("/images/")) {
    const parts = url.pathname.split("/");
    if (parts.length >= 5) {
      const uid = uidFor(parts[2]);
      if (!uid) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const fp2 = import_path.default.join(
        IMAGES_DIR,
        hashUid(uid),
        parts[3],
        parts.slice(4).join("/")
      );
      if (!fp2.startsWith(IMAGES_DIR)) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (serveFile(res, fp2)) return;
    }
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/user-config/")) {
    const uid = uidFor(url.pathname.split("/")[2]);
    if (!uid) return json(res, { error: "token inconnu" }, 404);
    return json(res, readCfg(uid) || {});
  }
  if (req.method === "POST" && url.pathname.startsWith("/user-config/")) {
    try {
      const uid = uidFor(url.pathname.split("/")[2]);
      if (!uid) return json(res, { error: "token inconnu" }, 404);
      writeCfg(uid, JSON.parse((await readBody(req)).toString()));
      return json(res, { ok: true });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }
  if (req.method === "GET" && url.pathname === "/known-users") {
    const users = [];
    for (const [uid, token] of uidToToken) {
      const cfg = readCfg(uid);
      users.push({
        token,
        displayName: cfg?.displayName || "???",
        hasConfig: !!cfg
      });
    }
    if (import_fs.default.existsSync(META_DIR)) {
      for (const f of import_fs.default.readdirSync(META_DIR)) {
        if (!f.endsWith("_config.json")) continue;
        const fileHash = f.replace("_config.json", "");
        if (users.find((u) => u.token === fileHash)) continue;
        try {
          const cfg = JSON.parse(
            import_fs.default.readFileSync(import_path.default.join(META_DIR, f), "utf-8")
          );
          if (cfg?.displayName)
            users.push({
              token: fileHash,
              displayName: cfg.displayName,
              hasConfig: true,
              offline: true
            });
        } catch {
        }
      }
    }
    return json(res, users);
  }
  if (req.method === "POST" && url.pathname === "/upload") {
    try {
      const body = await readBody(req), ct = req.headers["content-type"] || "", bm = ct.match(/boundary=([^\s;]+)/);
      if (!bm) return json(res, { error: "boundary manquant" }, 400);
      const parts = parseMultipart(body, bm[1]), fields = {};
      for (const p of parts)
        if (!p.filename) fields[p.name] = p.data.toString();
      const imgPart = parts.find((p) => p.filename);
      const { token, stateKey } = fields, uid = uidFor(token);
      if (!uid || !stateKey || !imgPart)
        return json(
          res,
          { error: "token invalide, stateKey ou image manquant" },
          400
        );
      const ext = import_path.default.extname(imgPart.filename).toLowerCase();
      if (!MIME[ext] || !MIME[ext].startsWith("image/"))
        return json(res, { error: "Format non support\xE9" }, 400);
      const dir = stateDir(uid, stateKey);
      import_fs.default.mkdirSync(dir, { recursive: true });
      const fname = `${Date.now()}_${imgPart.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      import_fs.default.writeFileSync(import_path.default.join(dir, fname), imgPart.data);
      const meta = readMeta(uid);
      if (!meta[stateKey]) meta[stateKey] = [];
      meta[stateKey].push(fname);
      writeMeta(uid, meta);
      return json(res, {
        ok: true,
        file: fname,
        url: `/images/${token}/${stateKey}/${fname}`
      });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }
  if (req.method === "POST" && url.pathname === "/reorder") {
    try {
      const { token, stateKey, order } = JSON.parse(
        (await readBody(req)).toString()
      );
      const uid = uidFor(token);
      if (!uid || !stateKey || !Array.isArray(order))
        return json(res, { error: "params manquants" }, 400);
      const meta = readMeta(uid);
      meta[stateKey] = order;
      writeMeta(uid, meta);
      return json(res, { ok: true });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }
  if (req.method === "POST" && url.pathname === "/delete-frame") {
    try {
      const { token, stateKey, file } = JSON.parse(
        (await readBody(req)).toString()
      );
      const uid = uidFor(token);
      if (!uid || !stateKey || !file)
        return json(res, { error: "params manquants" }, 400);
      const fp2 = import_path.default.join(IMAGES_DIR, hashUid(uid), stateKey, file);
      if (!fp2.startsWith(IMAGES_DIR))
        return json(res, { error: "Interdit" }, 403);
      if (import_fs.default.existsSync(fp2)) import_fs.default.unlinkSync(fp2);
      const meta = readMeta(uid);
      if (meta[stateKey])
        meta[stateKey] = meta[stateKey].filter((f) => f !== file);
      writeMeta(uid, meta);
      return json(res, { ok: true });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }
  if (req.method === "POST" && url.pathname.startsWith("/delete-user/")) {
    const token = url.pathname.split("/")[2];
    const uid = uidFor(token);
    if (!uid) return json(res, { error: "token inconnu" }, 404);
    try {
      const imgDir = import_path.default.join(IMAGES_DIR, hashUid(uid));
      if (import_fs.default.existsSync(imgDir))
        import_fs.default.rmSync(imgDir, { recursive: true, force: true });
      [metaPath(uid), configPath(uid)].forEach((p) => {
        try {
          import_fs.default.unlinkSync(p);
        } catch {
        }
      });
      tokenToUid.delete(token);
      uidToToken.delete(uid);
      userLevels.delete(uid);
      console.log(`\u{1F5D1} User supprim\xE9: [token]`);
      return json(res, { ok: true });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }
  let pathname = url.pathname;
  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const fp = import_path.default.join(STATIC_ROOT, pathname);
  if (!fp.startsWith(STATIC_ROOT)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (serveFile(res, fp)) return;
  const bundled = import_path.default.join(SOURCE_ROOT, pathname);
  if (bundled.startsWith(SOURCE_ROOT) && serveFile(res, bundled)) return;
  res.writeHead(404);
  res.end("Not found");
}).listen(PORT, () => {
  console.log(`\u2713 HTTP \u2192 http://localhost:${PORT}/`);
  console.log(`  \u251C\u2500 Config UI : http://localhost:${PORT}/index.html`);
  console.log(`  \u2514\u2500 API data  : http://localhost:${PORT}/levels`);
  if (IS_PACKAGED) {
    console.log(`  \u2514\u2500 Donn\xE9es utilisateur : ${DATA_ROOT}`);
  }
  openDefaultBrowser(`http://localhost:${PORT}/index.html`);
});
function computeFreqBands(buffer) {
  if (buffer.length < AUDIO.fftSize) return { low: 0, mid: 0, high: 0 };
  try {
    const mags = fftUtil.fftMag(fft(buffer.slice(0, AUDIO.fftSize))), binHz = AUDIO.sampleRate / AUDIO.fftSize, result = {};
    for (const [name, band] of Object.entries(AUDIO.freqBands)) {
      let sum = 0, count = 0;
      for (let i = Math.floor(band.min / binHz); i <= Math.ceil(band.max / binHz) && i < mags.length; i++) {
        sum += mags[i];
        count++;
      }
      result[name] = count ? Math.round(sum / count * 1e3) / 1e3 : 0;
    }
    return result;
  } catch {
    return { low: 0, mid: 0, high: 0 };
  }
}
function subscribeUser(receiver, userId, displayName) {
  try {
    const opusStream = receiver.subscribe(userId, {
      end: { behavior: import_voice.EndBehaviorType.AfterSilence, duration: 150 }
    });
    const decoder = new import_prism_media.default.opus.Decoder({
      frameSize: 960,
      channels: 2,
      rate: AUDIO.sampleRate
    });
    opusStream.pipe(decoder);
    let sumSq = 0, sampleCount = 0;
    const history = [], freqBuf = [];
    const tick = setInterval(() => {
      if (!sampleCount) return;
      const rms = Math.sqrt(sumSq / sampleCount) / 32768, db = rms > 0 ? 20 * Math.log10(rms) : -100, now = Date.now();
      history.push({ db, t: now });
      while (history.length && now - history[0].t > AUDIO.durationWindow)
        history.shift();
      const avgDb = history.reduce((a, v) => a + v.db, 0) / history.length;
      userLevels.set(userId, {
        db: Math.round(avgDb * 100) / 100,
        rms: Math.round(rms * 1e4) / 1e4,
        freq: computeFreqBands(freqBuf),
        speaking: true,
        displayName,
        updated: now
      });
      sumSq = 0;
      sampleCount = 0;
    }, AUDIO.sampleInterval);
    decoder.on("data", (chunk) => {
      for (let i = 0; i < chunk.length; i += 2) {
        const s = chunk.readInt16LE(i);
        sumSq += s * s;
        sampleCount++;
        freqBuf.push(s / 32768);
        if (freqBuf.length > AUDIO.fftSize * 2) freqBuf.shift();
      }
    });
    const cleanup = () => {
      clearInterval(tick);
      try {
        opusStream.destroy();
      } catch (_) {
      }
      try {
        decoder.destroy();
      } catch (_) {
      }
      const prev = userLevels.get(userId) || {};
      userLevels.set(userId, {
        ...prev,
        db: -100,
        rms: 0,
        freq: { low: 0, mid: 0, high: 0 },
        speaking: false,
        updated: Date.now()
      });
    };
    opusStream.on("end", cleanup);
    opusStream.on("close", cleanup);
    decoder.on("end", cleanup);
    opusStream.on("error", (err) => {
      if (err?.message?.includes("DecryptionFailed") || err?.code === "GenericFailure")
        return;
      console.error(`opusStream error:`, err);
    });
    decoder.on("error", (err) => console.error(`decoder error:`, err));
  } catch (err) {
    console.error(`Audio error:`, err);
  }
}
const client = new import_discord.Client({
  intents: [
    import_discord.GatewayIntentBits.Guilds,
    import_discord.GatewayIntentBits.GuildMessages,
    import_discord.GatewayIntentBits.MessageContent,
    import_discord.GatewayIntentBits.GuildVoiceStates
  ]
});
client.once("clientReady", () => {
  botConnected = true;
  tokenRejected = false;
  console.log(`\u2713 Bot ready \u2014 ${client.user.tag}`);
});
client.on("error", (err) => {
  if (err?.message?.includes("TOKEN_INVALID") || err?.code === 4004) {
    tokenRejected = true;
    console.error("\u274C Token Discord invalide");
  }
});
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content === "!join") {
    const channel = message.member?.voice.channel;
    if (!channel)
      return message.reply("\u274C Tu dois \xEAtre dans un canal vocal.");
    try {
      const connection = (0, import_voice.joinVoiceChannel)({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false
      });
      currentConnection = connection;
      connectedGuildId = channel.guild.id;
      connectedChannelId = channel.id;
      console.log(`\u{1F4CD} Joined: ${channel.guild.name} / ${channel.name}`);
      const receiver = connection.receiver;
      receiver.speaking.on("start", (userId) => {
        const member = channel.guild.members.cache.get(userId);
        const displayName = member?.displayName || member?.user?.username || "???";
        console.log(`\u{1F50A} ${displayName}`);
        tokenFor(userId);
        const existing = readCfg(userId) || {};
        if (existing.displayName !== displayName)
          writeCfg(userId, { ...existing, displayName });
        subscribeUser(receiver, userId, displayName);
      });
      receiver.speaking.on("end", (userId) => {
        const prev = userLevels.get(userId) || {};
        userLevels.set(userId, {
          ...prev,
          db: -100,
          rms: 0,
          freq: { low: 0, mid: 0, high: 0 },
          speaking: false,
          updated: Date.now()
        });
      });
      const members = channel.members.filter((m) => !m.user.bot);
      const links = members.map((m) => {
        const t = tokenFor(m.id);
        return `  \u2022 **${m.displayName || m.user?.username || "???"}** \u2192 http://localhost:${PORT}/viewer.html?t=${t}`;
      }).join("\n");
      return message.reply(
        `\u2705 Connect\xE9 \xE0 **${channel.name}** !

\u2699\uFE0F Config UI : http://localhost:${PORT}/index.html

\u{1F3AC} Viewers OBS :
${links || "  (aucun membre)"}`
      );
    } catch (err) {
      console.error("Join error:", err);
      return message.reply("\u274C Impossible de rejoindre le canal.");
    }
  }
  if (message.content === "!disconnect") {
    if (!currentConnection) return message.reply("\u274C Pas connect\xE9.");
    message.reply("\u{1F44B} D\xE9connect\xE9. Fermeture de l'application...").then(() => {
      shutdownApp();
    });
    return;
  }
  if (message.content === "!status") {
    const lines = [...userLevels.entries()].map(
      ([, v]) => `  \u2022 **${v.displayName || "???"}** \u2014 ${v.db} dB ${v.speaking ? "\u{1F399}" : "\u{1F507}"}`
    ).join("\n") || "  (aucun)";
    return message.reply(
      `**Bot** Discord:${botConnected ? "\u2705" : "\u274C"} Voice:${connectedGuildId ? "\u2705" : "\u274C"}
${lines}`
    );
  }
});
client.on("voiceStateUpdate", (oldState) => {
  const guild = oldState.guild;
  if (!guild) return;
  const connection = (0, import_voice.getVoiceConnection)(guild.id);
  if (!connection) return;
  const channel = guild.channels.cache.get(connection.joinConfig.channelId);
  if (!channel) return;
  if (channel.members.filter((m) => !m.user.bot).size > 0) return;
  setTimeout(() => {
    const ch = guild.channels.cache.get(connection.joinConfig.channelId);
    if (ch?.members.filter((m) => !m.user.bot).size === 0) {
      console.log("\u{1F507} Seul \u2192 d\xE9connexion auto et fermeture");
      shutdownApp();
    }
  }, 5e3);
});
if (!process.env.DISCORD_TOKEN) {
  console.warn(
    "\u26A0 DISCORD_TOKEN absent \u2014 configure-le via http://localhost:" + PORT + "/index.html"
  );
} else {
  client.login(process.env.DISCORD_TOKEN).catch((err) => {
    tokenRejected = true;
    console.error("\u274C Login \xE9chou\xE9:", err.message);
  });
}
console.log("\u2713 Bot initialized");
