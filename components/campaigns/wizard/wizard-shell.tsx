"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { z } from "zod";
import {
  ArrowLeft,
  ArrowRight,
  Save,
  CheckCircle2,
  AlertCircle,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Stepper } from "./stepper";
import { StepObjective } from "./step-objective";
import { StepProduct } from "./step-product";
import { StepIcp } from "./step-icp";
import { StepMessage } from "./step-message";
import { StepDelivery, type AccountOption } from "./step-delivery";
import { WizardPreview } from "./wizard-preview";
import {
  STEPS,
  Step1Schema,
  Step2Schema,
  Step3Schema,
  Step4Schema,
  Step5Schema,
  type StepId,
  type WizardState,
} from "@/lib/wizard-schema";
import {
  saveDraft,
  launchCampaign,
  type WizardActionState,
} from "@/server/actions/wizard";
import { INITIAL_WIZARD_STATE } from "@/lib/action-state";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "linkdin:campaign-wizard:v1";

interface Props {
  accounts: AccountOption[];
  authenticated: boolean;
}

export function WizardShell(props: Props) {
  return (
    <React.Suspense fallback={<div className="card-solid p-5">読み込み中…</div>}>
      <WizardShellInner {...props} />
    </React.Suspense>
  );
}

function WizardShellInner({ accounts, authenticated }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const initialStep = clampStep(Number(sp.get("step") || 1));

  const [step, setStep] = React.useState<StepId>(initialStep);
  const [furthest, setFurthest] = React.useState<StepId>(initialStep);
  const [state, setState] = React.useState<WizardState>({});
  const [hydrated, setHydrated] = React.useState(false);
  const [draftId, setDraftId] = React.useState<string | undefined>();

  // localStorage 復元
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { state: WizardState; furthest?: StepId; draftId?: string };
        if (parsed.state) setState(parsed.state);
        if (parsed.furthest) setFurthest(clampStep(parsed.furthest));
        if (parsed.draftId) setDraftId(parsed.draftId);
      }
    } catch {}
    setHydrated(true);
  }, []);

  // URL → state 同期
  React.useEffect(() => {
    const fromUrl = clampStep(Number(sp.get("step") || 1));
    if (fromUrl !== step) setStep(fromUrl);
  }, [sp, step]);

  // step 変更で URL 更新
  const goStep = React.useCallback(
    (next: StepId) => {
      setStep(next);
      setFurthest((prev) => (next > prev ? next : prev));
      const params = new URLSearchParams(sp.toString());
      params.set("step", String(next));
      router.replace(`/campaigns/new?${params.toString()}`, { scroll: false });
    },
    [router, sp]
  );

  // ローカル保存 (debounce 1.5s)
  React.useEffect(() => {
    if (!hydrated) return;
    const handle = setTimeout(() => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ state, furthest, draftId })
        );
      } catch {}
    }, 1500);
    return () => clearTimeout(handle);
  }, [state, furthest, draftId, hydrated]);

  // バリデーション (この step が次へ進めるか)
  const stepErrors = React.useMemo<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    const tryParse = <T,>(schema: z.ZodType<T>, data: unknown) => {
      const r = schema.safeParse(data);
      if (r.success) return;
      for (const issue of r.error.issues) {
        const key = (issue.path[0] as string | undefined) ?? "_";
        if (!result[key]) result[key] = issue.message;
      }
    };
    if (step === 1) tryParse(Step1Schema, state.step1);
    if (step === 2) tryParse(Step2Schema, state.step2);
    if (step === 3) tryParse(Step3Schema, state.step3);
    if (step === 4) tryParse(Step4Schema, state.step4);
    if (step === 5) tryParse(Step5Schema, state.step5);
    return result;
  }, [step, state]);

  const canProceed = Object.keys(stepErrors).length === 0;

  return (
    <div className="space-y-6">
      <Stepper current={step} furthest={furthest} onJump={(s) => goStep(s)} />

      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <article className="card-solid p-5 lg:p-7">
          <header className="mb-5">
            <div className="text-[11px] font-medium tracking-[0.18em] uppercase text-[var(--color-brand-700)] mb-1">
              Step {step} / {STEPS.length}
            </div>
            <h2 className="font-display text-[22px] lg:text-[26px] font-bold tracking-tight text-ink-900 [color:var(--color-ink-900)]">
              {stepTitle(step)}
            </h2>
            <p className="text-[12px] text-ink-500 [color:var(--color-ink-500)] mt-1">
              {stepDescription(step)}
            </p>
          </header>

          <div>
            {step === 1 && (
              <StepObjective
                value={state.step1?.objective}
                onChange={(objective) => setState((p) => ({ ...p, step1: { objective } }))}
              />
            )}
            {step === 2 && (
              <StepProduct
                value={state.step2 ?? {}}
                errors={stepErrors}
                onChange={(partial) =>
                  setState((p) => ({
                    ...p,
                    step2: {
                      companyName: "",
                      productSummary: "",
                      strengths: [],
                      ...(p.step2 ?? {}),
                      ...partial,
                    },
                  }))
                }
              />
            )}
            {step === 3 && (
              <StepIcp
                value={state.step3 ?? {}}
                errors={stepErrors}
                onChange={(partial) =>
                  setState((p) => ({
                    ...p,
                    step3: {
                      jobTitles: [],
                      industries: [],
                      headcountMin: 10,
                      headcountMax: 10000,
                      regions: ["jp"],
                      funding: [],
                      customQuery: "",
                      ...(p.step3 ?? {}),
                      ...partial,
                    },
                  }))
                }
              />
            )}
            {step === 4 && (
              <StepMessage
                value={state.step4 ?? {}}
                companyName={state.step2?.companyName}
                errors={stepErrors}
                onChange={(partial) =>
                  setState((p) => ({
                    ...p,
                    step4: {
                      tone: "formal",
                      length: "medium",
                      connectMessage: "",
                      firstDm: "",
                      abEnabled: false,
                      abVariantB: "",
                      ...(p.step4 ?? {}),
                      ...partial,
                    },
                  }))
                }
              />
            )}
            {step === 5 && (
              <StepDelivery
                value={state.step5 ?? {}}
                accounts={accounts}
                errors={stepErrors}
                onChange={(partial) =>
                  setState((p) => ({
                    ...p,
                    step5: {
                      accountIds: [],
                      dailyLimit: 25,
                      startTime: "09:00",
                      endTime: "18:00",
                      weekdaysOnly: true,
                      reviewMode: "review_required",
                      startsAt: "",
                      consentPolicy: false,
                      ...(p.step5 ?? {}),
                      ...partial,
                    },
                  }))
                }
              />
            )}
          </div>

          {/* footer */}
          <footer className="mt-7 flex items-center justify-between gap-3 pt-4 border-t border-[var(--color-ink-100)]">
            <Button
              variant="ghost"
              onClick={() => step > 1 && goStep((step - 1) as StepId)}
              disabled={step === 1}
              type="button"
            >
              <ArrowLeft className="size-4" aria-hidden />
              戻る
            </Button>
            <div className="flex items-center gap-2">
              <DraftSaver state={state} draftId={draftId} authenticated={authenticated} onSaved={(id) => id && setDraftId(id)} />
              {step < 5 ? (
                <Button
                  type="button"
                  disabled={!canProceed}
                  onClick={() => canProceed && goStep((step + 1) as StepId)}
                >
                  次へ
                  <ArrowRight className="size-4" aria-hidden />
                </Button>
              ) : (
                <LaunchButton state={state} draftId={draftId} canProceed={canProceed} />
              )}
            </div>
          </footer>
        </article>

        <aside className="space-y-3">
          <WizardPreview state={state} accounts={accounts} />
        </aside>
      </div>
    </div>
  );
}

function DraftSaver({
  state,
  draftId,
  authenticated,
  onSaved,
}: {
  state: WizardState;
  draftId?: string;
  authenticated: boolean;
  onSaved: (id?: string) => void;
}) {
  const [saved, formAction] = useActionState<WizardActionState, FormData>(
    saveDraft,
    INITIAL_WIZARD_STATE
  );
  React.useEffect(() => {
    if (saved.ok && saved.draftId) onSaved(saved.draftId);
  }, [saved, onSaved]);

  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="state" value={JSON.stringify(state)} />
      {draftId && <input type="hidden" name="draftId" value={draftId} />}
      <DraftButton authenticated={authenticated} />
      {saved.message && (
        <span
          role={saved.ok ? "status" : "alert"}
          className={cn(
            "ml-2 inline-flex items-center gap-1 text-[11px]",
            saved.ok
              ? "text-[var(--color-success-700)]"
              : "text-[var(--color-danger-700)]"
          )}
        >
          {saved.ok ? (
            <CheckCircle2 className="size-3" aria-hidden />
          ) : (
            <AlertCircle className="size-3" aria-hidden />
          )}
          {saved.message}
        </span>
      )}
    </form>
  );
}

function DraftButton({ authenticated }: { authenticated: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" loading={pending}>
      <Save className="size-4" aria-hidden />
      {authenticated ? "下書きを保存" : "ローカル保存"}
    </Button>
  );
}

function LaunchButton({
  state,
  draftId,
  canProceed,
}: {
  state: WizardState;
  draftId?: string;
  canProceed: boolean;
}) {
  const [result, formAction] = useActionState<WizardActionState, FormData>(
    launchCampaign,
    INITIAL_WIZARD_STATE
  );
  return (
    <form
      action={formAction}
      className="inline-flex items-center gap-2"
      onSubmit={(e) => {
        if (!canProceed) {
          e.preventDefault();
          return;
        }
        if (!window.confirm("このキャンペーンをローンチします。よろしいですか？")) {
          e.preventDefault();
          return;
        }
        // ローンチ送信時点でローカル下書きはクリア (成功時 redirect で離脱)
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {}
      }}
    >
      <input type="hidden" name="state" value={JSON.stringify(state)} />
      {draftId && <input type="hidden" name="draftId" value={draftId} />}
      <LaunchSubmit disabled={!canProceed} />
      {result.message && !result.ok && (
        <span role="alert" className="inline-flex items-center gap-1 text-[11px] text-[var(--color-danger-700)]">
          <AlertCircle className="size-3" aria-hidden />
          {result.message}
        </span>
      )}
    </form>
  );
}

function LaunchSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled} loading={pending}>
      <Rocket className="size-4" aria-hidden />
      ローンチする
    </Button>
  );
}

function stepTitle(s: StepId): string {
  return ["", "目的を選んでください", "商品 / 会社情報", "ICP 定義", "メッセージ", "配信設定"][s] ?? "";
}

function stepDescription(s: StepId): string {
  switch (s) {
    case 1:
      return "本キャンペーンで何を達成したいか、最も近い目的を選んでください。";
    case 2:
      return "AI のメッセージ生成に使われる商品概要と会社情報を入力します。";
    case 3:
      return "誰に届けたいかを定義します。リーチが推定されます。";
    case 4:
      return "コネクト申請と初回 DM。AI に下書きさせ、必ず編集 / 確認してから次へ進めます。";
    case 5:
      return "担当アカウント、上限、レビューモード、開始日。配信前に同意が必要です。";
    default:
      return "";
  }
}

function clampStep(n: number): StepId {
  if (Number.isNaN(n)) return 1;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n as StepId;
}
