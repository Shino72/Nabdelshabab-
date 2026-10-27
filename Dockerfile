# صورة تشغيل خفيفة. الاعتمادية الوحيدة: pg (اتصال PostgreSQL).
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 UPLOADS_DIR=/uploads
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /uploads && chown -R node:node /uploads
USER node
EXPOSE 3000
VOLUME ["/uploads"]
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "server.js"]
