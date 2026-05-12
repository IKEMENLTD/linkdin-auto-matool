import "server-only";
import { z } from "zod";

/**
 * URN mismatch detector (純関数 / 設計書 §12 安全層 / §17 監査基盤)。
 *
 * 目的:
 *   送信ログ (messages) と意図 (leads.linkedinUrl) から期待 public_id を導出し、
 *   送信先 (Unipile) から取得した actual public_id と照合する。
 *
 * 「意図と異なる相手への DM 送信」(URN mismatch) は本システムにおける
 *   最も致命的なインシデント (severity = critical)。
 *   この関数は副作用を持たない pure function とし、I/O は呼び出し側で行う。
 */

export interface DetectMismatchInput {
  /** lead.linkedinUrl から抽出した期待 public identifier */
  readonly expectedPublicId: string | null;
  /** Unipile から取得した実際の送信先 public identifier */
  readonly actualPublicId: string | null;
  /** 期待 URN (urn:li:fsd_profile:XXXX) — 存在する場合のみ追加検証 */
  readonly expectedUrn?: string | null;
  /** 実際の URN */
  readonly actualUrn?: string | null;
}

export type MismatchReason =
  | "public_id_mismatch"
  | "urn_mismatch"
  | "missing_expected"
  | "missing_actual";

export type MismatchResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly expected: string | null;
      readonly actual: string | null;
      readonly severity: "critical" | "warning";
      readonly reason: MismatchReason;
    };

/**
 * https://www.linkedin.com/in/<public_id>/ から public_id を抽出する。
 */
export function extractPublicIdFromUrl(
  linkedinUrl: string | null | undefined
): string | null {
  if (!linkedinUrl) return null;
  const trimmed = linkedinUrl.trim();
  if (trimmed.length === 0 || trimmed.length > 512) return null;

  const match = trimmed.match(/\/in\/([A-Za-z0-9\-_%]+)/);
  const raw =
    match?.[1] ??
    trimmed.split("?")[0].split("#")[0].replace(/\/+$/, "").split("/").pop();
  if (!raw) return null;

  try {
    const decoded = decodeURIComponent(raw).toLowerCase();
    if (!/^[a-z0-9\-_]{1,100}$/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export const publicIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9\-_]+$/, "invalid public_id format");

export const urnSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^urn:li:[a-zA-Z_]+:[A-Za-z0-9_\-]+$/, "invalid URN format");

/**
 * URN / public_id mismatch を検出する。
 *
 *   - `{ ok: true }`                              : 一致 (正常)
 *   - `{ ok: false, severity: 'critical', ... }`  : 両方存在し不一致
 *   - `{ ok: false, severity: 'warning', ... }`   : 片方が欠落 (検証不能)
 *
 *   critical のみ global halt 発火対象。
 */
export function detectMismatch(input: DetectMismatchInput): MismatchResult {
  const expected = input.expectedPublicId?.toLowerCase().trim() || null;
  const actual = input.actualPublicId?.toLowerCase().trim() || null;

  if (!expected) {
    return {
      ok: false,
      expected: null,
      actual,
      severity: "warning",
      reason: "missing_expected",
    };
  }

  if (!actual) {
    return {
      ok: false,
      expected,
      actual: null,
      severity: "warning",
      reason: "missing_actual",
    };
  }

  if (expected !== actual) {
    return {
      ok: false,
      expected,
      actual,
      severity: "critical",
      reason: "public_id_mismatch",
    };
  }

  if (input.expectedUrn && input.actualUrn) {
    const expectedUrn = input.expectedUrn.trim();
    const actualUrn = input.actualUrn.trim();
    if (expectedUrn !== actualUrn) {
      return {
        ok: false,
        expected: expectedUrn,
        actual: actualUrn,
        severity: "critical",
        reason: "urn_mismatch",
      };
    }
  }

  return { ok: true };
}
