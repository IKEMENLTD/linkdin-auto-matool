import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __pg__: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __pg_shutdown__: boolean | undefined;
}

function getClient() {
  if (!process.env.DATABASE_URL) return null;
  if (!globalThis.__pg__) {
    globalThis.__pg__ = postgres(process.env.DATABASE_URL, {
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idle_timeout: 20, // sec
      max_lifetime: 60 * 30, // 30 min
      connect_timeout: 10, // sec
      prepare: false, // Supabase pooler 経由では prepare 無効
      onnotice: () => {}, // 静粛化
    });

    // SIGTERM / SIGINT 時に接続をクリーンに閉じる (本番想定)
    if (!globalThis.__pg_shutdown__ && typeof process !== "undefined") {
      globalThis.__pg_shutdown__ = true;
      const shutdown = async () => {
        try {
          await globalThis.__pg__?.end({ timeout: 5 });
        } catch {}
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    }
  }
  return globalThis.__pg__;
}

export function getDb() {
  const client = getClient();
  if (!client) return null;
  return drizzle(client, { schema });
}

export { schema };
