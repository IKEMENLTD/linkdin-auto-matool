"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Shield, UserX, CheckCircle2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fmtRelative } from "@/lib/formatters";
import { ROLE_LABEL, type Member } from "@/server/queries/members";
import {
  changeRole,
  deactivateMember,
  type MemberActionState,
} from "@/server/actions/members";
import { INITIAL_MEMBER_STATE } from "@/lib/action-state";
import type { Role } from "@/lib/auth";
import { cn } from "@/lib/utils";

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
];

interface Props {
  members: Member[];
  currentUserId: string | null;
  currentRole: Role | null;
}

export function MembersTable({ members, currentUserId, currentRole }: Props) {
  const [toast, setToast] = React.useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const canEdit = currentRole === "owner" || currentRole === "admin";

  return (
    <div className="card-solid overflow-hidden">
      <div className="hidden md:grid grid-cols-[1.6fr_140px_140px_120px_40px] gap-3 px-4 py-2.5 border-b border-[var(--color-ink-100)] bg-[var(--color-ink-50)]/60 text-[11px] font-medium tracking-[0.12em] uppercase text-ink-500 [color:var(--color-ink-500)]">
        <div>メンバー</div>
        <div>ロール</div>
        <div>状態</div>
        <div>参加</div>
        <div />
      </div>

      <ul className="divide-y divide-[var(--color-ink-100)]">
        {members.map((m) => {
          const isSelf = currentUserId === m.id;
          return (
            <li
              key={m.id}
              className="grid grid-cols-1 md:grid-cols-[1.6fr_140px_140px_120px_40px] gap-3 items-center px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span
                  aria-hidden
                  className="size-9 rounded-full bg-[linear-gradient(135deg,#BAE6FD,#0EA5E9)] text-white grid place-content-center text-[12px] font-bold"
                >
                  {m.name.slice(0, 2)}
                </span>
                <div className="min-w-0">
                  <div className="font-medium text-[13.5px] text-ink-900 [color:var(--color-ink-900)] truncate">
                    {m.name}
                    {isSelf && <span className="ml-2 text-[10px] text-ink-400 [color:var(--color-ink-400)]">(あなた)</span>}
                  </div>
                  <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] truncate font-mono tabular">
                    {m.email}
                  </div>
                </div>
              </div>
              <div>
                {canEdit && !isSelf ? (
                  <RoleChanger memberId={m.id} currentRole={m.role} onResult={setToast} />
                ) : (
                  <Badge tone="brand">
                    <Shield className="size-3" aria-hidden />
                    {ROLE_LABEL[m.role]}
                  </Badge>
                )}
              </div>
              <div>
                {m.isActive ? (
                  <Badge tone="success">アクティブ</Badge>
                ) : (
                  <Badge tone="neutral">無効化済</Badge>
                )}
              </div>
              <div className="text-[11px] text-ink-500 [color:var(--color-ink-500)] tabular font-mono">
                {fmtRelative(m.createdAt)}
              </div>
              <div className="flex justify-end">
                {canEdit && !isSelf && m.isActive && (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(confirmingId === m.id ? null : m.id)}
                    aria-label={`${m.name} を無効化`}
                    className="size-7 grid place-content-center rounded-full text-ink-500 hover:bg-[var(--color-danger-50)] hover:text-[var(--color-danger-700)] transition"
                  >
                    <UserX className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
              {confirmingId === m.id && (
                <div className="col-span-full md:col-start-1 md:col-end-6 mt-1">
                  <DeactivateForm
                    memberId={m.id}
                    memberName={m.name}
                    onClose={() => setConfirmingId(null)}
                    onResult={(s) => {
                      setToast({ kind: s.ok ? "success" : "error", text: s.message ?? "" });
                      if (s.ok) setConfirmingId(null);
                    }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {toast && (
        <div
          role={toast.kind === "success" ? "status" : "alert"}
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4"
        >
          <div
            className={cn(
              "flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium shadow-[var(--shadow-popover)] bg-white",
              toast.kind === "success"
                ? "border-[#A7F3D0] text-[var(--color-success-700)]"
                : "border-[#FECACA] text-[var(--color-danger-700)]"
            )}
          >
            {toast.kind === "success" ? (
              <CheckCircle2 className="size-4" aria-hidden />
            ) : (
              <AlertCircle className="size-4" aria-hidden />
            )}
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}

function RoleChanger({
  memberId,
  currentRole,
  onResult,
}: {
  memberId: string;
  currentRole: Role;
  onResult: (s: { kind: "success" | "error"; text: string }) => void;
}) {
  const [state, formAction] = useActionState<MemberActionState, FormData>(
    changeRole,
    INITIAL_MEMBER_STATE
  );
  const reported = React.useRef<MemberActionState | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reported.current === state) return;
    reported.current = state;
    onResult({ kind: state.ok ? "success" : "error", text: state.message });
  }, [state, onResult]);

  return (
    <form
      action={formAction}
      className="inline-flex"
      onSubmit={(e) => {
        const select = e.currentTarget.querySelector<HTMLSelectElement>("select[name=role]");
        const nextRole = (select?.value ?? currentRole) as Role;
        if (nextRole === currentRole) {
          e.preventDefault();
          return;
        }
        if (
          !window.confirm(
            `ロールを「${ROLE_LABEL[nextRole]}」に変更します。よろしいですか？`
          )
        ) {
          e.preventDefault();
          // 表示を元に戻す
          if (select) select.value = currentRole;
        }
      }}
    >
      <input type="hidden" name="userId" value={memberId} />
      <Select
        name="role"
        size="sm"
        defaultValue={currentRole}
        options={ROLE_OPTIONS}
        onChange={(e) => {
          const form = e.currentTarget.form;
          if (form) form.requestSubmit();
        }}
      />
    </form>
  );
}

function DeactivateForm({
  memberId,
  memberName,
  onClose,
  onResult,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
  onResult: (s: MemberActionState) => void;
}) {
  const [state, formAction] = useActionState<MemberActionState, FormData>(
    deactivateMember,
    INITIAL_MEMBER_STATE
  );
  const [text, setText] = React.useState("");
  const reported = React.useRef<MemberActionState | null>(null);
  React.useEffect(() => {
    if (!state.message) return;
    if (reported.current === state) return;
    reported.current = state;
    onResult(state);
  }, [state, onResult]);

  return (
    <form
      action={formAction}
      className="rounded-xl border border-[#FECACA] bg-[var(--color-danger-50)]/50 p-3 space-y-2"
    >
      <input type="hidden" name="userId" value={memberId} />
      <div className="text-[12px] font-medium text-[var(--color-danger-700)]">
        {memberName} を無効化します
      </div>
      <p className="text-[11px] text-ink-700 [color:var(--color-ink-700)] leading-relaxed">
        無効化するとサインインできなくなります。所有していたデータの移管 (退職者ハンドオフ) は Phase2 で対応。確認のため{" "}
        <code className="font-mono px-1.5 py-0.5 bg-white rounded text-[var(--color-danger-700)] border border-[#FECACA]">
          DEACTIVATE
        </code>{" "}
        と入力してください。
      </p>
      <Input
        name="confirm"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="DEACTIVATE"
        autoComplete="off"
        className="h-9 text-[13px] font-mono tabular"
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          キャンセル
        </Button>
        <DeactivateSubmit disabled={text.trim() !== "DEACTIVATE"} />
      </div>
    </form>
  );
}

function DeactivateSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        "inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-[var(--color-danger-500)] text-white text-[12px] font-medium hover:bg-[var(--color-danger-700)] transition",
        (pending || disabled) && "opacity-60 pointer-events-none"
      )}
    >
      {pending ? (
        <span className="size-3.5 rounded-full border-2 border-white border-r-transparent animate-spin" />
      ) : (
        <UserX className="size-3.5" aria-hidden />
      )}
      無効化
    </button>
  );
}
