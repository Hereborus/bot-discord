# Documentation du bot Discord (index.js)

Ce document explique en détail le fonctionnement de `index.js`, les points de configuration, les endpoints HTTP disponibles, et la structure du widget OBS.

## 1. Configuration générale

Le bot utilise les variables d'environnement via `dotenv` (fichier `.env`). La principale variable requise est :

```bash
DISCORD_TOKEN=<token_du_bot>
LEVELS_PORT=3000          # optionnel, port HTTP pour les endpoints
```

Une configuration audio est exposée dans le code sous la forme de la constante `AUDIO_CONFIG` :

```js
const AUDIO_CONFIG = {
    thresholds: {
        low: -50, // dB en-dessous duquel l'état est "low" (faible)
        medium: -30,
        high: -15,
    },
    durationWindow: 1000, // fenêtre mobile en ms pour moyennage
    sampleInterval: 200, // fréquence de calcul en ms
};
```

Ces valeurs déterminent comment le volume reçu est traduit en statut (`silent`, `low`, `medium`, `high`). Le système garde les échantillons dB des dernières `durationWindow` millisecondes, puis calcule leur moyenne pour atténuer les pics rapides (une personne qui crie longtemps reste dans un état "high").

La configuration est loguée au démarrage dans la console et exposée via `GET /config`.

## 2. Démarrage du client Discord

```js
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});
```

Ces intentions sont nécessaires pour écouter les messages (`!join`) et suivre les états vocaux.

L'événement `clientReady` déclenche un log au moment où le bot est prêt.

## 3. Commande `!join`

Lorsqu'un utilisateur envoie `!join` dans un salon texte :

1. Le bot vérifie que l'utilisateur est dans un salon vocal. Sinon, il répond.
2. Il appelle `joinVoiceChannel(...)` pour se connecter.
3. Si la connexion possède un `receiver`, il attache deux écouteurs :
    - `speaking.start`: succède quand un utilisateur commence à parler.
    - `speaking.end`: déclenché quand il cesse.
4. Sur `start`, le bot s'abonne au flux Opus de l'utilisateur via `receiver.subscribe(userId, {...})`.
5. Le flux est décodé en PCM via `prism-media` et un décodeur Opus natif (`@discordjs/opus`).
6. Les échantillons PCM sont agrégés en RMS, convertis en dB, puis stockés dans un historique pour moyennage.
7. Tous les `sampleInterval` (200 ms par défaut), le code calcule la moyenne des dB du dernier `durationWindow`, détermine le statut et met à jour `userLevels`.
8. En cas d'erreur ou de fin de flux, le flux et le décodeur sont nettoyés.

Sur `end`, l'état de l'utilisateur est remis à `silent`.

## 4. Gestion des déconnexions

Le listener `voiceStateUpdate` vérifie s'il n'y a plus que des bots dans le salon vocal où se trouve le bot. Si aucun membre humain ne reste, le bot attend 5 s puis quitte automatiquement.

## 5. Endpoints HTTP

Le bot embarque un serveur HTTP (port 3000 par défaut) qui expose :

- `GET /levels` – renvoie un objet JSON de la forme `{ userId: { rms, db, status, updated } }`.
- `GET /config` – renvoie la configuration audio (`AUDIO_CONFIG`).

Le serveur supporte le CORS sur `/levels` pour permettre à un widget OBS ou autre page de le consommer.

Il sert aussi statiquement le contenu de `obs-widget/` afin de publier le widget directement depuis le bot (cf. section suivante).

## 6. Widget OBS intégré

Le dossier `obs-widget/` contient une mini-application web :

- `index.html` – point d'entrée.
- `style.css` – styles visuels simples.
- `script.js` – logique de récupération périodique de `/levels` et rendu par utilisateur.

Cette page peut être utilisée comme source navigateur dans OBS :

```text
file:///chemin/vers/bot-discord/obs-widget/index.html?sourceUrl=http://localhost:3000/levels&poll=200
```

Paramètres via query string :

- `sourceUrl` – URL du service de niveaux (par défaut localhost).
- `poll` – intervalle de requête en ms.
- `map` – JSON encodé URL pour associer des noms lisibles aux IDs Discord.

Le widget crée une carte par utilisateur actif et met à jour leur statut (`silent`/`low`/`medium`/`high`) avec un marquage visuel. Il conserve une liste de noms dynamiquement et supprime les utilisateurs inactifs au bout de 10 s.

Les images personnalisées et l'upload sont délégués à l'utilisateur via son propre HTML/JS ; le serveur ne gère pas encore d'uploads.

## 7. Hébergement statique

Le code définit la fonction `serveStatic(req,res)` qui tente de servir un fichier depuis `obs-widget/`. Si le chemin correspond à un dossier, il renvoie `index.html`. Cette logique est utilisée au démarrage du serveur HTTP.

## 8. Points de configuration visibles

- `AUDIO_CONFIG` est imprimée à la console.
- `/config` permet aux clients (widget ou autre) d'inspecter les seuils et fenêtre.

## 9. Notes opérationnelles

1. **Packages requis** : `discord.js@^14`, `@discordjs/voice`, `@discordjs/opus`, `dotenv`, `prism-media`, `@snazzah/davey`.
2. **CORS** : activé pour `/levels` pour compatibilité OBS.
3. **Sécurité** : aucun mécanisme d'authentification HTTP n'est en place (autant le widget que les endpoints sont publics). Si le bot est exposé sur Internet, sécuriser est impératif.
4. **Extensions futures** :
    - Endpoint d'upload pour images par état.
    - Auth via token ou commande Discord pour restreindre l'upload.
    - Persistances des images sur disque et nouvelle version du widget qui utilise ces URLs.

---

Ce document et le code contiennent des commentaires supplémentaires pour faciliter la compréhension. N'hésite pas à me demander si tu as besoin de précisions sur un bloc particulier ou sur la logique d'analyse audio.
