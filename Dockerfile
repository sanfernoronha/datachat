# ── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Generate Prisma client (needed at build time for imports)
RUN npx prisma generate
# Provide dummy env vars so Next.js can collect page data at build time.
# These are NOT used at runtime — real values come from docker-compose environment.
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV SANDBOX_URL="http://localhost:8080"
RUN npm run build

# ── Stage 3: Production ─────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy standalone server (includes only the files Next.js needs to run)
COPY --from=builder /app/.next/standalone ./
# Static assets and public dir are not included in standalone — copy them
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Prisma: schema + migrations (needed for `prisma migrate deploy` at startup)
# and production node_modules for the Prisma CLI and pg driver
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Production dependencies (prisma CLI, pg driver, etc.)
COPY --from=deps /app/node_modules ./node_modules
# dotenv is a devDependency but prisma.config.ts imports it — copy from builder
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder /app/lib/generated ./lib/generated

# Entrypoint script
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create data directories (will be overlaid by Docker volumes)
RUN mkdir -p uploads checkpoints

EXPOSE 3000
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

ENTRYPOINT ["./docker-entrypoint.sh"]
