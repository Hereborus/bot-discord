/**
 * Audio Levels Viewer - Client Widget
 * ====================================
 *
 * Gère l'affichage en temps réel des utilisateurs Discord
 * et leurs états audio avec transitions d'image fluides.
 *
 * RESPONSABILITÉS:
 * - Récupérer les données audio de l'API /levels
 * - Gérer les transitions d'état (silent, low, medium, high)
 * - Afficher les images appropriées basées sur l'état
 * - Animer le clignement des yeux pour l'état "silent"
 * - Afficher les métadonnées (dB, fréquences, emotion)
 *
 * QUERY PARAMETERS:
 * - ?sourceUrl=http://localhost:3000/levels  : URL de l'API (default: localhost:3000)
 * - ?imagesBase=./pnjtuber                   : Chemin de base des images
 */

// ============================================================================
// CONFIGURATION & STATE
// ============================================================================

/**
 * Query parameters pour personnaliser le comportement
 */
const sourceUrl =
    new URLSearchParams(location.search).get("sourceUrl") ||
    "http://localhost:3000/levels";
const imagesBase =
    new URLSearchParams(location.search).get("imagesBase") || "./pnjtuber";
const pollInterval = 80; // ms between API fetches

const grid = document.getElementById("grid");

/**
 * State tracking pour chaque utilisateur
 * Structure: {
 *   userId: {
 *     currentState: "silent"|"low"|"medium"|"high",
 *     lastState: previous state (for transitions),
 *     blinkInterval: timer ID pour animation des yeux,
 *     element: DOM card element
 *   }
 * }
 */
const userStates = new Map();

// ============================================================================
// IMAGE PATH RESOLUTION
// ============================================================================

/**
 * Résoudre le chemin d'une image basée sur userId, status, emotion
 *
 * Structure attendue:
 * pnjtuber/user{id}/{status}/{emotion|status}.png
 *
 * @param {string} userId - ID utilisateur Discord
 * @param {string} status - silent, low, medium, high
 * @param {string|null} emotion - scream, anger (si status=high)
 * @returns {string} - Chemin complet de l'image
 */
function getImagePath(userId, status, emotion) {
    // Si high + emotion, utiliser emotion comme subdir
    const subdir = status === "high" && emotion ? emotion : status;
    return `${imagesBase}/user${userId}/${status}/${subdir}.png`;
}
/**
 * Résoudre les deux images pour l'animation de clignement (silent)
 * on.png: yeux ouverts
 * off.png: yeux fermés
 *
 * @param {string} userId - ID utilisateur
 * @returns {Object} - { on, off } paths
 */
function getBlinkImagePaths(userId) {
    return {
        on: `${imagesBase}/user${userId}/silent/on.png`,
        off: `${imagesBase}/user${userId}/silent/off.png`,
    };
}

// ============================================================================
// BLINK ANIMATION (STATE = SILENT)
// ============================================================================

/**
 * Démarrer l'animation de clignement pour l'état "silent"
 * Alterne entre on.png (yeux ouverts) et off.png (yeux fermés) toutes les 850ms
 *
 * @param {HTMLImageElement} imgElement - Image element à animer
 * @param {string} userId - ID utilisateur
 * @returns {Object} - { intervalId, stop() } pour contrôle
 */
function startBlinkAnimation(imgElement, userId) {
    const paths = getBlinkImagePaths(userId);
    let isOn = true;

    // Démarrer avec yeux ouverts
    imgElement.src = paths.on;
    imgElement.classList.add("blinking");

    // Alterner les images
    const intervalId = setInterval(() => {
        isOn = !isOn;
        imgElement.src = isOn ? paths.on : paths.off;
    }, 3850);

    return {
        intervalId,
        stop() {
            clearInterval(intervalId);
            imgElement.classList.remove("blinking");
        },
    };
}

// ============================================================================
// UI RENDERING
// ============================================================================

/**
 * Créer ou mettre à jour une carte utilisateur
 *
 * @param {string} userId - ID utilisateur
 * @param {Object} info - Données audio { db, status, freq, emotion, rms, updated }
 */
function createOrUpdateUserCard(userId, info) {
    let userState = userStates.get(userId);

    // Créer une nouvelle carte si elle n'existe pas
    if (!userState) {
        const card = document.createElement("div");
        card.className = "user-card";

        // Nom utilisateur
        const name = document.createElement("div");
        name.className = "user-name";
        name.textContent = `User ${userId}`;
        card.appendChild(name);

        // Image
        const img = document.createElement("img");
        img.className = "user-image";
        img.alt = "";
        card.appendChild(img);

        // Métadonnées
        const meta = document.createElement("div");
        meta.className = "user-meta";
        meta.id = `meta-${userId}`;
        card.appendChild(meta);

        // Error placeholder
        img.onerror = () => {
            const placeholder = document.createElement("div");
            placeholder.style.cssText =
                "width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#555;font-size:12px;";
            placeholder.textContent = "Image not found";
            img.replaceWith(placeholder);
        };

        grid.appendChild(card);

        userState = {
            userId,
            currentState: null,
            lastState: null,
            blinkController: null,
            imgElement: img,
            metaElement: meta,
            element: card,
        };
        userStates.set(userId, userState);
    }

    // Mettre à jour l'image basée sur le nouveau statut
    const newStatus = info.status || "silent";
    if (userState.currentState !== newStatus) {
        // ====== STATE TRANSITION ======
        // Arrêter l'ancienne animation de clignement
        if (userState.blinkController) {
            userState.blinkController.stop();
            userState.blinkController = null;
        }

        // Déterminer quelle image afficher
        if (newStatus === "silent") {
            // Silent: animer le clignement des yeux
            userState.blinkController = startBlinkAnimation(
                userState.imgElement,
                userId,
            );
        } else {
            // Autres états: afficher image fixe
            const imagePath = getImagePath(userId, newStatus, info.emotion);
            userState.imgElement.src = imagePath;
            userState.imgElement.classList.remove("blinking");
        }

        userState.currentState = newStatus;
    }

    // Mettre à jour les métadonnées
    const meta = userState.metaElement;
    meta.innerHTML = "";

    // Badge statut
    const statusBadge = document.createElement("span");
    statusBadge.className = `status-badge status-badge-${newStatus}`;
    statusBadge.textContent = newStatus;
    meta.appendChild(statusBadge);

    // Badge émotion (si applicable)
    if (info.emotion && newStatus === "high") {
        const emotionBadge = document.createElement("span");
        emotionBadge.className = "emotion-badge";
        emotionBadge.textContent = info.emotion;
        meta.appendChild(emotionBadge);
    }

    // dB value
    if (info.db !== undefined) {
        const dbSpan = document.createElement("span");
        dbSpan.className = "db-value";
        dbSpan.textContent = `${info.db.toFixed(1)} dB`;
        meta.appendChild(dbSpan);
    }

    // Fréquence info (debug)
    if (info.freq && typeof info.freq === "object") {
        const freqDiv = document.createElement("div");
        freqDiv.className = "freq-info";
        freqDiv.textContent = `${info.freq.low?.toFixed(2)} / ${info.freq.mid?.toFixed(2)} / ${info.freq.high?.toFixed(2)}`;
        meta.appendChild(freqDiv);
    }
}

/**
 * Supprimer une carte utilisateur du grid
 * (Quand l'utilisateur quitte ou devient inactif)
 *
 * @param {string} userId - ID utilisateur
 */
function removeUserCard(userId) {
    const userState = userStates.get(userId);
    if (!userState) return;

    // Arrêter animation
    if (userState.blinkController) {
        userState.blinkController.stop();
    }

    // Supprimer du DOM
    if (userState.element && userState.element.parentNode) {
        userState.element.parentNode.removeChild(userState.element);
    }

    userStates.delete(userId);
}

// ============================================================================
// API POLLING
// ============================================================================

/**
 * Récupérer les données audio depuis l'API et mettre à jour l'affichage
 *
 * Fetch /levels qui retourne:
 * {
 *   _bot: { connected, guildId, channelId, updatedAt },
 *   userId1: { db, status, freq, emotion, rms, updated },
 *   userId2: { ... },
 *   ...
 * }
 */
async function update() {
    try {
        const res = await fetch(sourceUrl, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Filter out _bot metadata
        const userIds = Object.keys(data).filter((k) => k !== "_bot");
        const botStatus = data._bot;

        // Mettre à jour les cartes utilisateurs existantes
        for (const userId of userIds) {
            const info = data[userId];
            createOrUpdateUserCard(userId, info);
        }

        // Supprimer les utilisateurs qui ne sont plus dans les données
        for (const userId of userStates.keys()) {
            if (!userIds.includes(userId)) {
                removeUserCard(userId);
            }
        }

        // ====== DEBUG INFO ======
        // Affichage optionnel du statut du bot
        if (botStatus && !botStatus.connected) {
            // Afficher warning si bot pas connecté
            if (!grid.querySelector(".viewer-error")) {
                const err = document.createElement("div");
                err.className = "viewer-error";
                err.textContent = "⚠ Bot not connected to Discord";
                grid.prepend(err);
            }
        } else {
            // Supprimer warning si bot maintenant connecté
            const err = grid.querySelector(".viewer-error");
            if (err) err.remove();
        }
    } catch (err) {
        // Afficher erreur réseau/API
        if (!grid.querySelector(".viewer-error")) {
            const errDiv = document.createElement("div");
            errDiv.className = "viewer-error";
            errDiv.textContent = `API Error: ${err.message}`;
            grid.prepend(errDiv);
        }
        console.error("Viewer update error:", err);
    }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Démarrer le polling
setInterval(update, pollInterval);
// Appel initial immédiat
update();

console.log(
    `✓ Audio Viewer initialized (sourceUrl: ${sourceUrl}, imagesBase: ${imagesBase})`,
);
