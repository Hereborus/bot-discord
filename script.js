/**
 * LEGACY WIDGET SCRIPT (`script.js`)
 * ==================================
 *
 * Statut:
 * - Ce fichier est conservé pour compatibilité / historique.
 * - Les pages principales actuelles utilisent surtout des scripts inline
 *   dans `index.html` et `viewer.html`.
 *
 * Rôle:
 * - Poll un endpoint `/levels` périodiquement.
 * - Affiche une carte par utilisateur et met à jour un état visuel.
 * - Permet de charger des images locales par état (on/off) côté navigateur.
 *
 * Limites:
 * - Ne couvre pas toutes les fonctionnalités avancées (flipbook, fallback,
 *   blink par états `_closed`, etc.) présentes dans `viewer.html`.
 */

// Configuration via query params:
// ?sourceUrl=http://localhost:3000/levels&poll=200
const params = new URLSearchParams(location.search);
const sourceUrl = params.get("sourceUrl") || "http://localhost:3000/levels";
const poll = parseInt(params.get("poll") || "200", 10);

// Map optionnelle userId -> displayName, transmise en JSON via ?map=
let nameMap = {};
try {
    if (params.get("map")) nameMap = JSON.parse(params.get("map"));
} catch (e) {}

const container = document.getElementById("container");
const configPanel = document.getElementById("image-controls");

// Configuration d'images par état:
// on  = image active pour l'état courant
// off = image affichée pour les états non actifs
const stateImages = {
    silent: { on: null, off: null },
    low: { on: null, off: null },
    medium: { on: null, off: null },
    high: { on: null, off: null },
};

// Générer les contrôles d'upload (on/off pour chaque état)
["silent", "low", "medium", "high"].forEach((s) => {
    ["on", "off"].forEach((o) => {
        const div = document.createElement("div");
        div.className = "control";
        const lbl = document.createElement("label");
        lbl.textContent = `${s} ${o}`;
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = "image/*";
        inp.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const url = URL.createObjectURL(file);
                stateImages[s][o] = url;
                // Réappliquer le rendu sur toutes les cartes déjà créées.
                for (const u of users.values()) {
                    updateUserState(u, u.currentState);
                }
            }
        };
        div.appendChild(lbl);
        div.appendChild(inp);
        configPanel.appendChild(div);
    });
});

function updateUserState(u, state) {
    // Règle d'affichage: un seul état actif à la fois.
    u.currentState = state;
    for (const node of u.states.children) {
        if (node.dataset.state === state) {
            node.classList.add("on");
            node.classList.remove("off");
            // Appliquer l'image custom si disponible.
            const imgUrl = stateImages[state].on;
            if (imgUrl) {
                node.style.backgroundImage = `url('${imgUrl}')`;
                node.textContent = "";
            } else node.style.backgroundImage = "";
        } else {
            node.classList.remove("on");
            node.classList.add("off");
            const imgUrl = stateImages[node.dataset.state].off;
            if (imgUrl) {
                node.style.backgroundImage = `url('${imgUrl}')`;
                node.textContent = "";
            } else node.style.backgroundImage = "";
        }
    }
}

const users = new Map();

function ensureUser(id) {
    // Factory DOM: crée la carte une seule fois puis la réutilise à chaque poll.
    if (users.has(id)) return users.get(id);
    const el = document.createElement("div");
    el.className = "user";
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = nameMap[id] || id;
    const states = document.createElement("div");
    states.className = "states";
    ["silent", "low", "medium", "high"].forEach((s) => {
        const d = document.createElement("div");
        d.className = "state off";
        d.dataset.state = s;
        d.textContent = s[0].toUpperCase();
        states.appendChild(d);
    });
    const db = document.createElement("div");
    db.className = "db";
    db.textContent = "-";
    el.appendChild(label);
    el.appendChild(states);
    el.appendChild(db);
    container.appendChild(el);
    users.set(id, { el, label, states, db });
    return users.get(id);
}

function updateLevels(obj) {
    const now = Date.now();
    // Marquer les users vus dans ce cycle de poll.
    for (const id of Object.keys(obj)) {
        const info = obj[id];
        const u = ensureUser(id);
        // Afficher la valeur dB reçue.
        u.db.textContent = (info.db || -100).toFixed(2) + " dB";
        // Sélection de l'état en provenance de l'API.
        const s = info.status || "silent";
        updateUserState(u, s);
        u.last = info.updated || now;
    }
    // Nettoyer les users inactifs (pas de mise à jour depuis >10s).
    for (const [id, u] of users) {
        if (!obj[id] && u.last && now - u.last > 10000) {
            u.el.remove();
            users.delete(id);
        }
    }
}

async function pollOnce() {
    try {
        // no-store: toujours lire des niveaux frais (OBS/temps réel).
        const r = await fetch(sourceUrl, { cache: "no-store" });
        if (r.ok) {
            const j = await r.json();
            updateLevels(j);
        }
    } catch (e) {
        // Afficher une indication d'erreur réseau/API dans le widget.
        let h = document.querySelector(".hint");
        if (!h) {
            h = document.createElement("div");
            h.className = "hint";
            container.appendChild(h);
        }
        h.textContent = "Erreur fetching /levels: " + e.message;
    }
}

setInterval(pollOnce, Math.max(100, poll));
pollOnce();
