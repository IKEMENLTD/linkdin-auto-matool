/**
 * Server Action の戻り値型 + 初期 state を集約。
 * "use server" ファイルから外に出すため (use server は async 関数のみ export 可能)。
 *
 * 各 actions ファイルでも同じ type 名を re-export しているが、定数 (INITIAL_*) は
 * client コンポーネントが import する際にこのファイルから取得すること。
 */

// ===== auth =====
export type SignInState = {
  ok: boolean;
  message?: string;
  field?: "email" | "form";
  email?: string;
};
export const INITIAL_SIGN_IN_STATE: SignInState = { ok: false };

// ===== campaigns (bulk) =====
export type BulkActionState = {
  ok: boolean;
  affected: number;
  message?: string;
  resetSelection?: boolean;
};
export const INITIAL_BULK_STATE: BulkActionState = { ok: false, affected: 0 };

// ===== wizard =====
export type WizardActionState = {
  ok: boolean;
  message?: string;
  field?: string;
  draftId?: string;
  redirectTo?: string;
};
export const INITIAL_WIZARD_STATE: WizardActionState = { ok: false };

// ===== leads bulk =====
export type LeadBulkState = {
  ok: boolean;
  affected: number;
  message?: string;
  resetSelection?: boolean;
};
export const INITIAL_LEAD_BULK_STATE: LeadBulkState = { ok: false, affected: 0 };

// ===== conversation send =====
export type SendResult = {
  ok: boolean;
  messageId?: string;
  message?: string;
};
export const INITIAL_SEND_RESULT: SendResult = { ok: false };

// ===== connections =====
export type ConnectionActionState = { ok: boolean; message?: string };
export const INITIAL_CONNECTION_STATE: ConnectionActionState = { ok: false };

// ===== members =====
export type MemberActionState = { ok: boolean; message?: string };
export const INITIAL_MEMBER_STATE: MemberActionState = { ok: false };
