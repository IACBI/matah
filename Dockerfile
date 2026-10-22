# syntax=docker/dockerfile:1

# Build the browser bundle and compile the TypeScript server in a reproducible
# stage that contains the full development toolchain.
# Digest-pinned: Dependabot's docker ecosystem (.github/dependabot.yml) refreshes it.
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --include=dev

COPY . .
RUN npm run build

# `.npmrc` includes development dependencies for hosted build services. Override
# that project setting here so the runtime image receives production packages.
RUN NPM_CONFIG_INCLUDE=prod npm prune --omit=dev


FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

# Root-owned and read-only to the runtime user: the process can read the code it
# runs but cannot rewrite it, so a compromised process cannot persist changes.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/server/src/index.js"]
