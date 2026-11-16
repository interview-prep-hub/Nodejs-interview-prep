# syntax=docker/dockerfile:1
#
# SNIPPET, not executed by the course tools. A production-grade, multi-stage Dockerfile for a Node.js service.
# It assumes: package.json + package-lock.json at the project root, a "build" script that writes to dist/,
# and a server that listens on PORT (default 3000) and has /livez and /readyz endpoints (lesson 24, example 04).
#
#   Build : docker build -t orders-api:1.0.0 .
#   Run   : docker run --rm --init -p 3000:3000 --memory 512m --env-file .env.production orders-api:1.0.0
#
# Three stages. Only the last one becomes the image you ship. The first two are thrown away after the build.

# Pin the MAJOR version so a rebuild does not jump to a new Node release by surprise.
# For fully repeatable builds pin the image digest as well:  node:24-alpine@sha256:<digest>
ARG NODE_VERSION=24

############################ stage 1: production dependencies only ############################
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# (If a dependency compiles native code on Alpine, add here: RUN apk add --no-cache python3 make g++)

# LAYER CACHING: copy only the dependency files first. Docker reuses the cached result of the next
# instruction for as long as these two files are unchanged, so editing source code does not reinstall packages.
COPY package.json package-lock.json ./

# npm ci installs EXACTLY what the lockfile says and fails if package.json and the lockfile disagree.
# (npm install may rewrite the lockfile and drift. Do not use it in a build.)
# --omit=dev leaves out devDependencies. The cache mount keeps npm's download cache between builds
# without putting it in the image (needs BuildKit, which is the default in current Docker).
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

############################ stage 2: build (compile TypeScript, bundle, ...) ############################
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
# Source code comes AFTER the install, because it changes far more often than the dependencies.
COPY . .
RUN npm run build
# Skip this whole stage for plain JavaScript projects and copy the source in the runtime stage instead.

############################ stage 3: runtime ############################
FROM node:${NODE_VERSION}-alpine AS runtime

# tini is a tiny init program for PID 1: it passes SIGTERM on to node and cleans up zombie processes.
# The alternative is to start the container with `docker run --init` (or `init: true` in compose).
RUN apk add --no-cache tini

# Libraries read NODE_ENV. "production" turns on their production behaviour (caching, short errors).
# Node itself ignores it. Memory limits are NOT set here: they belong to the deployment, see below.
ENV NODE_ENV=production
WORKDIR /app

# Do not run as root. The official node images already contain a user called "node" (uid 1000).
# --chown makes the files belong to that user without an extra layer.
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node

EXPOSE 3000

# Docker's own health check. No curl in slim images, so use node itself (fetch is built in).
# NOTE: Kubernetes ignores HEALTHCHECK and uses its own probes. Docker alone never restarts an
# "unhealthy" container either; the status is for you, for compose (depends_on) and for Swarm.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/livez').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# EXEC FORM (a JSON array), never the shell form "CMD npm start":
#  - npm and the shell would sit between Docker and node, and they do not forward SIGTERM,
#    so docker stop waits 10 seconds and then SIGKILLs your server in the middle of a request.
#  - node server.js directly means node (behind tini) receives the signal and your handler runs.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

# ------------------------------------------------------------------------------------------------
# MEMORY. Containers are killed from outside when they pass their limit (exit code 137 = 128 + 9,
# SIGKILL, "OOMKilled"), with no JavaScript error at all. V8 has its own heap limit and reports
# "JavaScript heap out of memory" (exit code 134) when IT runs out first. Set the heap limit BELOW the
# container limit, because memory outside the heap also counts (Buffers, native code, thread stacks):
#
#   docker run --memory 512m -e NODE_OPTIONS=--max-old-space-size=384 ...
#
# A good starting point is about 75 percent of the container limit. Measure, then adjust.
# ------------------------------------------------------------------------------------------------
