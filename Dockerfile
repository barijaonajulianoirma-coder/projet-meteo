# syntax=docker/dockerfile:1

# ── Étape 1 : compilation (client Vite + serveur TypeScript) ──────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.server.json vite.config.ts index.html ./
COPY src ./src
COPY shared ./shared
COPY server ./server
COPY etl ./etl

RUN npm run build

# ── Étape 2 : exécution (dépendances de production uniquement) ───────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Dans le conteneur, écouter sur toutes les interfaces : l'isolation est assurée
# par le mappage de port de Docker. Publier avec -p 127.0.0.1:3000:3000.
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist-server/server/index.js"]
