// Configuration via query params:
// ?sourceUrl=http://localhost:3000/levels&poll=200
const params = new URLSearchParams(location.search);
const sourceUrl = params.get("sourceUrl") || "http://localhost:3000/levels";
const poll = parseInt(params.get("poll") || "200", 10);

// Map of userId->displayName can be passed as JSON in 'map' param (urlencoded)
let nameMap = {};
try {
    if (params.get("map")) nameMap = JSON.parse(params.get("map"));
} catch (e) {}

const container = document.getElementById("container");
const configPanel = document.getElementById("image-controls");

// image config by state and on/off
const stateImages = {
    silent: { on: null, off: null },
    low: { on: null, off: null },
    medium: { on: null, off: null },
    high: { on: null, off: null },
};

// build controls
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
                // update existing user elements
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
    u.currentState = state;
    for (const node of u.states.children) {
        if (node.dataset.state === state) {
            node.classList.add("on");
            node.classList.remove("off");
            // apply image if available
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
    // mark seen
    for (const id of Object.keys(obj)) {
        const info = obj[id];
        const u = ensureUser(id);
        // set db
        u.db.textContent = (info.db || -100).toFixed(2) + " dB";
        // set classes: only one state on at a time
        const s = info.status || "silent";
        updateUserState(u, s);
        u.last = info.updated || now;
    }
    // remove stale users (not updated in 10s)
    for (const [id, u] of users) {
        if (!obj[id] && u.last && now - u.last > 10000) {
            u.el.remove();
            users.delete(id);
        }
    }
}

async function pollOnce() {
    try {
        const r = await fetch(sourceUrl, { cache: "no-store" });
        if (r.ok) {
            const j = await r.json();
            updateLevels(j);
        }
    } catch (e) {
        // show error hint
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
