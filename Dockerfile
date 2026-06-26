# Stage 1: Build Dependencies
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY server/package*.json ./server/
RUN cd server && npm ci
COPY . .
RUN npm run build

# Stage 2: Production Dependencies
FROM node:22-slim AS production-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Stage 3: Final Distroless Image
FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=production-deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY package.json ./

ENV DATA_DIR=/app/data
ENV NODE_ENV=production
ENV PORT=1610

EXPOSE 1610

CMD ["server/index.js"]
