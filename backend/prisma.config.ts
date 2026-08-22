import path from "node:path";
import dotenv from "dotenv";

// Load .env from the repo root (one level up from backend/)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.join(__dirname, "prisma", "migrations"),
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
