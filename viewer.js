// viewer.js — ES module autonome pour le viewer OBS PNGTuber
// Extrait de viewer.html pour une meilleure séparation des responsabilités.
// Vanilla JS, aucune dépendance npm.

(async () => {

    // ── Config depuis query params ──────────────────────────────────────────
    const params = new URLSearchParams(location.search);
    let FILTER_UID = params.get("t") || params.get("userId") || null;
    const GUILD_ID = params.get("guild") || null;
    const SESSION_ID = params.get("s") || null;
    const SOURCE_URL =
        params.get("sourceUrl") || `${location.origin}/levels`;
    const API_BASE = SOURCE_URL.replace("/levels", "");
    const POLL_MS = Math.max(
        50,
        parseInt(params.get("poll") || "100", 10),
    );
    const AVATAR_SIZE = params.get("size") || "200px";

    // Si session sécurisée (?s=), résoudre le token utilisateur via l'API
    if (SESSION_ID && !FILTER_UID) {
        try {
            const r = await fetch(`${API_BASE}/api/viewer-session/${SESSION_ID}`);
            if (r.ok) {
                const data = await r.json();
                FILTER_UID = data.userToken;
            } else {
                document.body.innerHTML = '<div style="color:#e74c6c;padding:2rem;font-family:sans-serif;text-align:center;"><h2>Session expirée ou invalide</h2><p>Génère une nouvelle URL depuis le panneau admin.</p></div>';
                return;
            }
        } catch (e) {
            document.body.innerHTML = '<div style="color:#e74c6c;padding:2rem;font-family:sans-serif;text-align:center;"><h2>Erreur de connexion</h2><p>' + e.message + '</p></div>';
            return;
        }
    }

    // Appliquer la taille d'avatar via variable CSS
    document.documentElement.style.setProperty(
        "--avatar-size",
        AVATAR_SIZE,
    );
    // Mode single-user : l'avatar remplit 100% de la fenêtre OBS
    if (FILTER_UID) {
        document.getElementById("stage").classList.add("single-user");
    }
    // Le viewer supporte 3 modes:
    // 1) global: tous les users renvoyés par /levels
    // 2) filtré par token: ?t=<userToken>
    // 3) session sécurisée: ?s=<sessionId> → résolu au chargement


    // ── Audio states & fallback chain ──────────────────────────────────────

    function getAudioStates() {
        return [
            "silent",
            ...[...audioConfig.thresholds]
                .sort((a, b) => a.db - b.db)
                .map((t) => t.key),
        ];
    }

    function getFallbackChain() {
        // Fallback descendant: si un état n'a pas de frame, on redescend vers un état inférieur.
        // Exemple: high -> medium -> low -> silent.
        const s = [...audioConfig.thresholds]
            .sort((a, b) => a.db - b.db)
            .map((t) => t.key);
        const c = { silent: null };
        s.forEach((k, i) => {
            c[k] = i === 0 ? "silent" : s[i - 1];
        });
        return c;
    }

    function isClosedState(key) {
        return key.endsWith("_closed");
    }

    function baseState(key) {
        return key.replace(/_closed$|_silent$/, "");
    }

    function closedVariant(key) {
        return key + "_closed";
    }

    function isAudioState(key) {
        return getAudioStates().includes(key);
    }


    // ── Config audio + blink (serveur → localStorage en fallback) ──────────

    // Valeurs par défaut — écrasées par la config serveur ou localStorage
    let audioConfig = {
        thresholds: [
            { key: "low", label: "Low", db: -55, color: "#4a90e2" },
            {
                key: "medium",
                label: "Medium",
                db: -35,
                color: "#f0a500",
            },
            { key: "high", label: "High", db: -15, color: "#e74c6c" },
        ],
        emotionHoldMs: 800,
        frameSpeed: 150,
        emotions: [
            {
                key: "anger",
                label: "Anger",
                minStatus: "medium",
                freqMin: 80,
                freqMax: 300,
                sensitivity: 1.2,
                useFreqDelta: true,
                deltaDirection: "drop",
                deltaThreshold: 0.5,
            },
            {
                key: "happy",
                label: "Happy",
                minStatus: "low",
                freqMin: 2000,
                freqMax: 6000,
                sensitivity: 1.3,
                useFreqDelta: true,
                deltaDirection: "rise",
                deltaThreshold: 0.4,
            },
            {
                key: "scream",
                label: "Scream",
                minStatus: "high",
                freqMin: 800,
                freqMax: 4000,
                sensitivity: 1.5,
            },
        ],
        blinkSettings: {
            silent: { mode: "blink", intervalMin: 3000, intervalMax: 5000, durationMin: 100, durationMax: 200 },
            low: { mode: "blink", intervalMin: 2500, intervalMax: 4500, durationMin: 100, durationMax: 180 },
            medium: { mode: "blink", intervalMin: 2000, intervalMax: 4000, durationMin: 80, durationMax: 150 },
            high: { mode: "blink", intervalMin: 1500, intervalMax: 3500, durationMin: 70, durationMax: 130 },
        },
    };
    const blinkConfig = {};

    async function loadConfigs() {
        // Priorité : config serveur (/user-config/:token), fallback localStorage
        const uid = FILTER_UID;
        let serverLoaded = false;
        if (uid) {
            try {
                const res = await fetch(
                    `${API_BASE}/user-config/${uid}`,
                    { cache: "no-store" },
                );
                if (res.ok) {
                    const data = await res.json();
                    if (data && Object.keys(data).length) {
                        audioConfig = { ...audioConfig, ...data };
                        serverLoaded = true;
                    }
                }
            } catch {}
        }
        // Fallback localStorage UNIQUEMENT si le serveur n'a pas répondu
        if (!serverLoaded) {
            try {
                const a =
                    localStorage.getItem(`pngtuber-audioConfig-${uid}`) ||
                    localStorage.getItem("pngtuber-audioConfig");
                if (a) {
                    const p = JSON.parse(a);
                    audioConfig = { ...audioConfig, ...p };
                }
            } catch {}
        }
        try {
            Object.assign(
                blinkConfig,
                JSON.parse(
                    localStorage.getItem("pngtuber-blinkConfig") ||
                        "{}",
                ),
            );
        } catch {}
    }

    // BroadcastChannel : reçoit les mises à jour de config en temps réel
    // depuis positioner.html ou l'interface admin (même origine)
    try {
        const bc = new BroadcastChannel("pngtuber-config");
        bc.onmessage = (e) => {
            if (e.data?.type === "audioConfig") {
                const params = new URLSearchParams(location.search);
                const myUid = params.get("t") || params.get("userId");
                // Appliquer si pas de userId ciblé ou si c'est notre userId
                if (!e.data.userId || e.data.userId === myUid) {
                    audioConfig = { ...audioConfig, ...e.data.data };
                    Object.keys(frameCache).forEach(
                        (k) => delete frameCache[k],
                    );
                }
            }
            if (e.data?.type === "blinkConfig") {
                const { uid, freqMs } = e.data;
                blinkConfig[uid] = { freqMs };
                resetBlinkTimer(uid);
            }
        };
    } catch {}


    // ── Gestion des positions (localStorage + BroadcastChannel) ───────────
    // Chaque frame a une position indépendante stockée sous la clé
    // pos__<userId>__<stateKey>__<file>

    function getPosition(userId, stateKey, file) {
        try {
            const s = localStorage.getItem(
                `pos__${userId}__${stateKey}__${file}`,
            );
            return s ? JSON.parse(s) : { x: 0, y: 0, s: 1 };
        } catch {
            return { x: 0, y: 0, s: 1 };
        }
    }

    // BroadcastChannel : reçoit les mises à jour de positions depuis positioner.html
    try {
        const bcp = new BroadcastChannel("pngtuber-positions");
        bcp.onmessage = (e) => {
            const { userId, state } = e.data || {};
            if (userId && state) {
                // Vider le cache img pour forcer recréation avec nouvelles positions
                const av = avatars[userId];
                if (av) {
                    Object.values(av.imgMap).forEach((img) =>
                        img.remove(),
                    );
                    av.imgMap = {};
                }
            }
        };
    } catch {}


    // ── Helpers fréquences (bandes low/mid/high) ──────────────────────────
    // Les données de fréquences arrivent du serveur en 3 bandes prédéfinies.
    // Ces helpers interpolent l'énergie dans une plage Hz arbitraire.

    function bandEnergy(freq, fMin, fMax) {
        let e = 0;
        if (fMax > 0 && fMin < 300)
            e += (freq.low || 0) * Math.min(1, (Math.min(fMax, 300) - Math.max(fMin, 0)) / 300);
        if (fMax > 300 && fMin < 2000)
            e += (freq.mid || 0) * Math.min(1, (Math.min(fMax, 2000) - Math.max(fMin, 300)) / 1700);
        if (fMax > 2000 && fMin < 8000)
            e += (freq.high || 0) * Math.min(1, (Math.min(fMax, 8000) - Math.max(fMin, 2000)) / 6000);
        return e;
    }

    function bandDelta(freqDelta, fMin, fMax) {
        let d = 0;
        if (fMax > 0 && fMin < 300)
            d += (freqDelta.low || 0) * Math.min(1, (Math.min(fMax, 300) - Math.max(fMin, 0)) / 300);
        if (fMax > 300 && fMin < 2000)
            d += (freqDelta.mid || 0) * Math.min(1, (Math.min(fMax, 2000) - Math.max(fMin, 300)) / 1700);
        if (fMax > 2000 && fMin < 8000)
            d += (freqDelta.high || 0) * Math.min(1, (Math.min(fMax, 8000) - Math.max(fMin, 2000)) / 6000);
        return d;
    }

    // Baselines vocales par user (reçues du serveur)
    const userBaselines = {};

    // Détection d'émotion gérée côté serveur (hystérésis intégrée).
    // Le viewer utilise directement info.detectedEmotion.


    // ── Cache frames ───────────────────────────────────────────────────────
    // frameCache[uid__state] = [{url, file}, ...]
    // Evite de re-fetcher les frames à chaque tick audio (~100ms)

    const frameCache = {};
    const closedAvail = {}; // uid → { stateKey → bool }

    async function fetchUserFrames(uid) {
        try {
            const guildParam = GUILD_ID ? `?guild=${GUILD_ID}` : '';
            const res = await fetch(`${API_BASE}/frames/${uid}${guildParam}`, {
                cache: "no-store",
            });
            if (res.status === 403) {
                // Avatar non autorisé sur ce serveur
                document.body.innerHTML = '<div style="color:#e74c6c;padding:2rem;font-family:sans-serif;text-align:center;"><h2>Avatar non autorisé</h2><p>Cet utilisateur n\'a pas autorisé son avatar sur ce serveur.</p></div>';
                return;
            }
            if (!res.ok) return;
            const data = await res.json();
            closedAvail[uid] = {};
            for (const [state, frames] of Object.entries(data)) {
                // Cache mémoire des frames pour éviter de re-fetch à chaque poll audio
                frameCache[`${uid}__${state}`] = frames.map((f) => ({
                    url: `${API_BASE}${f.url}`,
                    file: f.file,
                }));
                if (isClosedState(state) && frames.length > 0)
                    closedAvail[uid][baseState(state)] = true;
            }
        } catch {}
    }

    function resolveFrames(uid, stateKey) {
        // Lookup direct — pas de fallback
        return frameCache[`${uid}__${stateKey}`] || [];
    }

    // BroadcastChannel : reçoit les invalidations de cache frames
    // (envoyé après un upload ou suppression de frame depuis l'interface admin)
    try {
        const bc2 = new BroadcastChannel("pngtuber-frames");
        bc2.onmessage = async (e) => {
            const { uid } = e.data || {};
            if (uid) {
                Object.keys(frameCache)
                    .filter((k) => k.startsWith(uid + "__"))
                    .forEach((k) => delete frameCache[k]);
                await fetchUserFrames(uid);
            } else
                Object.keys(frameCache).forEach(
                    (k) => delete frameCache[k],
                );
        };
    } catch {}


    // ── Rendu avatars (flipbook + blink) ───────────────────────────────────
    // Chaque avatar est un <div class="avatar"> contenant N <img> superposées.
    // Une seule img porte la classe "vis" (visible) à la fois.

    const stage = document.getElementById("stage");
    const avatars = {}; // uid → { el, imgMap:{url→img} }

    function ensureAvatar(uid) {
        if (avatars[uid]) return;
        const el = document.createElement("div");
        el.className = "avatar";
        el.id = `av-${uid}`;
        stage.appendChild(el);
        avatars[uid] = { el, imgMap: {} };
        flipbooks[uid] = {
            intervalId: null,
            frames: [],
            idx: 0,
            activeKey: null,
            stateKey: null,
        };
    }

    function removeAvatar(uid) {
        stopFlipbook(uid);
        stopBlinkTimer(uid);
        avatars[uid]?.el.remove();
        delete avatars[uid];
        delete flipbooks[uid];
        delete userStates[uid];
        delete closedAvail[uid];
        delete smoothData[uid];
    }

    function getOrCreateImg(uid, url, file, stateKey) {
        const av = avatars[uid];
        if (!av) return null;
        if (av.imgMap[url]) return av.imgMap[url];
        const img = document.createElement("img");
        img.className = "avatar-frame";
        img.src = url;
        // La position est appliquée à la création puis réappliquée lors du switch d'image
        const pos = getPosition(uid, stateKey, file);
        img.style.transform = `translate(${pos.x}px,${pos.y}px) scale(${pos.s})`;
        av.el.appendChild(img);
        av.imgMap[url] = img;
        return img;
    }

    // Tracking de l'image actuellement visible par uid
    const currentVisibleFrame = {}; // uid → { file, stateKey }

    function setAvatarFrame(uid, url, file, stateKey) {
        const av = avatars[uid];
        if (!av) return;
        if (!url) {
            Object.values(av.imgMap).forEach((i) => i.classList.remove("vis"));
            return;
        }
        const img = getOrCreateImg(uid, url, file, stateKey);
        if (!img) return;
        if (file && stateKey) {
            const pos = getPosition(uid, stateKey, file);
            img.style.transform = `translate(${pos.x}px,${pos.y}px) scale(${pos.s})`;
        }
        // Afficher la nouvelle AVANT de masquer les autres → pas de flash noir
        const show = () => {
            img.classList.add("vis");
            Object.values(av.imgMap).forEach((i) => {
                if (i !== img) i.classList.remove("vis");
            });
            // Tracker le fichier affiché
            const prev = currentVisibleFrame[uid];
            if (!prev || prev.file !== file || prev.stateKey !== stateKey) {
                currentVisibleFrame[uid] = { file, stateKey };
            }
        };
        if (img.complete) { show(); }
        else { img.onload = show; }
    }

    // ── Flipbook engine ────────────────────────────────────────────────────
    // Anime les frames d'un état en boucle à la cadence audioConfig.frameSpeed

    const flipbooks = {};

    function startFlipbook(uid, frames, stateKey) {
        const speed = audioConfig.frameSpeed || 150;
        const key = frames.map((f) => f.url).join("|");
        const fb = flipbooks[uid];
        if (!fb) return;
        // Si la séquence active est déjà la bonne, on ne redémarre pas l'interval
        if (fb.activeKey === key && fb.intervalId) return;
        stopFlipbook(uid);
        fb.frames = frames;
        fb.stateKey = stateKey;
        fb.activeKey = key;
        fb.idx = 0;
        if (!frames.length) {
            // Pas de frames dispo: garder l'image actuelle à l'écran (jamais d'écran vide)
            return;
        }
        setAvatarFrame(uid, frames[0].url, frames[0].file, stateKey);
        if (frames.length === 1) return;
        fb.intervalId = setInterval(() => {
            fb.idx = Math.floor(Date.now() / speed) % fb.frames.length;
            const f = fb.frames[fb.idx];
            setAvatarFrame(uid, f.url, f.file, fb.stateKey);
        }, speed);
    }

    function stopFlipbook(uid) {
        const fb = flipbooks[uid];
        if (!fb) return;
        if (fb.intervalId) {
            clearInterval(fb.intervalId);
            fb.intervalId = null;
        }
        fb.activeKey = null;
    }

    // ── Blink/transition engine (per-state) ───────────────────────────────
    // Planifie des clignements aléatoires selon les blinkSettings de l'état courant.
    // Utilise les frames "_closed" comme yeux fermés.

    const DEFAULT_BLINK = {
        mode: 'blink',
        intervalMin: 3000, intervalMax: 5000,
        durationMin: 100, durationMax: 200,
    };
    const blinkTimers = {};
    let blinkGeneration = 0;

    function randBetween(min, max) {
        return Math.round(min + Math.random() * (max - min));
    }

    function getBlinkSetting(stateKey) {
        const raw = (audioConfig.blinkSettings && audioConfig.blinkSettings[stateKey]) || {};
        const s = { ...DEFAULT_BLINK, ...raw };
        // Rétrocompat : ancien format avec interval/duration uniques
        if (raw.interval !== undefined && raw.intervalMin === undefined) {
            s.intervalMin = raw.interval;
            s.intervalMax = raw.interval;
        }
        if (raw.duration !== undefined && raw.durationMin === undefined) {
            s.durationMin = raw.duration;
            s.durationMax = raw.duration;
        }
        return s;
    }

    function startBlinkTimer(uid) {
        stopBlinkTimer(uid);
        const hasClosed = Object.values(closedAvail[uid] || {}).some(v => v);
        if (!hasClosed) return;
        const us = userStates[uid];
        const stateKey = us?.displayKey || 'silent';
        if (!isAudioState(stateKey)) return;
        const gen = ++blinkGeneration;
        blinkTimers[uid] = { stateKey, blinking: false, gen, timerId: null };
        scheduleNextBlink(uid, gen);
    }

    function scheduleNextBlink(uid, gen) {
        const bt = blinkTimers[uid];
        if (!bt || bt.gen !== gen) return;
        const setting = getBlinkSetting(bt.stateKey);
        const interval = randBetween(setting.intervalMin, setting.intervalMax);
        bt.timerId = setTimeout(async () => {
            await triggerBlink(uid, gen);
            // Re-planifier si toujours actif
            if (blinkTimers[uid]?.gen === gen) {
                scheduleNextBlink(uid, gen);
            }
        }, interval);
    }

    function stopBlinkTimer(uid) {
        const bt = blinkTimers[uid];
        if (!bt) return;
        clearTimeout(bt.timerId);
        delete blinkTimers[uid];
    }

    function resetBlinkTimer(uid) {
        if (blinkTimers[uid]) startBlinkTimer(uid);
    }

    function updateBlinkForState(uid, newState) {
        const bt = blinkTimers[uid];
        if (!bt || bt.stateKey === newState) return;
        startBlinkTimer(uid);
    }

    async function triggerBlink(uid, gen) {
        const bt = blinkTimers[uid];
        if (!bt || bt.blinking || bt.gen !== gen) return;
        const us = userStates[uid];
        if (!us) return;
        let currentState = us.displayKey;
        if (!isAudioState(currentState)) return;
        const closedFrames = resolveFrames(uid, closedVariant(currentState));
        if (!closedFrames.length) return;

        const setting = getBlinkSetting(currentState);
        const duration = randBetween(setting.durationMin, setting.durationMax);
        bt.blinking = true;

        // Afficher les yeux fermés
        if (setting.mode === 'transition') {
            startFlipbook(uid, closedFrames, closedVariant(currentState));
        } else {
            stopFlipbook(uid);
            setAvatarFrame(uid, closedFrames[0].url, closedFrames[0].file, closedVariant(currentState));
        }

        // Attendre la durée aléatoire, vérification toutes les 50ms
        const step = 50;
        let remaining = duration;
        while (remaining > 0) {
            await new Promise(r => setTimeout(r, Math.min(step, remaining)));
            remaining -= step;
            if (!blinkTimers[uid] || blinkTimers[uid].gen !== gen) return;

            // Continuité blink : si l'état audio change pendant le blink,
            // on garde les yeux fermés mais on switch vers la variante closed du nouvel état
            const newState = userStates[uid]?.displayKey;
            if (newState && newState !== currentState && isAudioState(newState)) {
                const newClosed = resolveFrames(uid, closedVariant(newState));
                if (newClosed.length) {
                    const newSetting = getBlinkSetting(newState);
                    if (newSetting.mode === 'transition') {
                        startFlipbook(uid, newClosed, closedVariant(newState));
                    } else {
                        stopFlipbook(uid);
                        setAvatarFrame(uid, newClosed[0].url, newClosed[0].file, closedVariant(newState));
                    }
                }
                currentState = newState;
            }
        }

        // Restaurer les yeux ouverts (toujours utiliser l'état actuel, pas celui du début)
        const finalState = userStates[uid]?.displayKey || currentState;
        if (blinkTimers[uid]?.gen === gen) {
            const openFrames = resolveFrames(uid, finalState);
            if (openFrames.length) {
                startFlipbook(uid, openFrames, finalState);
            }
            blinkTimers[uid].blinking = false;
            // Mettre à jour le stateKey du blink timer pour le prochain cycle
            blinkTimers[uid].stateKey = finalState;
        }
    }


    // ── État par user (state + émotion gérés côté serveur) ────────────────

    const userStates = {};
    const smoothData = {}; // conservé pour compatibilité removeAvatar


    // ── Update par user ────────────────────────────────────────────────────

    const lastFrameFetch = {}; // uid → timestamp
    const FRAME_REFETCH_INTERVAL = 30000; // 30s safety net — recharge les frames si de nouveaux uploads ont eu lieu

    async function applyUser(uid, info) {
        ensureAvatar(uid);
        const now = Date.now();
        if (!closedAvail[uid]) {
            await fetchUserFrames(uid);
            lastFrameFetch[uid] = now;
            startBlinkTimer(uid);
        } else if (!lastFrameFetch[uid] || now - lastFrameFetch[uid] > FRAME_REFETCH_INTERVAL) {
            // Re-fetch périodique pour détecter les nouveaux uploads
            lastFrameFetch[uid] = now;
            fetchUserFrames(uid).then(() => startBlinkTimer(uid));
        }
        if (!userStates[uid])
            userStates[uid] = {
                displayKey: null,
                holdUntil: null,
                lastEmotion: null,
            };

        // Pipeline rendu: le serveur calcule state + emotion, on affiche directement.
        const rawDb = info.db ?? -100;
        const status = info.state || 'silent';
        if (info.baseline) userBaselines[uid] = info.baseline;

        const emotion = info.detectedEmotion || null;
        const displayKey = emotion || status;
        const frames = resolveFrames(uid, displayKey);

        // ── DEBUG : overlay + envoi serveur ──
        const vis = currentVisibleFrame[uid];
        updateDebugOverlay(rawDb, rawDb, status, emotion, displayKey, vis?.file, vis?.stateKey);
        const ts = new Date().toISOString().slice(11, 23);
        if (activeWs?.readyState === 1) {
            activeWs.send(JSON.stringify({
                type: 'debug-log', ts,
                raw: +rawDb.toFixed(1), smooth: +rawDb.toFixed(1),
                status, emo: emotion || null,
                file: vis?.file || null, state: vis?.stateKey || null
            }));
        }
        // ── FIN DEBUG ──

        if (effectiveKey !== userStates[uid].displayKey) {
            if (frames.length > 0) {
                userStates[uid].displayKey = effectiveKey;
                const bt = blinkTimers[uid];
                if (!bt?.blinking) startFlipbook(uid, frames, effectiveKey);
                updateBlinkForState(uid, effectiveKey);
            }
        }
    }


    // ── Data handling (partagé WS et HTTP poll) ───────────────────────────

    async function handleData(data) {
        hideErr();
        let ids = Object.keys(data).filter((k) => k !== "_bot");
        if (FILTER_UID) ids = ids.filter((id) => id === FILTER_UID);
        for (const uid of ids) await applyUser(uid, data[uid]);
        for (const uid of Object.keys(avatars)) {
            // Ne pas supprimer l'avatar filtré — garder la frame silent visible
            if (!ids.includes(uid) && uid !== FILTER_UID) removeAvatar(uid);
        }
    }


    // ── WebSocket + fallback poll ──────────────────────────────────────────
    // Stratégie: WS en priorité pour le temps-réel, HTTP poll en fallback
    // si le WS échoue (proxy HTTP sans support WS, etc.).

    let wsConnected = false;
    let pollTimerId = null;
    let activeWs = null; // Référence au WS actif pour envoyer les debug logs

    function connectWebSocket() {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${proto}//${location.host}/ws`;
        const ws = new WebSocket(wsUrl);
        activeWs = ws;
        ws.onopen = () => {
            wsConnected = true;
            hideErr();
            // S'abonner à un token spécifique si filtré
            if (FILTER_UID) {
                ws.send(JSON.stringify({ type: "subscribe", token: FILTER_UID }));
            }
            // Arrêter le polling HTTP si actif
            if (pollTimerId) {
                clearInterval(pollTimerId);
                pollTimerId = null;
            }
        };
        ws.onmessage = async (e) => {
            try {
                const data = JSON.parse(e.data);
                // Frame update — re-fetch les frames quand elles changent
                if (data.type === 'frame-update') {
                    const uid = data.token;
                    if (uid) {
                        // Vider le cache frames pour cet uid
                        Object.keys(frameCache)
                            .filter(k => k.startsWith(uid + '__'))
                            .forEach(k => delete frameCache[k]);
                        delete closedAvail[uid];
                        await fetchUserFrames(uid);
                        // Redémarrer le blink timer (les frames closed ont pu changer)
                        startBlinkTimer(uid);
                    }
                    return;
                }
                // Config update en temps réel
                if (data.type === 'config-update') {
                    if (!FILTER_UID || data.token === FILTER_UID) {
                        if (data.config && Object.keys(data.config).length) {
                            audioConfig = { ...audioConfig, ...data.config };
                        }
                        // Ne PAS vider frameCache ici — les fichiers frames n'ont pas changé,
                        // seuls les seuils/blink settings sont mis à jour.
                        // Redémarrer les blink timers avec les nouveaux blinkSettings
                        for (const uid of Object.keys(blinkTimers)) {
                            startBlinkTimer(uid);
                        }
                        // Forcer réévaluation du displayKey pour chaque avatar actif
                        // (les seuils dB ont pu changer → l'état affiché peut changer)
                        for (const uid of Object.keys(userStates)) {
                            userStates[uid].displayKey = null;
                        }
                        // Reset le lissage pour recalculer avec les nouveaux seuils
                        for (const uid of Object.keys(smoothData)) {
                            smoothData[uid].stateHoldUntil = 0;
                        }
                    }
                    return;
                }
                handleData(data);
            } catch {}
        };
        ws.onclose = () => {
            wsConnected = false;
            // Fallback: relancer le polling HTTP
            if (!pollTimerId) startPolling();
            // Reconnexion auto après 2s
            setTimeout(connectWebSocket, 2000);
        };
        ws.onerror = () => {
            ws.close();
        };
    }

    // ── HTTP poll (fallback) ───────────────────────────────────────────────

    async function poll() {
        if (wsConnected) return;
        try {
            const res = await fetch(SOURCE_URL, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            await handleData(data);
        } catch (err) {
            showErr(`${err.message} — ${SOURCE_URL}`);
        }
    }

    function startPolling() {
        if (pollTimerId) return;
        pollTimerId = setInterval(poll, POLL_MS);
        poll();
    }

    const errEl = document.getElementById("err");
    function showErr(msg) {
        errEl.textContent = msg;
        errEl.classList.add("on");
    }
    function hideErr() {
        errEl.classList.remove("on");
    }

    // ── Fallback : toujours afficher la frame silent si on a un token ──────
    // Permet d'avoir l'avatar visible même si l'utilisateur n'est pas
    // en vocal (aucune donnée audio reçue depuis /levels).

    async function showFallbackSilent() {
        if (!FILTER_UID) return;
        ensureAvatar(FILTER_UID);
        if (!closedAvail[FILTER_UID]) {
            await fetchUserFrames(FILTER_UID);
            startBlinkTimer(FILTER_UID);
        }
        if (!userStates[FILTER_UID])
            userStates[FILTER_UID] = { displayKey: null, holdUntil: null, lastEmotion: null };
        const frames = resolveFrames(FILTER_UID, "silent");
        if (frames.length > 0) {
            userStates[FILTER_UID].displayKey = "silent";
            startFlipbook(FILTER_UID, frames, "silent");
        }
    }


    // ── Debug overlay ──────────────────────────────────────────────────────
    // Activé par ?debug=1 dans l'URL ou la touche D au clavier.
    // Affiche les métriques audio en temps réel (dB brut, état, émotion, frame affichée).

    const debugOverlay = document.getElementById('debug-overlay');
    const dbgStatus = document.getElementById('dbg-status');
    let debugVisible = params.get('debug') === '1';
    if (debugVisible) debugOverlay.style.display = '';

    document.addEventListener('keydown', (e) => {
        if (e.key === 'd' || e.key === 'D') {
            debugVisible = !debugVisible;
            debugOverlay.style.display = debugVisible ? '' : 'none';
        }
    });

    function updateDebugOverlay(rawDb, smoothDb, status, emotion, effectiveKey, visFile, visState) {
        if (!debugVisible) return;
        const match = effectiveKey === visState;
        const color = match ? '#0f0' : '#f44';
        const matchLabel = match ? 'OK' : 'DESYNC';
        dbgStatus.innerHTML =
            `<span style="color:#aaa">raw:</span>${rawDb.toFixed(1)}dB ` +
            `<span style="color:#aaa">smooth:</span>${smoothDb?.toFixed(1)}dB ` +
            `<span style="color:#aaa">status:</span><b>${status}</b> ` +
            (emotion ? `<span style="color:#aaa">emo:</span><b style="color:#fa0">${emotion}</b> ` : '') +
            `<span style="color:#aaa">effectif:</span><b>${effectiveKey}</b> ` +
            `<span style="color:#aaa">affiché:</span><b>${visState||'?'}</b> ` +
            `<span style="color:#aaa">fichier:</span>${visFile||'?'} ` +
            `<span style="color:${color};font-weight:bold">[${matchLabel}]</span>`;
    }


    // ── Bootstrap ──────────────────────────────────────────────────────────

    loadConfigs().then(() => {
        // Afficher la frame silent immédiatement, même sans données audio
        showFallbackSilent();
    });
    // Tenter WebSocket d'abord, polling en fallback
    connectWebSocket();
    startPolling(); // polling immédiat en attendant la connexion WS

})();

export {};
