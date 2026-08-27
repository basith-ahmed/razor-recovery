/**
 * Fast database cleanup script.
 * Truncates all tables in the public schema (except migrations) using CASCADE.
 * Usage: npm run clean
 */

import { prisma } from "../config/prisma";

async function main() {
  console.log("Cleaning database...");

  // Get all tables in the public schema
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public';
  `;

  let cleanedCount = 0;

  for (const { tablename } of tables) {
    // We don't want to delete migration history
    if (tablename !== "_prisma_migrations") {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE;`);
      cleanedCount++;
    }
  }

  console.log(`Database cleaned successfully. Truncated ${cleanedCount} tables.`);
}

main()
  .catch((e) => {
    console.error("Failed to clean database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
