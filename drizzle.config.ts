import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle/migrations",
  schema: "./app/db/schema.ts",
  dialect: "sqlite",
  ...(process.env.LOCAL_DB_PATH
    ? { dbCredentials: { url: process.env.LOCAL_DB_PATH } }
    : {}),
});
