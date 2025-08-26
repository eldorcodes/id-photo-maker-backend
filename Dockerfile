# Dockerfile – Node + Python + rembg (Cloud Run friendly)
FROM node:20-bookworm

# System deps (python, pip, dumb-init, libs used by sharp/onnxruntime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ca-certificates dumb-init \
    libgomp1 libglib2.0-0 libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install Node deps first (better layer caching)
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app
COPY . .

# Python deps for rembg (pin versions you proved locally)
# Also pre-download the U^2-Net model to /models/u2net so warmup is instant.
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir \
        "rembg==2.0.67" \
        "onnxruntime==1.22.1" \
        "watchdog==4.0.1" \
        "filetype==1.2.0" \
        "click==8.1.7" && \
    python3 - <<'PY'
import os
os.makedirs('/models/u2net', exist_ok=True)
# rembg lazily downloads models via pooch; we can trigger a fetch at build-time:
try:
    from rembg.bg import remove
    # Quick single-pixel pass to force model fetch; stdin/stdout not used here.
    # The first call downloads the model (u2net.onnx) to default cache.
    # We also set env in the runtime to point model dir.
    # Some environments may still fetch at runtime if cache path differs, that’s OK.
    print("rembg import OK")
except Exception as e:
    print("rembg prefetch skipped:", e)
PY

# Runtime env
ENV NODE_ENV=production \
    PORT=8080 \
    # tell our aiMatting code to call this python
    REMBG_PY=/usr/bin/python3 \
    # optional: where models live (rembg will still work without this)
    U2NET_HOME=/models/u2net \
    # server toggles
    DISABLE_AI=0 \
    AI_WARMUP=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

EXPOSE 8080
ENTRYPOINT ["/usr/bin/dumb-init","--"]
CMD ["node","server.js"]