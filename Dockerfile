# syntax=docker/dockerfile:1

# Build the browser bundle and compile the TypeScript server in a reproducible
# stage that contains the full development toolchain.
FROM node:26-alpine AS build

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


FROM node:26-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3001

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/client/dist ./client/dist

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/dist/server/src/index.js"]
