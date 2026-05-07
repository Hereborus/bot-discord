# Pin la version mineure pour la reproductibilite des builds.
# Met a jour periodiquement (ex: 22.13-alpine → 22.14-alpine quand un patch sort).
ARG NODE_VERSION=22.13-alpine

# ── Stage 1 : build frontend React ──────────────────────────────────
FROM node:${NODE_VERSION} AS frontend-build

WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm ci
COPY client/ ./
RUN npm run build
# Vite outDir: '../dist' → output dans /app/dist

# ── Stage 2 : build backend (modules natifs C++) ─────────────────────
FROM node:${NODE_VERSION} AS backend-build

RUN apk add --no-cache python3 make g++ gcc libc-dev vips-dev

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── Stage 3 : image finale runtime ───────────────────────────────────
FROM node:${NODE_VERSION}

# Dependances systeme runtime :
#  - libstdc++ : @discordjs/opus + sodium-native
#  - vips : sharp (image processing)
#  - tini : init PID 1, gere SIGTERM/SIGINT propre vers Node
#  - wget : HEALTHCHECK contre /status
RUN apk add --no-cache libstdc++ vips tini wget

# Cree un user non-root pour limiter le blast radius si une RCE survient.
# UID 10001 (>10000) evite collision avec users systeme.
RUN addgroup -S -g 10001 pngtuber \
 && adduser -S -u 10001 -G pngtuber pngtuber

WORKDIR /app

# Modules compilés + React buildé (chown pour que pngtuber puisse lire/ecrire)
COPY --from=backend-build --chown=pngtuber:pngtuber /app/node_modules ./node_modules
COPY --from=frontend-build --chown=pngtuber:pngtuber /app/dist ./dist

# Code source backend
COPY --chown=pngtuber:pngtuber package.json ./
COPY --chown=pngtuber:pngtuber index.js ./
COPY --chown=pngtuber:pngtuber src/ ./src/

# Pages OBS standalone + styles
COPY --chown=pngtuber:pngtuber styles.css viewer.html viewer.js ./

# Repertoire de donnees persistantes (volume mount typique)
RUN mkdir -p /app/data/images /app/data/meta /app/data/sessions \
 && chown -R pngtuber:pngtuber /app/data

ENV DATA_ROOT=/app/data
ENV PNGTUBER_NO_BROWSER=1
ENV NODE_ENV=production
ENV LEVELS_PORT=3000

EXPOSE 3000

# Healthcheck : /status repond 200 si l'app est vivante.
# 30s startPeriod : laisse le temps a l'init bot Discord + DB + audio.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- --tries=1 http://127.0.0.1:${LEVELS_PORT}/status || exit 1

USER pngtuber

# Tini comme PID 1 : propage SIGTERM correctement aux subprocess (npm/node).
# Sans tini, Ctrl+C ou docker stop peut laisser des handles orphelins.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
