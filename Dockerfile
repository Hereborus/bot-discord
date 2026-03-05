# ── Build stage ──────────────────────────────────────────────────
FROM node:22-alpine AS build

# Dépendances système pour compiler @discordjs/opus + sodium-native (modules natifs C++)
RUN apk add --no-cache python3 make g++ gcc libc-dev vips-dev

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# ── Runtime stage ────────────────────────────────────────────────
FROM node:22-alpine

# libstdc++ nécessaire au runtime pour @discordjs/opus et sodium-native
RUN apk add --no-cache libstdc++ vips

WORKDIR /app

# Copier les modules compilés depuis le build stage
COPY --from=build /app/node_modules ./node_modules

# Copier le code source
COPY package.json ./
COPY index.js ./
COPY index.html viewer.html positioner.html client.html ./
COPY styles.css ./

# Répertoire de données persistantes
RUN mkdir -p /app/data/images /app/data/meta

ENV DATA_ROOT=/app/data
ENV PNGTUBER_NO_BROWSER=1
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "index.js"]
