import { spawnSync } from "node:child_process";
import { getLocalD1DBPath } from "./lib/d1.js";

try {
  const dbPath = getLocalD1DBPath();
  console.log(`Starting Drizzle Studio with DB: ${dbPath}`);

  const result = spawnSync("pnpm", ["exec", "drizzle-kit", "studio"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, LOCAL_DB_PATH: dbPath },
  });

  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 0);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
}
