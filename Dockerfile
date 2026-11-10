FROM node:22-bookworm AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4000

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

COPY backend/ ./
COPY --from=web-build /web/dist ./web/dist

RUN mkdir -p /app/data/producto-imagenes \
  && chown -R node:node /app

USER node
EXPOSE 4000
CMD ["node", "src/index.js"]
