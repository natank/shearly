# syntax=docker/dockerfile:1
# One image, two processes: Next standalone (web :3000) + bundled API (:4000).
# Matches design §10.3 Fargate shape at M0.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY libs ./libs
COPY tools ./tools
COPY tsconfig.base.json tsconfig.json nx.json eslint.config.mjs ./
RUN pnpm install --frozen-lockfile && pnpm rebuild esbuild
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec nx build web
RUN pnpm exec esbuild apps/api/src/main.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=dist/api.js

FROM node:22-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /app/dist/api.js ./api.js
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=25s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/health >/dev/null \
    && wget -qO- http://127.0.0.1:3000/en >/dev/null

ENTRYPOINT ["/entrypoint.sh"]
