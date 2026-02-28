BOT-DISCORD - README
=====================

Résumé
------
Ce dépôt contient un bot Discord qui analyse les flux audio en temps réel et expose des données (niveau RMS/dB, classification de statut, analyse fréquentielle et détection simple d'"émotion") via une API HTTP. Un widget côté client (OBS) consomme cette API pour afficher des images par utilisateur selon l'état audio (silent/low/medium/high) et des sous-états émotionnels (ex : scream/anger).

Composants
----------
- `index.js` : Back-end / bot Discord. Rejoint un canal vocal, décode Opus → PCM, calcule RMS/dB, exécute FFT pour analyse des bandes de fréquence et met à jour une Map en mémoire (`userLevels`). Expose une API HTTP (statique + endpoints).
- `obs-widget/viewer.html` + `obs-widget/viewer.js` : Widget de visualisation prêt pour OBS (affichage production). Récupère `/levels` et affiche images depuis `obs-widget/pnjtuber/`.
- `obs-widget/index.html` + `obs-widget/script.js` : Widget de contrôle / développement. Permet d'uploader/tester temporairement des images via UI.
- `obs-widget/style.css` : Styles partagés pour widgets.
- `obs-widget/pnjtuber/` : Emplacement attendu pour les images utilisateurs (voir section "Arborescence d'images").
- `DOCUMENTATION.md` : Documentation technique complémentaire.

Prérequis
---------
- Node.js (v18+ recommandé)
- Un bot Discord (token) avec permissions: `Connect`, `Speak`, `View Channel`, `Read Messages`, `Send Messages`.
- Les paquets sont listés dans `package.json` ; installer via `npm install`.

Installation
------------
1. Cloner le dépôt et se placer dans le dossier :

   ```powershell
   cd C:\Users\<you>\Desktop\bot-discord
   npm install
   ```

2. Créer un fichier `.env` à la racine avec :

   ```text
   DISCORD_TOKEN=<votre_token_de_bot>
   LEVELS_PORT=3000    # optionnel (3000 par défaut)
   ```

3. Vérifier que les dépendances sont installées : `npm ls --depth=0`.

Exécution (développement)
-------------------------
- Démarrer le bot (exécute le serveur HTTP et le client Discord) :

  ```powershell
  node index.js
  ```

- Le serveur HTTP sert les fichiers statiques du dossier `obs-widget/` et expose les endpoints décrits ci-dessous.

Endpoints HTTP
--------------
- `GET /levels`  : Retourne JSON contenant `_bot` (métadonnées de connexion) et une entrée par `userId` avec `{ rms, db, status, freq, emotion, updated }`.
- `GET /status`  : Retour rapide de l'état du bot `{ botConnected, connectedGuildId, connectedChannelId, usersListening, timestamp }`.
- `GET /config`  : Retourne la configuration audio (thresholds, sampleInterval, durationWindow).
- Static files : `viewer.html`, `viewer.js`, `index.html`, `script.js`, `style.css`, etc. sont disponibles via le serveur (ex: `http://localhost:3000/viewer.html`).

Exemple de réponse `/levels` :
```json
{
  "_bot": { "connected": true, "guildId": "...", "channelId": "...", "updatedAt": "2026-02-28T..." },
  "123456789012345678": { "rms": 0.012, "db": -38.5, "status": "medium", "freq": {"low":0.12, "mid":0.33, "high":0.22}, "emotion": null, "updated": 167... }
}
```

Commandes Discord
-----------------
- `!join` : Le bot rejoint le canal vocal de l'utilisateur qui a envoyé la commande. Il commence alors l'analyse audio.
- `!disconnect` : Déconnexion manuelle du bot du canal vocal et nettoyage des données en mémoire.
- `!status` : Affiche l'état courant du bot (connexion, canal, nombre d'utilisateurs suivis).

Architecture audio (résumé)
---------------------------
- Le bot utilise `@discordjs/voice` pour se connecter et obtenir un `receiver`.
- Pour chaque utilisateur qui parle, on `subscribe()` à son flux Opus, on le décodé via `prism.opus.Decoder` en PCM 16-bit.
- Les échantillons PCM sont accumulés pour calculer le RMS et convertir en dB toutes les `sampleInterval` (200ms par défaut).
- Un rolling-window de `durationWindow` (1000ms) est utilisé pour lisser les valeurs.
- Si suffisamment d'échantillons sont disponibles (>=1024), on effectue une FFT (`fft-js`) pour obtenir l'énergie par bande (low/mid/high). Une règle simple déduit une émotion (`scream` vs `anger`) quand le statut est `high` selon la bande dominante.

Arborescence d'images attendue (obs-widget/pnjtuber)
-----------------------------------------------------
Le viewer produit les chemins d'images attendus suivants :

obs-widget/pnjtuber/user{N}/{status}/{image}

Exemples de fichiers à fournir :

- `obs-widget/pnjtuber/user1/silent/on.png`   (yeux ouverts)
- `obs-widget/pnjtuber/user1/silent/off.png`  (yeux fermés)
- `obs-widget/pnjtuber/user1/low/low.png`
- `obs-widget/pnjtuber/user1/medium/medium.png`
- `obs-widget/pnjtuber/user1/high/scream.png`  (si emotion scream)
- `obs-widget/pnjtuber/user1/high/anger.png`   (si emotion anger)

Le viewer choisit `status` sauf pour `high` où il essaie `emotion` puis `high`.

Utilisation dans OBS
--------------------
1. Dans OBS, ajouter une "Browser" source.
2. Pour l'URL mettez (exemple) : `http://localhost:3000/viewer.html` ou `http://<HOST_IP>:3000/viewer.html`.
3. Ajuster la largeur/hauteur pour correspondre au CSS (le viewer est responsive).
4. Si vous utilisez `viewer.js` par défaut, placez les images dans `obs-widget/pnjtuber/` comme indiqué.

Widget de développement vs Widget de production
-----------------------------------------------
- `obs-widget/index.html` + `script.js` : Interface de contrôle pour uploader/tester des images via le navigateur. Utile en développement.
- `obs-widget/viewer.html` + `viewer.js` : Widget épuré destiné à être affiché dans OBS ; il lit les images directement depuis le disque (structure `pnjtuber`).

Bonnes pratiques & tests
------------------------
- Testez d'abord en local : lancez `node index.js`, ouvrez `http://localhost:3000/index.html` pour le panneau de contrôle ou `viewer.html` pour la vue finale.
- Assurez-vous qu'au moins un utilisateur (non-bot) rejoint le canal vocal pour générer des données dans `/levels`.
- Si `/levels` retourne `{}` : cela signifie qu'aucun utilisateur parlant n'a été capturé, ou que le bot n'est pas connecté au vocal.

Dépannage rapide
----------------
- `Receiver non disponible` : Vérifiez version de `@discordjs/voice` et autorisations du bot.
- `Image not found` dans le viewer : vérifiez l'arborescence `pnjtuber` et les noms de fichiers.
- Problèmes de permission d'accès au vocal : accordez au bot les permissions `Connect` et `Speak` et `Read/Send Messages`.

Sécurité et déploiement
-----------------------
- Ne partagez jamais votre `DISCORD_TOKEN` publiquement.
- En production, lancer sous PM2 / systemd et exposez l'URL du viewer sur une interface accessible par OBS (ou via tunnel local si besoin).

Contributions
-------------
Toute contribution est la bienvenue : ouvrir une issue pour bugs/fonctionnalités ou soumettre un pull request avec des tests et une description claire.

Fichier utiles
--------------
- `index.js` : bot & API (backend)
- `obs-widget/viewer.html` : widget production
- `obs-widget/viewer.js` : logique UI production
- `obs-widget/index.html` + `obs-widget/script.js` : panneau de contrôle (dev)
- `obs-widget/style.css` : styles partagés
- `obs-widget/pnjtuber/` : dossier images à peupler
- `DOCUMENTATION.md` : details techniques supplémentaires

Licence
-------
Aucune licence explicite fournie. Ajoutez un fichier `LICENSE` si vous souhaitez en spécifier une.

Support
-------
Si tu veux, je peux :
- Ajouter un script d'initialisation pour créer l'arborescence d'images et des placeholders PNG.
- Ajouter un petit `README.html` ou `README.md` au format Markdown.

---
Fait : README.txt créé à la racine. Si tu veux une version en `README.md` (Markdown) ou une traduction anglaise, je peux la générer aussi.
