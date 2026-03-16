# Stage 1: Build frontend
FROM node:24-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

# Stage 2: Build backend
FROM node:24-alpine AS build-backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Stage 3: Runtime
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DUMPS_DIR=/dumps
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build-backend /app/backend/dist ./dist
COPY --from=build-frontend /app/frontend/dist ./frontend/dist
# Create non-root user and ensure /dumps is writable before declaring it as a volume
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && mkdir -p /dumps \
    && chown -R appuser:appgroup /app /dumps
VOLUME ["/dumps"]
EXPOSE 3001
USER appuser
CMD ["node", "dist/index.js"]
