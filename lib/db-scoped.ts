import "server-only";
import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { getDb, schema } from "@/db/client";
import { requireSession, type Session } from "@/lib/auth";

type Schema = typeof schema;
export type Tx = PgTransaction<PostgresJsQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

/**
 * org_id を強制するトランザクション境界。
 *
 * - Postgres GUC `app.org_id` を **トランザクション内**で `set_config(..., is_local=true)` 経由で
 *   立てる (autocommit / プール経由でのリーク防止)。
 * - RLS policy (`db/migrations/0001_rls_phase2.sql`) と組み合わせて自動的に org_id 絞り込み。
 *
 * 使い方:
 *   const rows = await withScopedDb(async ({ tx, session }) => {
 *     return tx.select().from(schema.leads); // RLS で自動的に自 org のみ
 *   });
 */
export async function withScopedDb<T>(
  fn: (ctx: { tx: Tx; session: Session; orgId: string }) => Promise<T>
): Promise<T> {
  const session = await requireSession();
  const db = getDb();
  if (!db) throw new Error("DB_NOT_CONFIGURED");

  return db.transaction(async (tx) => {
    // is_local=true で「このトランザクション内のみ」有効。
    await tx.execute(sql`select set_config('app.org_id', ${session.orgId}, true)`);
    return fn({ tx, session, orgId: session.orgId });
  });
}
