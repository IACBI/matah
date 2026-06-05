# --- Quibble: single-image build (server serves the built client) ---
FROM node:24-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install

# Build the client bundle.
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Render/Railway inject PORT; default to 3001 locally.
ENV PORT=3001
EXPOSE 3001

CMD ["npm", "start"]
