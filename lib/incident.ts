import { randomBytes, randomUUID } from "node:crypto";

/**
 * incident_id (INC-YYYY-XXXXXX) と correlation_id の発行。
 * 設計書 §12.3.1 / §24 に準拠。
 *
 * - INC は人間可読 6 hex chars (= 16,777,216 通り) を crypto 乱数から生成し
 *   1日100件発生でも年間 ~36500 件で誕生日衝突は ~3.7% 程度に抑える。
 *   本番ではここを DB シーケンス (INC-YYYY-NNNN) に置換予定。
 */
export function newIncidentId(): string {
  const year = new Date().getUTCFullYear();
  // 8 hex chars (= 4_294_967_296 通り) で誕生日衝突を実用上 0 にする。
  // 本番では Phase2 で DB シーケンス (INC-YYYY-NNNN) に置換。
  const hex = randomBytes(4).toString("hex").toUpperCase();
  return `INC-${year}-${hex}`;
}

export function newCorrelationId(): string {
  return randomUUID();
}
