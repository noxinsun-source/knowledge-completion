import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Start the bundled Vite runtime for local development, or configure your deployment platform to inject a D1 binding named `DB`."
    );
  }

  return drizzle(env.DB, { schema });
}
