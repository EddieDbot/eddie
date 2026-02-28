FROM ubuntu:24.04 AS base
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip git bash procps coreutils socat \
    && rm -rf /var/lib/apt/lists/*

# Install Bun 1.3.8 system-wide (accessible to all users)
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s -- bun-v1.3.8

# Rename existing ubuntu user (uid 1000) to eddie to match host uid
RUN usermod -l eddie -d /home/eddie -m ubuntu && groupmod -n eddie ubuntu

# ---

FROM base AS app
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux ffmpeg xvfb xauth nodejs npm \
    libnss3 libgbm1 libasound2t64 \
    libatk-bridge2.0-0 libatk1.0-0 \
    libcups2t64 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libpangocairo-1.0-0 libpango-1.0-0 libcairo2 \
    libatspi2.0-0t64 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Dependency layers (cached separately)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY remotion/package.json remotion/package-lock.json ./remotion/
RUN cd remotion && npm ci

# Install Playwright Chromium browser binary
RUN npx playwright install chromium --with-deps

# Copy application source
COPY --chown=eddie:eddie . .

USER eddie
EXPOSE 3000 8443
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["bun", "run", "/app/src/index.ts"]

# ---

FROM ubuntu:24.04 AS ebpf
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    bpftrace socat \
    && rm -rf /var/lib/apt/lists/*

COPY ebpf/ /opt/ebpf/
RUN chmod +x /opt/ebpf/supervisor.sh 2>/dev/null || true

CMD ["/opt/ebpf/supervisor.sh"]
