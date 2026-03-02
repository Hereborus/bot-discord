# Documentation technique — `bot-discord`

Ce document décrit l’architecture actuelle du projet, les endpoints exposés, les pages UI, les flux de données audio, ainsi que les fichiers actifs et les fichiers legacy.

## 1) Vue d’ensemble

Le projet est un bot Discord + serveur HTTP local qui permet de :

- rejoindre un salon vocal (`!join`),
- analyser l’audio entrant par utilisateur,
- exposer des niveaux audio en JSON,
- gérer des assets PNG par état (`silent`, `low`, `medium`, `high`, variantes),
- configurer le rendu via une UI web (`index.html`),
- afficher le rendu final via une page viewer (`viewer.html`),
- ajuster les positions des frames avec un éditeur (`positioner.html`).

Le backend principal est `index.js`.

---

## 2) Architecture backend (`index.js`)

### 2.1 Démarrage

Au lancement :

1. lit/crée `.env`,
2. garantit `LEVELS_PORT` et `USER_HASH_SECRET`,
3. crée les dossiers `images/` et `meta/` si absents,
4. démarre le serveur HTTP,
5. tente le login Discord si `DISCORD_TOKEN` est présent.

### 2.2 Confidentialité des identifiants

Le backend n’expose pas les userId Discord côté HTTP.

- Chaque userId est transformé en token opaque via HMAC-SHA256 tronqué (`hashUid`).
- Les routes publiques manipulent ces tokens.
- Les fichiers disque (`meta/*.json`, `images/*`) sont nommés avec le hash.

### 2.3 Pipeline audio

Quand un utilisateur parle :

1. `receiver.subscribe(userId)` récupère le flux opus,
2. décodage PCM (`prism-media` + `@discordjs/opus`),
3. calcul RMS puis dB,
4. lissage par fenêtre temporelle (`durationWindow`),
5. calcul fréquentiel FFT (`low`, `mid`, `high`),
6. stockage dans `userLevels`.

### 2.4 Déconnexion auto vocale

Si le bot reste seul (plus d’humains dans le vocal), il se déconnecte automatiquement après 5s.

---

## 3) Endpoints HTTP (actuels)

### 3.1 Endpoints d’état

- `GET /levels`
    - Retourne `_bot` + données par token utilisateur.
    - Données utilisateur: `db`, `rms`, `freq`, `speaking`, `displayName`, `updated`.

- `GET /status`
    - Résumé: état connecté du bot + nombre d’utilisateurs actifs.

- `GET /bot-info`
    - Statut token Discord, connexion, tag/id du bot si connecté.

- `POST /bot-token`
    - Vérifie un token Discord, le sauvegarde dans `.env`, puis redémarre le process.

### 3.2 Endpoints assets/config

- `GET /frames/:token`
    - Retourne les frames par état pour un utilisateur.

- `GET /images/:token/:state/:file`
    - Sert l’image demandée.

- `GET /user-config/:token`
- `POST /user-config/:token`
    - Lecture/écriture de la config utilisateur.

- `GET /known-users`
    - Liste des utilisateurs connus (actifs + persistés), avec `token`, `displayName`.

- `POST /upload`
    - Upload image multipart (`token`, `stateKey`, `image`).

- `POST /reorder`
    - Persiste l’ordre des frames (`token`, `stateKey`, `order[]`).

- `POST /delete-frame`
    - Supprime une frame d’un état.

- `POST /delete-user/:token`
    - Supprime les données d’un utilisateur (images + meta + mémoire).

### 3.3 Fichiers statiques

Le serveur sert aussi les fichiers du projet (`/index.html`, `/viewer.html`, `/positioner.html`, etc.).

---

## 4) Pages web principales

## 4.1 `index.html` (UI principale)

Fonctions clés :

- affichage des utilisateurs actifs,
- gestion des frames par état,
- upload/suppression/réordonnancement des assets,
- édition de la config audio (seuils/émotions/frame speed/hold),
- setup token Discord du bot,
- génération d’URL viewer et positioner.

## 4.2 `viewer.html` (rendu OBS)

Fonctions clés :

- polling de `/levels`,
- classification d’état selon dB,
- détection émotionnelle selon bandes fréquentielles,
- fallback d’états (si images manquantes),
- moteur flipbook,
- blink automatique via états `_closed`,
- application des positions stockées en local.

## 4.3 `positioner.html` (éditeur positions)

Fonctions clés :

- charge les frames d’un état,
- superpose les images sur canvas,
- permet drag + sliders (`x`, `y`, `s`),
- sauvegarde en `localStorage`,
- notifie le viewer via `BroadcastChannel`.

---

## 5) Fichiers actifs vs legacy

### Actifs (utilisés en pratique)

- `index.js` (backend + bot Discord)
- `index.html` (UI principale)
- `viewer.html` (viewer)
- `positioner.html` (éditeur de positions)
- `styles.css` (styles partagés)

### Legacy / non branchés directement par les pages actuelles

- `viewer.js`
- `script.js`
- `positioner.js`

Ces fichiers existent mais les pages principales embarquent aujourd’hui majoritairement leur logique en script inline.
Ils peuvent servir de base de refactor (externalisation JS), mais ne sont pas la source de vérité d’exécution actuelle.

---

## 6) Données disque

- `images/<hashUser>/<state>/...` : assets uploadés
- `meta/<hashUser>.json` : ordre des frames
- `meta/<hashUser>_config.json` : config audio utilisateur

---

## 7) Variables d’environnement

- `DISCORD_TOKEN` : token bot Discord
- `USER_HASH_SECRET` : secret HMAC (généré si absent)
- `LEVELS_PORT` : port HTTP local (défaut `3000`)

---

## 8) Vérification effectuée (passe Copilot)

- Diagnostic VS Code: aucune erreur remontée.
- Vérification syntaxe backend: `node --check index.js` OK.
- Correctif appliqué sur `/known-users` :
    - déduplication des utilisateurs persistés corrigée,
    - comparaison directe sur token/hash pour éviter les faux doublons.

---

## 9) Recommandations de maintenance

1. Choisir une seule stratégie JS côté front (`inline` ou `fichiers externes`) pour réduire la dette de maintenance.
2. Ajouter un script `npm` de validation rapide (ex: `node --check index.js`).
3. Si exposition réseau: ajouter auth HTTP et restrictions CORS.
4. Prévoir une migration explicite des clés `localStorage` si le format évolue.

---

## 10) Build Windows (`.exe` + installateur + raccourci)

### 10.1 Générer l’exécutable

```bash
npm run build:exe
```

(`pkg` utilise la cible `node18-win-x64` dans ce projet.)

Sortie: `dist/pngtuber-bot.exe`

### 10.2 Générer l’installateur

Pré-requis: **Inno Setup 6** installé sur Windows.

```bash
npm run build:installer
```

Sortie: `dist/pngtuber-bot-setup.exe`

### 10.3 Build complet

```bash
npm run build:all
```

Produit les 2 exécutables:

- `dist/pngtuber-bot.exe` (app)
- `dist/pngtuber-bot-setup.exe` (installateur)

### 10.4 Comportement au lancement

Au démarrage de l’app, le serveur ouvre automatiquement dans le navigateur par défaut:

- `http://localhost:<LEVELS_PORT>/index.html`

Pour désactiver cette ouverture auto:

- variable d’environnement `PNGTUBER_NO_BROWSER=1`
