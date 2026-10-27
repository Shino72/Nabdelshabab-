# صورة تشغيل خفيفة. لا توجد مكتبات خارجية لتثبيتها (المشروع يعتمد على Node.js فقط).
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data UPLOADS_DIR=/uploads
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN mkdir -p /data /uploads && chown -R node:node /data /uploads
USER node
EXPOSE 3000
VOLUME ["/data", "/uploads"]
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
