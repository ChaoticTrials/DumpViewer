FROM node:24-alpine AS base
RUN apk add --no-cache tini \
    && addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /dumps \
    && chown -R appuser:appgroup /dumps

FROM base AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

FROM base AS build-backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM base
WORKDIR /app
ENV NODE_ENV=production
ENV DUMPS_DIR=/dumps
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build-backend /app/backend/dist ./dist
COPY --from=build-frontend /app/frontend/dist ./frontend/dist
RUN chown -R appuser:appgroup /app
VOLUME ["/dumps"]
EXPOSE 3001
USER appuser
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/index.js"]
