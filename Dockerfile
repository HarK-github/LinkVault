# Production Dockerfile for LinkVault
FROM node:20-slim AS builder

WORKDIR /usr/src/app

# Install build dependencies required for native SQLite compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --only=production

# Final lightweight production image
FROM node:20-slim

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules with compiled native extensions
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

# Create uploads directory and set permissions
RUN mkdir -p uploads && chown -R node:node /usr/src/app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

CMD ["node", "server.js"]
