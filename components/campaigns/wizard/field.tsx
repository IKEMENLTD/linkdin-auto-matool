import * as React from "react";

let counter = 0;
function nextId() {
  counter += 1;
  return `wz-field-${counter}`;
}

interface Props {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  counter?: string;
  children: (id: string, describedBy?: string) => React.ReactNode;
}

/**
 * ウィザード共通 Field コンポーネント。
 * 1 label = 1 control を保証し、aria-describedby でエラー / ヒントを紐付ける。
 */
export function Field({ label, hint, required, error, counter: counterText, children }: Props) {
  const id = React.useId();
  const inputId = `${id}-input`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, !error ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className="block">
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={inputId} className="text-[12px] font-medium text-ink-700 [color:var(--color-ink-700)]">
          {label}
          {required && (
            <span className="text-[var(--color-danger-700)] ml-0.5" aria-hidden>
              *
            </span>
          )}
          {required && <span className="sr-only"> (必須)</span>}
        </label>
        {counterText && (
          <span className="text-[10px] tabular font-mono text-ink-400 [color:var(--color-ink-400)]">
            {counterText}
          </span>
        )}
      </div>
      {children(inputId, describedBy)}
      {hint && !error && (
        <div id={hintId} className="mt-1 text-[11px] text-ink-500 [color:var(--color-ink-500)]">
          {hint}
        </div>
      )}
      {error && (
        <div id={errorId} role="alert" className="mt-1 text-[11px] text-[var(--color-danger-700)]">
          {error}
        </div>
      )}
    </div>
  );
}

// 互換のため counter export を維持 (未使用)
export const _stableCounter = () => counter || nextId();
