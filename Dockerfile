# Dockerfile – Node + Python (venv) + rembg (Cloud Run friendly)
FROM node:20-bookworm

# System deps (python, pip/venv, dumb-init, libs used by sharp/onnxruntime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ca-certificates dumb-init \
    libgomp1 libglib2.0-0 libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Node deps first (cache-friendly)
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
COPY package*.json ./
RUN npm ci --omit=dev

# Copy app
COPY . .

# ---------- Python in a virtualenv (avoids PEP 668) ----------
# Create venv at /opt/venv and install pinned deps there
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir \
        rembg==2.0.67 \
        onnxruntime==1.22.1 \
        watchdog==4.0.1 \
        filetype==1.2.0 \
        click==8.1.7

# (Optional) pre-create model dir to cache on first run
RUN mkdir -p /models/u2net

# Runtime env
ENV NODE_ENV=production \
    PORT=8080 \
    REMBG_PY=/opt/venv/bin/python \
    U2NET_HOME=/models/u2net \
    DISABLE_AI=0 \
    AI_WARMUP=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

EXPOSE 8080
ENTRYPOINT ["/usr/bin/dumb-init","--"]
CMD ["node","server.js"]