import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 軽量 health check (UI/UX 設計書 §24.1 SLO の入口)。
 * 200: app + DB 健全 / 503: DB 接続不可。
 */
export async function GET() {
  const startedAt = Date.now();
  const db = getDb();
  let dbOk: boolean | null = db ? false : null;

  if (db) {
    try {
      await db.execute(sql`select 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
  }

  const body = {
    status: dbOk === false ? "degraded" : "operational",
    services: {
      web: "operational",
      db: dbOk === null ? "not_configured" : dbOk ? "operational" : "down",
    },
    region: process.env.NEXT_PUBLIC_REGION ?? "jp",
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
    latencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: dbOk === false ? 503 : 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex",
    },
  });
}
