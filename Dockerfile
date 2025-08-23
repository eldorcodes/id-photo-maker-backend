# Dockerfile
FROM node:20-slim

# Install native dependencies for:
# - sharp (libvips)
# - onnxruntime-node (libgomp1)
# - sane init (dumb-init)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
    libvips \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY . .

# Environment and process manager
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=8080 \
    OMP_NUM_THREADS=1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]

EXPOSE 8080