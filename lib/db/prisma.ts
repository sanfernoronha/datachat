// lib/db/prisma.ts
//
// Singleton Prisma client for database access.
//
// Prisma 7 uses a client-side engine and requires an explicit database adapter.
// We use @prisma/adapter-pg (the official PostgreSQL adapter backed by the `pg` driver).
//
// Why a singleton?
//   Next.js dev server hot-reloads modules, which would create a new PrismaClient
//   (and a new connection pool) on every file change. We cache the client on
//   `globalThis` so it survives hot reloads in development. In production,
//   module-level caching is sufficient since there is no hot reload.

// Prisma 7 generates the client at the path specified in schema.prisma.
// The `output` path in schema.prisma is `../lib/generated/prisma` so the
// main client file lives at lib/generated/prisma/client.ts
import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Extend globalThis to hold our cached client (TypeScript-safe)
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set.");
  }

  // PrismaPg creates an internal pg connection pool.
  // The pool is lazily connected — no open socket until the first query.
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? createPrismaClient();

// Only cache in development — production functions are stateless
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
