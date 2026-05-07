# PNGTuber Bot

Bot Discord qui anime des avatars PNG en fonction de l'activité vocale. Il rejoint un salon vocal, analyse l'audio de chaque utilisateur en temps réel (volume, spectre fréquentiel, empreintes vocales), et sert des overlays PNGTuber animés pour OBS via un serveur web intégré.

---

## Fonctionnalités

- **Analyse vocale temps réel** — RMS/dB, bandes de fréquences FFT (grave/médium/aigu), ZCR, centroïde spectral, variance d'énergie
- **Détection de formants vocaux** — Extraction F1/F2/F3 par LPC Levinson-Durbin (ord. 12) — enrichit la détection d'émotions (arousal F1, valence F2, tension F3)
- **Avatars multi-états** — silent, low, medium, high + émotions personnalisées (colère, cri, etc.)
- **Système d'empreintes vocales** — Enregistrement de snapshots acoustiques pour détection automatique d'émotions avec hystérésis côté serveur
- **Viewer OBS** — Source navigateur avec animation flipbook, clignement automatique, positionnement par frame
- **Panneau de contrôle web** — Upload/réorganisation/suppression de frames, éditeur de config audio, calibration en direct, contrôle des salons vocaux
- **OAuth2 Discord** — Accès par rôles (admin/client), système de tokens sécurisé (HMAC-SHA256)
- **Abonnements** — Tiers free/premium/streamer avec limites d'upload, gating des fonctionnalités premium
- **Sessions collaboratives** — Sessions vocales automatiques ou standalone (mini-app), avec participants et invitations
- **Invitations** — Ciblées (par Discord ID) ou par lien ouvert, avec notifications temps réel
- **Auth mini-app** — Device Authorization Flow pour les agents locaux (Tauri), Bearer tokens
- **Mode suivi** — Le bot suit automatiquement un utilisateur entre les salons vocaux
- **Prêt pour Docker** — Conteneur unique, données persistées par volume, auto-reconnexion

---

## Démarrage rapide

### Prérequis

- **Node.js 18+** (ou Docker)
- Un [token de bot Discord](https://discord.com/developers/applications)
- Le bot doit avoir les intents : `GUILD_VOICE_STATES`, `GUILD_MEMBERS`, `MESSAGE_CONTENT`

### Installation locale

```bash
git clone <repo-url> && cd pngtuber-bot
cp .env.example .env        # Remplir avec votre DISCORD_TOKEN
npm install
npm start                    # Accessible via BASE_URL ou http://localhost:3000
```

### Docker

```bash
cp .env.example .env        # Remplir avec votre DISCORD_TOKEN
docker compose up -d         # Build + démarrage
docker compose logs -f       # Suivre les logs
```

Le bot génère automatiquement `USER_HASH_SECRET` et `SESSION_SECRET` au premier lancement.

---

## Configuration

Toute la configuration se fait via des variables d'environnement. Voir [`.env.example`](.env.example) pour la référence complète.

| Variable | Requis | Description |
|----------|--------|-------------|
| `DISCORD_TOKEN` | **Oui** | Token du bot |
| `LEVELS_PORT` | Non | Port HTTP (défaut : `3000`) |
| `DISCORD_CLIENT_ID` | Non | ID client OAuth2 (active l'auth web) |
| `DISCORD_CLIENT_SECRET` | Non | Secret client OAuth2 |
| `DISCORD_REDIRECT_URI` | Non | Callback OAuth2 (défaut : `{BASE_URL}/auth/callback`) |
| `BASE_URL` | Non | URL publique derrière le reverse proxy (ex : `https://bot.exemple.com`). Déduit depuis `DISCORD_REDIRECT_URI` si absent |
| `ADMIN_DISCORD_ID` | Non | ID Discord pour l'admin initial (migré en DB au premier lancement) |
| `USER_HASH_SECRET` | Non | Secret HMAC pour la génération des tokens (auto-généré) |
| `SESSION_SECRET` | Non | Secret de signature des cookies (auto-généré) |
| `DATA_ROOT` | Non | Répertoire des données (défaut : racine du projet, Docker : `/app/data`) |
| `CORS_ORIGINS` | Non | Origines supplémentaires autorisées (séparées par des virgules) |
| `PNGTUBER_NO_BROWSER` | Non | Mettre `1` pour désactiver l'ouverture auto du navigateur |
| `TRUST_PROXY` | Non | Mettre `true` derrière un reverse proxy (rate limiting X-Forwarded-For) |

---

## Architecture

### Backend — `index.js` + modules `src/`

`index.js` (~1905 lignes) orchestre l'ensemble et importe les modules de `src/` :

- **Serveur HTTP** (natif, sans Express) avec mini-routeur + pattern middleware (`src/http/`)
- **Bot Discord** (discord.js v14 + @discordjs/voice) avec commandes texte (`!join`, `!disconnect`, `!status`) et commandes slash
- **Pipeline audio** : Opus → PCM (prism-media) → RMS/dB → FFT 1024 points → 3 bandes de fréquences → ZCR + centroïde spectral + variance d'énergie → LPC Levinson-Durbin → formants F1/F2/F3 → matching d'empreintes vocales avec hystérésis
- **Serveur WebSocket** pour le streaming des niveaux audio en temps réel (20fps)
- **Base de données SQLite** (better-sqlite3) — schéma + repositories dans `src/db/`
- **OAuth2 + auth par rôles** avec cookies de session sécurisés + Device Auth Flow (Bearer tokens) — `src/services/authService.js`
- **Système d'abonnements** (free/premium/streamer) avec enforcement côté serveur — `src/services/tierService.js`
- **Sessions + invitations + notifications** temps réel via WebSocket — `src/routes/sessions.js`

**Structure `src/` :**

| Répertoire | Contenu |
|------------|---------|
| `src/bot/` | audio.js (pipeline complet Opus→PCM→FFT→LPC→formants), discord.js (client + events) |
| `src/services/` | rateLimiter, tokenService, tierService, authService, audioService, voiceService |
| `src/db/` | database.js (SQLite init + schéma), repos/ (users, permissions, subscriptions, sessions, appTokens) |
| `src/http/` | cors.js, helpers.js, router.js, middleware.js |
| `src/routes/` | levels, frames, notifications, subscriptions, sessions, admin, auth, config, device, emotion, permissions, upload, voice |

### Frontend — React (Vite) + pages HTML standalone

**Panneau de contrôle** : application React 18 dans `client/`, buildée en `dist/`. Le backend sert `dist/index.html` pour `/`.

| Page | Description |
|------|-------------|
| `viewer.html` | Source navigateur OBS — rendu des avatars PNGTuber animés (standalone, non migré) |
| `/positioner` | Éditeur de position/échelle des frames — route React (`PositionerApp.jsx`) |

`viewer.html` reste un fichier HTML standalone (usage OBS exclusivement). `positioner.html` a été supprimé et remplacé par la route React `/positioner`.

### Flux de données

```
Salon vocal Discord
        │
        ▼
   Flux Opus → Décodeur PCM → Analyse audio (tick 50ms)
        │
        ▼
   RMS → dB → Lissage + Classification → État (silent/low/med/high)
        │
        ▼
   FFT → Bandes fréq. ──────────────────────────┐
        │                                        │
        ▼                                        ▼
   LPC (Levinson-Durbin) → Formants F1/F2/F3    │
        │                                        │
        └──────────────────────────────────────▶ Matching empreintes → Émotion (hystérésis)
        │
        ▼
   ┌─────────────────────────────────┐
   │  ÉTAT FINAL (state + emotion)   │  ← source unique de vérité
   │  calculé côté SERVEUR           │
   └────────────┬────────────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
   WebSocket        GET /levels
   (20fps)          (polling HTTP)
        │               │
        ▼               ▼
   viewer.html     React App (dist/)
   (overlay OBS)   (panneau de contrôle)
```

Les deux clients reçoivent les **mêmes données** (state + émotion) calculées par le serveur. Aucun lissage local n'est effectué côté client.

### Sécurité

- **IDs utilisateur jamais exposés** — Les IDs Discord sont hashés en HMAC-SHA256 en tokens hex de 16 caractères
- **Sessions viewer** — Des IDs de session temporaires résolvent vers les tokens utilisateur (pas de token dans l'URL)
- **Prévention traversal de chemin** — Regex `SAFE_STATE_KEY`/`SAFE_FILENAME` + `path.resolve()` + `startsWith()` sur toutes les opérations fichier
- **Validation d'upload** — Magic bytes validation, rejet SVG, types limités (PNG/JPG/GIF/WebP), conversion via Sharp
- **Limite de taille** — 10 Mo maximum par requête
- **Liste blanche de config** — Seules les clés autorisées acceptées via `ALLOWED_CONFIG_KEYS`
- **Rate limiting** — Upload (30/min), auth (10/min), device auth (5/min), device verify (10/min) par IP
- **Headers de sécurité** — X-Content-Type-Options, X-XSS-Protection, HSTS (conditionnel), Referrer-Policy
- **CORS sécurisé** — Validation d'origin stricte, pas de wildcard avec credentials
- **WebSocket origin check** — Vérification de l'origin des connexions WS
- **App tokens limités** — Les tokens API sont forcés au rôle `client` (pas d'accès admin même si l'utilisateur est admin)
- **TRUST_PROXY** — Rate limiting fiable : `X-Forwarded-For` ignoré sauf activation explicite

---

## Référence API

### Publique (sans auth)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/levels` | Niveaux audio temps réel de tous les utilisateurs |
| GET | `/status` | État de connexion du bot |
| GET | `/bot-info` | Infos du bot (avatar, nom) |
| GET | `/frames/:token` | Récupérer les frames d'un utilisateur |
| GET | `/user-config/:token` | Récupérer la config audio d'un utilisateur |
| GET | `/known-users` | Liste des utilisateurs connus |
| GET | `/images/*` | Servir les images de frames |
| POST | `/api/device/authorize` | Demander un code device (mini-app) |
| POST | `/api/device/poll` | Vérifier l'état d'une demande device |
| GET | `/api/invitations/:id` | Détails d'une invitation |
| GET | `/invite/:id` | Page d'acceptation d'invitation |

### Protégée (client ou admin)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/upload` | Upload de frames PNG (limité par tier) |
| POST | `/reorder` | Réordonner les frames |
| POST | `/delete-frame` | Supprimer une frame |
| POST | `/user-config/:token` | Sauvegarder la config audio |
| POST | `/api/viewer-session` | Créer une session viewer temporaire |

### Authentifié (tout utilisateur connecté)

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET/POST | `/api/device/verify` | Page/soumission de vérification device |
| GET/DELETE | `/api/app-tokens` | Lister/révoquer ses tokens API |
| POST/GET | `/api/sessions` | Créer/lister les sessions |
| GET | `/api/sessions/:id` | Détails d'une session |
| POST | `/api/sessions/:id/end` | Terminer une session (owner) |
| POST | `/api/sessions/:id/leave` | Quitter une session |
| POST | `/api/invitations` | Créer une invitation |
| POST | `/api/invitations/:id/accept` | Accepter une invitation |
| POST | `/api/invitations/:id/decline` | Refuser une invitation |
| GET | `/api/my-invitations` | Invitations reçues en attente |
| GET | `/api/notifications` | Récupérer ses notifications |
| POST | `/api/notifications/:id/read` | Marquer comme lu |
| POST | `/api/notifications/read-all` | Tout marquer comme lu |
| GET | `/api/subscription` | Mon abonnement et tier |
| POST/GET | `/api/subscription/seats` | Gérer les places du pack streamer |

### Admin uniquement

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| POST | `/bot-token` | Mettre à jour le token du bot |
| DELETE | `/delete-user/:token` | Supprimer un utilisateur et toutes ses données |
| GET/POST | `/api/permissions` | Gérer les rôles |
| GET | `/api/guilds` | Lister les serveurs du bot |
| GET | `/api/guilds/:id/channels` | Lister les salons vocaux |
| POST | `/api/voice/join` | Rejoindre un salon vocal |
| POST | `/api/voice/disconnect` | Quitter le salon vocal |
| POST | `/api/voice/follow` | Suivre un utilisateur |
| POST | `/api/subscription` | Attribuer un abonnement |
| DELETE | `/api/subscription/:discordId` | Annuler un abonnement |

### WebSocket

Se connecter à `wss://votre-domaine.com/ws` (ou `ws://` en local) pour les mises à jour temps réel à 20fps.

Messages supportés :
- `{ type: "subscribe", token: "..." }` — S'abonner aux niveaux d'un utilisateur
- `{ type: "auth", appToken: "..." }` — Authentification via token API (mini-app)
- `{ type: "set-emotion", token: "...", emotion: "..." }` — Changer l'émotion manuellement

Notifications temps réel reçues : `{ type: "notification", notification: {...} }`

---

## Configuration OBS

1. Ouvrir le panneau de contrôle et uploader des frames PNG pour chaque état audio
2. Cliquer sur le bouton **OBS** sur la carte d'un utilisateur pour générer une URL viewer
3. Dans OBS, ajouter une **Source navigateur** avec l'URL générée
4. Recommandé : 300x300 px, 30 FPS, fond transparent

Paramètres de `viewer.html` :

| Paramètre | Défaut | Description |
|-----------|--------|-------------|
| `t` | — | Token utilisateur (requis) |
| `poll` | `100` | Intervalle de polling HTTP en ms (fallback si WS échoue) |
| `size` | `200px` | Taille de l'avatar |
| `debug` | `0` | Afficher l'overlay de debug |

---

## Déploiement en production (Reverse Proxy avec Pangolin)

Le bot est conçu pour tourner derrière un reverse proxy qui gère le HTTPS et le nom de domaine. Voici la procédure complète avec [Pangolin](https://github.com/fosrl/pangolin).

### Prérequis

- Un **VPS** (ex : Hetzner, OVH, Contabo) avec Docker installé
- Un **nom de domaine** pointant vers l'IP du VPS (ex : `bot.exemple.com`)
- **Pangolin** installé et configuré sur le VPS (gère les tunnels, certificats TLS, et le routage)

### 1. Installer Pangolin sur le VPS

Suivre la documentation officielle de Pangolin pour l'installation sur le VPS. Pangolin fournit :
- Reverse proxy automatique avec certificats Let's Encrypt
- Tunnels sécurisés (alternative à Cloudflare Tunnel)
- Dashboard de gestion des sites

```bash
# Sur le VPS — installer Pangolin (voir docs officielles)
# https://docs.pangolin.dev
```

### 2. Configurer le site dans Pangolin

Dans le dashboard Pangolin, créer un nouveau site :
- **Domaine** : `bot.exemple.com` (votre sous-domaine)
- **Port cible** : `3000` (le port du bot)
- **Protocole** : HTTP (Pangolin gère le TLS en frontal)
- **WebSocket** : Activer le support WebSocket (nécessaire pour `/ws`)

### 3. Configurer le `.env` du bot

```bash
# .env sur le VPS
DISCORD_TOKEN=votre_token_ici

# URL publique (celle de votre domaine Pangolin)
BASE_URL=https://bot.exemple.com

# OAuth2 Discord — callback avec le domaine public
DISCORD_CLIENT_ID=votre_client_id
DISCORD_CLIENT_SECRET=votre_client_secret
DISCORD_REDIRECT_URI=https://bot.exemple.com/auth/callback

ADMIN_DISCORD_ID=votre_discord_id

# Pas besoin d'ouvrir un navigateur sur le serveur
PNGTUBER_NO_BROWSER=1

# Derrière un reverse proxy — activer pour le rate limiting
TRUST_PROXY=true

# Port interne (Pangolin route vers ce port)
LEVELS_PORT=3000
```

### 4. Configurer Discord OAuth2

Dans le [portail développeur Discord](https://discord.com/developers/applications) :
1. Aller dans **OAuth2 > General**
2. Ajouter `https://bot.exemple.com/auth/callback` dans les **Redirects**
3. Copier le **Client ID** et **Client Secret** dans le `.env`

### 5. Lancer le bot

```bash
docker compose up -d
docker compose logs -f    # Vérifier que tout démarre
```

Le bot est maintenant accessible sur `https://bot.exemple.com` avec HTTPS automatique.

### 6. Configurer OBS

Dans OBS, les URLs viewer utilisent le domaine public :
```
https://bot.exemple.com/viewer.html?t=...
```
Le WebSocket passe automatiquement en `wss://` grâce au reverse proxy.

---

## Développement

```bash
npm run dev:api              # Lancer le backend (node index.js)
npm run dev:ui               # Lancer le Vite dev server React (port 5173)
cd client && npm install     # Installer les dépendances frontend
npm run build:ui             # Builder React → dist/
npm start                    # Lancer en local (backend seul)
node --check index.js        # Vérification syntaxe (pas de suite de tests)
docker compose build         # Reconstruire l'image Docker (inclut npm run build:ui)
docker compose up -d         # Démarrer le conteneur
docker compose logs -f       # Suivre les logs
```

### Structure du projet

```
├── index.js            # Backend : bot + HTTP + audio + auth + DB (orchestre src/)
├── src/
│   ├── bot/            # audio.js (pipeline FFT+LPC), discord.js (client + events)
│   ├── services/       # rateLimiter, tokenService, tierService, authService, audioService, voiceService
│   ├── db/             # database.js + repos/ (users, permissions, subscriptions, sessions, appTokens)
│   ├── http/           # cors.js, helpers.js, router.js, middleware.js
│   └── routes/         # levels, frames, notifications, subscriptions, sessions, admin,
│                       # auth, config, device, emotion, permissions, upload, voice
├── client/             # Application React 18 + Vite (panneau de contrôle)
│   └── src/            # Composants, hooks, contexte, api.js
├── dist/               # Build React généré (servi par le backend en production)
├── viewer.html         # Source navigateur OBS (standalone, non migré)
├── package.json        # Dépendances backend
├── Dockerfile          # Build multi-étages : frontend-build → backend-build → runtime
├── docker-compose.yml  # Configuration conteneur
├── .env.example        # Modèle de variables d'environnement
└── data/               # Données runtime (DB SQLite, images uploadées)
```

### Conventions de code

- **Langage** : JavaScript ES Modules, pas de TypeScript
- **Style** : Fonctionnel, async/await, pas de classes
- **Commentaires** : En français
- **Frontend** : React 18 + Vite (panneau de contrôle), HTML inline (viewer/positioner OBS)
- **Backend** : Serveur HTTP natif, sans Express

---

## Licence

MIT
