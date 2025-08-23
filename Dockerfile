# Use Debian-based Node for easier native deps (sharp/libvips)
FROM node:20-slim

# Install system deps for sharp (libvips) and fonts (optional)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates dumb-init \
    libvips \
    && rm -rf /var/lib/apt/lists/*

# Create app dir
WORKDIR /usr/src/app

# Install deps first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app
COPY . .

# Environment (tune as desired)
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=8080

# Cloud Run sends SIGTERM; use dumb-init for proper signal handling
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the server
CMD ["node", "server.js"]

# Cloud Run will open PORT
EXPOSE 8080