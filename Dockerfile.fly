# ============================================================
# CreatiHub — Fly.io Dockerfile
# Fly gives a persistent volume for the JSON DB + custom domains.
# Deploy:  fly launch --no-deploy  then  fly deploy
# Docs:    https://fly.io/docs/
# ============================================================
FROM node:20-slim

WORKDIR /app

# Install only production deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy app source
COPY server.js db.js ai.js paystack.js ./
COPY public ./public
COPY data ./data

# The JSON DB lives on a mounted volume (see fly.toml) at /data
# We mount the volume to /data and symlink so the app's ./data points there.
RUN mkdir -p /data && cp -r data/* /data/ 2>/dev/null || true
RUN rm -rf /app/data && ln -s /data /app/data

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
