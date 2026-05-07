# `build-deploy.sh`

> **Une ligne** : Pipeline de build & deploy en 6 étapes — vérifie Docker, build l'image, commit + push git via `PENDING_CHANGES.md`, push GHCR, relance le container local, health check.
> 📂 `scripts/deploy/build-deploy.sh`

## Résumé

Script bash de 199 lignes qui orchestre le déploiement complet. Source `config.sh` (voir `config.md`). Supporte 4 flags CLI :
- `--skip-build` : passe l'étape build
- `--force-build` : force le rebuild (sinon skip si images fraîches)
- `--skip-git` : passe le commit/push git
- `--skip-ghcr` : passe le push GHCR

Strict mode : `set -eo pipefail`.

⚠️ **Note importante (mémoire utilisateur)** : `--skip-build` est explicitement BANNI dans la mémoire Claude Code de Tojii (`feedback_no_skip_build.md`). Pourtant le flag existe ici par sécurité.

## Étapes (6 phases)

### 1/6 — Vérification Docker (L67-87)
**Brève** : Détecte si Docker tourne, sinon lance Docker Desktop sur Windows et attend jusqu'à 120s.
**Comportement** :
- `docker info >/dev/null 2>&1` → si OK, suite.
- Sinon, lance `$DOCKER_DESKTOP` (config.sh) et boucle 24×5s.
- Si toujours pas dispo après 120s → `exit 1`.
**Audit** : 🟢 Robuste. 🟡 Hard-coded sur Windows (Docker Desktop). 🟡 Pas de fallback Linux/macOS.

### 2/6 — Docker Compose Build (L89-102)
**Brève** : Build l'image si nécessaire.
**Comportement** :
- Si `--skip-build` → skip.
- Sinon `images_are_fresh()` (L51-65) compare le timestamp de l'image Docker au `mtime` le plus récent des sources.
- Si fraîches ET pas `--force-build` → skip avec message.
- Sinon : `cd $DOCKER_DIR && docker compose build`.
**Audit** :
- 🟢 Optimisation `images_are_fresh` évite des rebuilds inutiles.
- 🟡 Le `find` qui traverse le projet exclut bien `node_modules`, `.git`, `data` mais peut rater des fichiers (ex: `src/db/schema.sql`) — la liste d'extensions hardcodée (`*.js`, `*.html`, `*.css`, `*.json`, `Dockerfile`, `*.yml`) doit rester sync avec la réalité.

### 3/6 — Commit & Push Git (L104-131)
**Brève** : Lit `PENDING_CHANGES.md`, en extrait le 1er ligne comme commit message, push.
**Comportement** :
- Si `--skip-git` → skip.
- Si `git status --porcelain` est vide → warn et skip.
- Sinon : extrait `COMMIT_TITLE` du 1er line de `PENDING_CHANGES.md` (sans `## `).
- Si vide → `exit 1`.
- `git add -A` + `git commit -m "$COMMIT_TITLE\n\nCo-Authored-By: Claude Sonnet 4.6"`.
- Vide `PENDING_CHANGES.md` après commit.
- `git push origin <current-branch>`.
**Audit** :
- 🟠 **`git add -A`** : dangereux — peut ajouter des fichiers sensibles (.env, credentials) accidentellement créés. La mémoire utilisateur (note Bash safety) recommande explicitement de NE PAS utiliser `-A`.
- 🟠 Co-Authored-By : Claude **Sonnet 4.6** alors que la mémoire utilisateur indique Opus 4.7 actuel — string hardcodé obsolète.
- 🟡 Le `PENDING_CHANGES.md` est défini comme `$SCRIPT_DIR/PENDING_CHANGES.md` (= `scripts/deploy/PENDING_CHANGES.md`) — **inhabituel**. Tojii utilise typiquement `PENDING_CHANGES.md` à la racine du projet ou `v2/PENDING_CHANGES.md` (ex: Roma Bot V2 dans MEMORY.md).
- 🟢 Vide le PENDING après commit → workflow propre.

### 4/6 — Push GHCR (L133-149)
**Brève** : Tag l'image locale et push sur GitHub Container Registry.
**Comportement** :
- Si `--skip-ghcr` → skip.
- Vérifie que `LOCAL_IMG` existe.
- `docker tag $LOCAL_IMG $GHCR_IMAGE`
- `docker push $GHCR_IMAGE | tail -3`
**Audit** :
- 🟡 Suppose qu'un `docker login ghcr.io` est déjà fait — pas de check ni d'instructions.
- 🟢 Propre.

### 5/6 — Deploy local (L151-160)
**Brève** : Recrée le container local.
**Comportement** :
- `cd $DOCKER_DIR && docker compose down && docker compose up -d`.
**Audit** :
- 🟡 **Pas de stratégie blue/green ni rolling** : downtime ~5-10s entre `down` et `up -d`. Pour un bot Discord, acceptable (les utilisateurs voient juste une déco/reco vocal).

### 6/6 — Health check (L162-185)
**Brève** : Vérifie le statut du container et compte les erreurs des logs.
**Comportement** :
- `sleep 5` (attente démarrage).
- `docker inspect --format='{{.State.Status}}' $CONTAINER_NAME`.
- `docker logs $CONTAINER_NAME --since 10s | grep -ci "error|erreur"` → si > 5 → warn.
**Audit** :
- 🟡 **Health check naïf** : compte les occurrences de "error" — peut donner des faux positifs (ex: "no errors detected" comporte "error").
- 🟠 Pas d'appel HTTP réel à `/status` ou `/levels` — un container peut être "running" mais le serveur HTTP ne pas répondre.
- 🟢 La `sleep 5` est raisonnable pour un boot Node simple.

## Recap final (L177-185)
**Brève** : Affiche un résumé : Build OK, Git OK, GHCR OK, URL locale, suggestion `docker pull` pour serveur distant.

## Section TODO (L187-199)
**Brève** : Bloc commenté pour deploy SSH sur VPS — non activé.
**Audit** :
- 🟡 Code mort (commenté) — peut induire en erreur. Soit l'activer, soit le supprimer.

## Variables / fonctions clés

| Nom | Rôle |
|-----|------|
| `SKIP_BUILD`, `FORCE_BUILD`, `SKIP_GIT`, `SKIP_GHCR` | Flags CLI |
| `log_info`, `log_success`, `log_warn`, `log_error`, `log_step` | Helpers logging avec couleurs ANSI |
| `images_are_fresh()` | Compare `Created` de l'image vs mtime des sources |
| `SERVICES` (depuis config.sh) | Tableau `"nom\|image"` |
| `CONTAINER_NAME`, `DOCKER_DESKTOP`, `PROJECT_ROOT`, `DOCKER_DIR` | Config |
| `GHCR_IMAGE` | `ghcr.io/hereborus/bot-discord:latest` |

## Dépendances
- **Importe** : `config.sh` (source).
- **Utilisé par** : Tojii via `bash scripts/deploy/build-deploy.sh` (workflow manuel décrit dans MEMORY.md).
- **Tools requis** : `bash`, `docker`, `git`, `find`, `grep`, `sed`, `xargs`, `stat`, `date` (GNU date pour `-d`).

## Audit

| Sévérité | Issue | Recommandation |
|----------|-------|----------------|
| 🔴 | **Co-Authored-By: Claude Sonnet 4.6** hardcodé alors que l'utilisateur travaille avec Opus 4.7 | Mettre à jour la signature OU lire un env var `CLAUDE_VERSION` |
| 🟠 | **`git add -A`** peut commiter des fichiers sensibles | Lister explicitement les fichiers à add OU au minimum `git add -A && git status` avec confirmation |
| 🟠 | **Health check naïf** (juste compte "error" dans les logs) | Ajouter un appel HTTP : `curl -fsS http://localhost:$PORT/status \|\| log_error` |
| 🟠 | **Pas de check Pangolin** ni de SSH vers serveur final — script est juste local + GHCR | OK pour le scope actuel mais documenter clairement (vs skill `/deploy`) |
| 🟠 | Le bloc TODO commenté (L187-199) suggère une déploiement SSH à activer mais `DEPLOY_HOST="root@154.16.229.45"` (config.sh) ne correspond pas aux serveurs Tojii (VPS = 154.16.229.10) | Soit activer correctement, soit nettoyer |
| 🟡 | `PENDING_CHANGES.md` situé dans `scripts/deploy/` (chemin non-standard) | Standardiser à la racine ou documenter |
| 🟡 | `-eo pipefail` mais pas `-u` (variables non-définies) | Ajouter `set -euo pipefail` |
| 🟡 | Hardcoded port `3350` dans le résumé final (ligne 181) — ne correspond ni au défaut `3000` du backend ni au compose | Lire le port réel depuis `.env` plus systématiquement |
| 🟡 | `--skip-build` existe mais BANNI par la mémoire utilisateur | Ajouter un warning explicite quand utilisé : `log_warn "⚠ --skip-build INTERDIT par la règle Tojii"` |
| 🟢 | Strict mode + couleurs + steps numérotées → lisible |

## Notes alternatives

- Le script suit clairement le pattern Tojii (build-deploy.sh universel — voir `Roma Bot V2`, `Night Agent`, `Satisfactory Manager` dans MEMORY.md). Il est cohérent avec le reste de l'écosystème.
- Pour intégrer avec le skill `/deploy` : ajouter `--obsidian` flag pour logger dans Obsidian, et `--ssh-deploy` pour activer le push SSH.
- Considérer l'extraction des fonctions `log_*` dans un `scripts/lib/log.sh` partagé entre projets.
