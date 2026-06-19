# ───────────────────────── build stage ─────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ───────────────────────── runtime stage ───────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Compiled app (the build step already copied schema.sql into dist/db)
COPY --from=build /app/dist ./dist

EXPOSE 3000

# The server applies the (idempotent) schema on boot before it starts listening.
CMD ["node", "dist/server.js"]
