# scripts/deploy/

> Pipeline de build & deploy du PNGTuber Bot Discord.

## Fichiers

| Fichier | Rôle |
|---------|------|
| `build-deploy.sh` | Orchestrateur principal en 6 étapes (build → commit → GHCR → deploy local → health check). Voir [build-deploy.md](./build-deploy.md). |
| `config.sh` | Variables de configuration (paths, services Docker, GHCR, VPS). Voir [config.md](./config.md). |
| `PENDING_CHANGES.md` | (Attendu — non versionné) Fichier que l'utilisateur édite avant un deploy pour fournir le commit message. La 1ère ligne devient le titre du commit. Vidé automatiquement après commit. |

## Workflow standard

```bash
# 1. Éditer PENDING_CHANGES.md avec ce que tu as fait
#    (la 1ère ligne sera le commit message)

# 2. Lancer le pipeline (depuis Windows + Git Bash)
"C:\Program Files\Git\bin\bash.exe" -l -c "cd '/c/Users/glenn/Desktop/Code/hereborus-bot' && bash scripts/deploy/build-deploy.sh"
```

Ou directement :
```bash
cd /c/Users/glenn/Desktop/Code/hereborus-bot
bash scripts/deploy/build-deploy.sh
```

## Flags CLI

| Flag | Effet |
|------|-------|
| `--skip-build` | ⚠️ INTERDIT par règle Tojii (`feedback_no_skip_build.md`) — saute le build, déploie l'ancienne image |
| `--force-build` | Force le rebuild même si les images sont fraîches |
| `--skip-git` | Ne commit/push pas |
| `--skip-ghcr` | Ne push pas sur GHCR |

## Étapes

1. **Vérification Docker** — démarre Docker Desktop si besoin (Windows uniquement)
2. **Build Docker Compose** — saute si images fraîches (timestamp vs sources)
3. **Commit & Push Git** — extrait le titre depuis `PENDING_CHANGES.md`
4. **Push GHCR** — tag + push sur `ghcr.io/hereborus/bot-discord:latest`
5. **Deploy local** — `docker compose down && docker compose up -d`
6. **Health check** — statut container + grep "error" dans les logs

## Prérequis

- **Docker Desktop** installé et démarré (ou démarrable automatiquement).
- **`docker login ghcr.io`** déjà effectué avec un PAT GitHub (`write:packages`).
- **Git** configuré (le push utilise les credentials configurés).
- **`.env`** présent à la racine du projet (avec `LEVELS_PORT`, `DISCORD_TOKEN`, etc.).
- **`PENDING_CHANGES.md`** non vide à la racine de `scripts/deploy/`.

## TODO non activés

Le script comporte un bloc commenté (L187-199) pour le deploy SSH sur VPS distant. Non activé actuellement. La variable `DEPLOY_HOST` dans `config.sh` est définie mais inutilisée.

## Liens vers la doc des fichiers

- [build-deploy.md](./build-deploy.md) — détail des 6 étapes + audit complet
- [config.md](./config.md) — toutes les variables config + recommandations cross-OS

## Pièges connus / Audit

- 🔴 **Co-Authored-By hardcoded "Claude Sonnet 4.6"** dans build-deploy.sh — à mettre à jour vers Opus 4.7.
- 🟠 **`git add -A`** : peut commiter des fichiers sensibles → préférer la liste explicite.
- 🟠 **Health check faible** (juste grep "error") — un appel HTTP réel à `/status` serait plus fiable.
- 🟠 **`DEPLOY_HOST=root@154.16.229.45`** ne correspond à aucun serveur Tojii listé en MEMORY.md (probable typo).
- 🟡 **Hardcoded Windows path** pour Docker Desktop — non-portable.
- 🟡 **Port hardcoded `3350`** dans le résumé final (build-deploy.sh:181) — incohérent avec le défaut 3000.
