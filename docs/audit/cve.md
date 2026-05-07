# Audit CVE

> Date : 2026-05-07
> Branche : `feat/full-migration`
> Périmètre : `npm audit` racine + `client/` + analyse manuelle des deps obscures.

## Synthèse

`npm audit` remonte **10 vulnérabilités côté backend** (7 high, 3 moderate, 0 critical) et **3 vulnérabilités côté frontend** (3 moderate, dev-only). Toutes sont transitivement présentes via `discord.js` (chaîne `undici`, `prism-media`, `@discordjs/opus → @discordjs/node-pre-gyp → tar`) ou `vite` (chaîne `esbuild`/`postcss`). Aucune n'est exposée trivialement à un attaquant non authentifié sur le chemin de requête HTTP propre du projet, mais `undici` est utilisé par `discord.js` pour parler à l'API Discord et un attaquant capable de MITM cette connexion (improbable hors compromission du serveur) pourrait exploiter `GHSA-f269-vfmq-vjvj` (WebSocket parser overflow).

**Score global : 6/10** — pas de critical, mais 7 high transitives non patchées en l'état (`prism-media`/`@discordjs/opus`/`tar`) côté audio nécessitent soit un upgrade discord.js, soit un override `package.json`.

## Findings

### Critique

Aucun CVE critical (CVSS ≥ 9.0).

### Majeur (high — CVSS 7.0–8.9)

- **undici < 6.24.0** — multiple advisories — `node_modules/undici` (transitive via `discord.js`/`@discordjs/rest`)
  - GHSA-f269-vfmq-vjvj : Malicious WebSocket 64-bit length overflows parser, crashes client (CVSS 7.5)
  - GHSA-vrm6-8vpv-qv8q : Unbounded memory in WebSocket permessage-deflate (CVSS 7.5)
  - GHSA-v9p9-hfj2-hcw8 : Unhandled exception WebSocket (CVSS 7.5)
  - GHSA-g9mf-h72j-4rw9 : Unbounded decompression chain (CVSS 5.9)
  - GHSA-2mjp-6q6p-2qxm : HTTP request smuggling (CVSS 6.5)
  - GHSA-4992-7rv2-5pvq : CRLF Injection via `upgrade` (CVSS 4.6)
  - **Exploitabilité projet** : surface limitée (le bot ne fait pas de fetch sur des URL utilisateur) sauf si Discord est compromis, mais `discord.js` ouvre une WebSocket persistante vers `gateway.discord.gg`. **Fix disponible** : `npm install discord.js@latest` met undici à 6.24+.
- **lodash <= 4.17.23** — GHSA-r5fr-rjxr-66jc — Code injection via `_.template` imports (CVSS 8.1) + GHSA-f23m-r3pf-42rh — Prototype pollution (CVSS 6.5). Transitive via `@discordjs/voice` ou autres. **Fix** : `lodash@>=4.17.24`.
- **tar <= 7.5.10** — multiples GHSA path traversal & symlink (CVSS 7.1–8.8) — transitive via `@discordjs/opus → @discordjs/node-pre-gyp → tar`. **Exploitabilité** : tar n'est utilisé qu'au build (extraction de prebuilds opus) — un attaquant qui compromet npm registry ou GitHub Releases d'opus peut exécuter du code à l'install. Risque chaîne d'approvisionnement, pas runtime. **Fix indisponible** côté npm audit (`fixAvailable: false`) car `@discordjs/node-pre-gyp` épingle une vieille tar. **Reco** : utiliser `npm overrides` dans `package.json` :
  ```json
  "overrides": { "tar": ">=7.5.11" }
  ```
- **@discordjs/opus, prism-media, @discordjs/voice** — high transitive via tar ; pas de fix direct (`fixAvailable: false`). À surveiller — issue connue côté @discordjs.
- **@discordjs/node-pre-gyp** — high transitive via tar ; même remarque.

### Mineur (moderate — CVSS 4.0–6.9)

- **discord.js 14.0.0–14.25.1** — moderate via undici. Fix : `discord.js@latest`.
- **@discordjs/rest** — moderate via undici.
- **brace-expansion < 1.1.13** — GHSA-f886-m6hf-6m8v — DoS via zero-step sequence (CVSS 6.5). Fix : `brace-expansion@>=1.1.13`. Transitive (probablement via glob).

### Frontend (`client/`)

- **vite <= 6.4.1** — GHSA-4w7w-66w2-5vf9 — Path traversal `.map` (dev server). **Dev-only**, pas en production. Fix : `vite@8.0.11` (semver-major).
- **esbuild <= 0.24.2** — GHSA-67mh-4wv8-2f99 — Dev server CORS issue. **Dev-only**.
- **postcss < 8.5.10** — GHSA-qx2v-qp2m-jg93 — XSS via unescaped `</style>` dans le stringify output. Fix : `postcss@>=8.5.10`. Risque réel limité aux outils qui stringify du CSS attacker-controlled — non applicable au build classique Vite.

## Détail — analyse manuelle deps obscures

### `@snazzah/davey@^0.1.10`

- **Repo** : https://github.com/Snazzah/davey
- **Mainteneur** : Snazzah (contributeur Discord communautaire respecté, maintient discordjs-helpers)
- **Versions** : 0.1.8 (2025-11-17) → 0.1.9 (2025-12-19) → **0.1.10 (2026-03-02)** → 0.1.11 (2026-03-29)
- **Fonction** : implémentation E2EE Discord DAVE protocol (MLS) en Rust via napi-rs, requise par `@discordjs/voice` récent pour rejoindre les vocaux où le serveur a activé l'E2EE.
- **Publish dates récentes** = projet activement maintenu, et la version installée (0.1.10) date de mars 2026. Une version 0.1.11 (mars 2026) est dispo — recommander l'update.
- **CVE** : aucune publiée. Code Rust napi-rs, surface attaque très limitée (manipule des buffers de clés MLS).
- **Verdict** : 🟡 dépendance saine, à updater vers 0.1.11 par hygiène.

### `fft-js@^0.0.12`

- **Repo** : https://github.com/vail-systems/node-fft
- **Version** : 0.0.12, version `0.0.x` → projet historiquement non versionné en SemVer. **Pas d'update depuis ≥ 5 ans** (version 0.0.12 publiée vers 2018-2019).
- **Fonction** : FFT Cooley-Tukey en JS pur. Utilisé pour le pipeline audio (analyse fréquentielle 1024-point @ 48 kHz).
- **CVE** : aucune publiée, mais le code est petit (~150 lignes) et n'a pas reçu d'audit moderne.
- **Verdict** : 🟠 **abandonware**. Alternatives :
  - `dsp.js` — abandonné aussi.
  - `webfft` — wrapper sur WebAssembly FFT (kissfft, fftw). Plus rapide, maintenu.
  - Implémentation native Node via `Module.compile` ou WASM portage.
  - Plus simple : forker fft-js dans `src/utils/fft.js` (le fichier source fait < 200 lignes), figer la version, le maintenir nous-même.
- **Reco** : ne pas updater dans cette session (pas de CVE), mais planifier remplacement par `webfft` ou inlining.

## Détail — versions installées clés

| Package | Installée | Latest stable | Fix urgent ? |
|---|---|---|---|
| `discord.js` | 14.25.1 | check `npm view discord.js version` | Oui (undici) |
| `@discordjs/voice` | 0.19.0 | 0.19.0 (latest) | Lié à prism-media/opus, attendre upstream |
| `@discordjs/opus` | 0.10.0 | 0.10.0 (latest) | Bloqué par tar transitive |
| `@snazzah/davey` | 0.1.10 | 0.1.11 | Hygiène |
| `prism-media` | 1.3.5 | 1.3.5 (latest) | Bloqué par opus |
| `better-sqlite3` | 11.10.0 | 11.10.0+ | OK |
| `sharp` | 0.33.5 | 0.34.x | Update mineur recommandé |
| `sodium-native` | 4.3.3 | 4.3.3 | OK |
| `ws` | 8.19.0 | 8.18+ | OK |
| `dotenv` | 17.x | 17.x | OK |
| `fft-js` | 0.0.12 | 0.0.12 (abandonné) | Remplacer |

## Plan d'action priorisé

| Priorité | Action | Effort | Impact |
|----------|--------|--------|--------|
| P0 | `npm update discord.js @discordjs/rest` puis `npm install` | 5 min | -1 high (undici), -2 moderate |
| P0 | Ajouter `overrides` pour `tar`, `lodash`, `brace-expansion` dans `package.json` | 10 min | -3 high, -1 moderate |
| P1 | `npm update @snazzah/davey` (→ 0.1.11) | 2 min | hygiène |
| P1 | `npm update sharp` (→ 0.34) | 5 min + smoke test image upload | hygiène + perf |
| P1 | `npm audit fix --force` côté `client/` (Vite 5 → 8 = breaking) | 30 min + retest build | -3 moderate dev-only |
| P2 | Remplacer `fft-js` par `webfft` ou inlining local | 2 h | réduit dette dep abandonnée |
| P2 | Ajouter `npm audit --omit=dev` au pipeline build-deploy | 10 min | détection régression |
| P3 | Activer Renovate ou Dependabot sur le repo | 30 min | rolling update |

### Snippet `package.json` overrides recommandé

```json
{
  "overrides": {
    "tar": ">=7.5.11",
    "lodash": ">=4.17.24",
    "brace-expansion": ">=1.1.13",
    "undici": ">=6.24.0"
  }
}
```

Vérifier après `npm install` : `npm audit` doit tomber à 0 high sur le backend (les CVE `prism-media`/`opus` resteront flaggées tant que `@discordjs/node-pre-gyp` ne bouge pas, mais elles n'ont pas de chemin d'exploitation runtime).
