# syntax=docker/dockerfile:1

# Debian slim rather than Alpine on purpose: @temporalio/core-bridge is a native
# Rust addon whose prebuilt binaries target glibc. On musl the install either
# falls back to a source build (slow, needs a Rust toolchain) or fails outright.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only - the TypeScript compiler and test runner have no
# business in the shipped image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# node:22 images ship an unprivileged `node` user; use it rather than root.
USER node

EXPOSE 3000

# Both processes run from this image. Compose overrides the command for the
# worker, so there is exactly one artifact to build, tag and promote.
CMD ["node", "dist/api/server.js"]
