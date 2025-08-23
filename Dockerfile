# Dockerfile
FROM node:20-slim

# Only what's needed: init + OpenMP for onnxruntime (even if AI is disabled)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Ensure sharp uses its bundled libvips (not any system copy)
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1

# Install deps first
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Runtime env
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PORT=8080 \
    OMP_NUM_THREADS=1 \
    OMP_WAIT_POLICY=PASSIVE \
    ORT_NUM_THREADS=1 \
    MALLOC_ARENA_MAX=2 \
    AI_WARMUP=0

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]

EXPOSE 8080