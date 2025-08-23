# Dockerfile
FROM node:20-slim

# native deps for sharp (libvips) and a sane init
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates dumb-init libvips \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# install deps first (better layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# copy source
COPY . .

# env + process manager
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=8080

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]

EXPOSE 8080