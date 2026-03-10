# ── Stage 1 : build frontend React ───────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /app/client
COPY client/package.json client/package-lock.json* ./
RUN npm install

COPY client/ ./
# Build Vite → output dans /app/dist (configuré dans vite.config.js outDir: ../dist)
RUN npm run build

# ── Stage 2 : build backend (modules natifs C++) ──────────────────
FROM node:22-alpine AS backend-build

RUN apk add --no-cache python3 make g++ gcc libc-dev vips-dev

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ── Stage 3 : image finale runtime ───────────────────────────────
FROM node:22-alpine

# libstdc++ pour @discordjs/opus + sodium-native, vips pour sharp
RUN apk add --no-cache libstdc++ vips

WORKDIR /app

# Modules compilés depuis le stage backend
COPY --from=backend-build /app/node_modules ./node_modules

# Build React (dist/) depuis le stage frontend
COPY --from=frontend-build /app/dist ./dist

# Code source backend
COPY package.json ./
COPY index.js ./

# Modules ES backend (src/)
COPY src/ ./src/

# Pages standalone non-migrées (viewer OBS, positioner, styles)
COPY viewer.html positioner.html styles.css ./

# Répertoire de données persistantes
RUN mkdir -p /app/data/images /app/data/meta

ENV DATA_ROOT=/app/data
ENV PNGTUBER_NO_BROWSER=1
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "index.js"]
