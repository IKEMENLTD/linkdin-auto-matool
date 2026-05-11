# SRE レビュー — S05 キャンペーン作成 Wizard (r1)

- 対象ファイル群
  - `components/campaigns/wizard/wizard-shell.tsx` (orchestrator + localStorage + 2 form action)
  - `components/campaigns/wizard/stepper.tsx`
  - `components/campaigns/wizard/step-objective.tsx`
  - `components/campaigns/wizard/step-product.tsx`
  - `components/campaigns/wizard/step-icp.tsx`
  - `components/campaigns/wizard/step-message.tsx`
  - `components/campaigns/wizard/step-delivery.tsx`
  - `components/campaigns/wizard/wizard-preview.tsx`
  - `app/(app)/campaigns/new/page.tsx`
  - `server/actions/wizard.ts` (saveDraft / launchCampaign Server Actions)
  - `lib/wizard-schema.ts` (Zod schema + estimateReach + warmup cap)
  - 関連: `lib/audit.ts` / `lib/incident.ts` / `app/error.tsx` / `server/queries/accounts.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§12 / §15 / §17 / §24)
- 直前関連レビュー: `docs/reviews/s04-r3/sre.md` (96/100)
- レビュアー: SRE シニア
- 評価日: 2026-05-11 (production-mode: ON, READ-ONLY)

---

## 総合スコア: **91 / 100** (90+ 到達 ✅)

| 評価軸 | 配点 | 点 | 主所見 |
| --- | ---: | ---: | --- |
| 1. パフォーマンス | 20 | **17** | wizard-shell が "use client" で 5 step 全部を eager import (動的 import なし)。`<input type="hidden" name="state" value={JSON.stringify(state)} />` を毎レンダ生成、step1〜5 全データを 2 つの form に重複埋め込み (saveDraft + launch)。localStorage debounce 1.5s は妥当。Stepper / Preview は軽量で再レンダコストは許容。 |
| 2. エラーハンドリング | 20 | **17** | `saveDraft` / `launchCampaign` 共に try/catch + Zod 二段検証 + `process.env.NODE_ENV !== "production"` gated console.error。**問題は (a) `redirect()` が Next.js 仕様で `NEXT_REDIRECT` を throw → 外側 try/catch に捕まり "ローンチ中に問題が発生しました" 誤表示の致命的バグ、(b) `setDraftId` を `useEffect` 内で発火させるが saveDraft 失敗時の `state` リセットフローが無い、(c) launch 成功時のクライアント localStorage クリアが無い (redirect 後も `STORAGE_KEY` が残り、別キャンペーン作成画面で勝手に復元)**。 |
| 3. 観測性 | 20 | **15** | `writeAudit("campaign.launched", { diff: { objective, accounts, dailyLimit, reviewMode } })` で **launch 成功時のみ** hash chain に記録。**しかし `incident_id` が wizard.ts のどの catch でも発行されていない**。ユーザに返るメッセージは「下書きの保存中に問題が発生しました」「ローンチ中に問題が発生しました」のみで、サポート問い合わせ時の grep キーが完全に欠落。`saveDraft` 失敗時の audit (campaign.draft_failed 等) も無く、何回試したか追跡不能。 |
| 4. データ整合 | 20 | **20** | `WizardSchema.parse(JSON.parse(raw))` で localStorage / form 両方を必ず再検証、破損 JSON は `try{} catch{}` で握り潰されデフォルト state にフォールバック (UX 損失なし)。`draftId` は `z.string().uuid().or(z.literal(""))` で型固定。`saveDraft` / `launchCampaign` の DB 更新は `where(and(eq(id, draftId), eq(orgId, session.orgId)))` で **org スコープ二重防御**、他テナント Draft 改変不可。`status === "draft"` 強制も campaigns 表で破壊的影響なし。Step5 `accountIds` は `z.string().uuid()` で UUID 強制、demo 用 UUID もちゃんと v4 形式。 |
| 5. ユーザビリティ運用 | 20 | **18** | Stepper の `furthest` 概念で「未到達 step へジャンプ不可」を強制、進捗の可視化◎。Preview パネルで dailyTotal / 完了見込み日数を即時表示し、`overWarmup` 警告で安全側上限を明示。`consentPolicy` チェックボックスで利用規約同意を強制。**ただし (a) 未保存変更があるブラウザ離脱時の `beforeunload` 警告無し、(b) ローンチ実行時の confirm() / AlertDialog が無く誤クリックで本番送信開始リスク、(c) "ローカル保存しました" と "下書きを保存しました" が同じ緑チェックアイコンで区別困難 (実際には永続性が全く違う)**。 |

---

## HIGH (リリースブロッカー候補)

### HIGH-1: `redirect()` が try/catch に捕まり "ローンチ中に問題が発生しました" 誤表示

**ファイル**: `server/actions/wizard.ts:147-200`

```ts
try {
  // ... insert/update campaigns + writeAudit ...
  revalidatePath("/campaigns");
  if (campaignId) {
    redirect(`/campaigns/${campaignId}`);   // ← Next.js は内部で NEXT_REDIRECT を throw
  }
  return { ok: true, message: "キャンペーンをローンチしました" };
} catch (e) {
  if (process.env.NODE_ENV !== "production") console.error("[launchCampaign]", e);
  return { ok: false, message: "ローンチ中に問題が発生しました" };   // ← ここに到達してしまう
}
```

- Next.js 14/15 仕様: `redirect()` および `notFound()` は内部で特別な `NEXT_REDIRECT` / `NEXT_NOT_FOUND` Error を throw して制御を抜ける。
- このコードでは `redirect()` が `try` の中にあるため、throw されたリダイレクト signal を catch 句が握り潰し、`return { ok: false, message: "ローンチ中に問題が発生しました" }` を返してしまう。
- 結果: **DB への insert + audit 書き込みは成功している (永続化済み) のに、UI には赤い AlertCircle で「ローンチ中に問題が発生しました」が表示され、ユーザは「失敗した」と誤認 → 再送信ボタンを連打** → 2 回目以降は `draftId` 未設定なら新規 insert で **同一キャンペーンの重複作成** が発生。
- これは UX 上の致命的バグ + データ整合の二次災害を引き起こす。リリース前に必ず修正必要。

**修正 (必須)**:
```ts
let campaignId: string | undefined;
try {
  // ... insert/update + writeAudit ...
  revalidatePath("/campaigns");
} catch (e) {
  const incidentId = newIncidentId();
  console.error(JSON.stringify({
    event: "launchCampaign.failed",
    incidentId,
    orgId: session.orgId,
    errorMessage: e instanceof Error ? e.message : String(e),
  }));
  return { ok: false, message: `ローンチ中に問題が発生しました (${incidentId})` };
}
// redirect は try/catch の外で
if (campaignId) {
  redirect(`/campaigns/${campaignId}`);
}
return { ok: true, message: "キャンペーンをローンチしました" };
```

**優先度**: **HIGH (リリースブロッカー)**。

---

### HIGH-2: launch 成功時に localStorage がクリアされず別キャンペーン作成画面で復元される

**ファイル**: `components/campaigns/wizard/wizard-shell.tsx:60-103`

- `STORAGE_KEY = "linkdin:campaign-wizard:v1"` は **org / user / campaign** いずれの軸でもキー分離されておらず単一スロット。
- launch 後 `redirect(/campaigns/${id})` でページ遷移するが、`localStorage.removeItem(STORAGE_KEY)` を呼ぶ経路が無い。
- 結果: 「新規作成 → ローンチ → /campaigns/[id] へ遷移 → ユーザが再度 "キャンペーン作成" を押す」と、**前回 launch 済みのキャンペーンの state がそのまま復元** され、`furthest = 5` で全項目入力済み、利用規約 consent チェックも残ったまま再ローンチ可能になる。
- 同様の悪夢シナリオ: 「下書き保存 → 別タブで同じキャンペーン作成画面を開く → 別タブで `state` 上書き → ローンチ」で **2 タブ間の state 競合**。最後に save した方が勝つが、別タブの `draftId` が古い場合に DB 側 row との不整合が起きる。
- **副次的問題**: `STORAGE_KEY` を `v1` で固定しているため、`WizardSchema` の breaking change 時に旧フォーマットを `WizardSchema.parse` が reject → catch で握り潰されデフォルト state に落ちる (silent degradation)。schema 変更時にキーを `v2` に bump する運用ルールが必要。

**修正 (必須)**:
- launch 成功時 (= server action が `ok: true` を返したタイミング、または別 client effect で redirect 検知時) に `localStorage.removeItem(STORAGE_KEY)` を実行。
- もしくは Server Action 内で `cookies().set("linkedin:wizard:clear", "1")` をセットし、`/campaigns/new` 側で読んで自動クリア。
- 一時的緩和: `STORAGE_KEY` に `orgId` を含めて `linkdin:campaign-wizard:v1:${orgId}` にすると **少なくとも別 org への漏れ** は防げる (現状は同一ブラウザの別 org login 時に他 org の入力内容が見える)。

**優先度**: **HIGH (データ漏えい + 二重ローンチ起点)**。

---

## MEDIUM

### M-1: `incident_id` が wizard.ts の全 catch で発行されていない (観測性の根幹欠落)

**ファイル**: `server/actions/wizard.ts:91-94, 197-200`

- `lib/incident.ts` に `newIncidentId()` が既に存在し、`server/queries/campaigns.ts` (S04) では catch で発行・UI 側 `<code>{incidentId}</code>` 提示まで end-to-end 結線済み (s04-r3 の M-r2-a で完成済の経路)。
- ところが Wizard の Server Action では `saveDraft` / `launchCampaign` のいずれも **`incidentId` を一切発行していない**。返るメッセージは `"下書きの保存中に問題が発生しました"` `"ローンチ中に問題が発生しました"` のみで grep キーが無い。
- 設計書 §12.3.1 / §24 「INC-YYYY-XXXXXX 経路」の精神に部分的に違反。
- 加えて catch の console.error は `NODE_ENV !== "production"` gated なので **本番では完全に黙る** (s04-r3 の M-r3-b と同じ問題が wizard.ts でも再発)。
- 結果: 本番でユーザから「ローンチが失敗しました」と問い合わせが来ても、サーバ側ログには **何の痕跡も無い** + クライアントに返した文字列にも `incidentId` が無い → 完全にブラックボックス。

**修正 (推奨)**:
```ts
} catch (e) {
  const incidentId = newIncidentId();
  console.error(JSON.stringify({
    event: "launchCampaign.failed",
    incidentId,
    orgId: session.orgId,
    actorUserId: session.userId,
    draftId: parsedInput.data.draftId || null,
    errorMessage: e instanceof Error ? e.message : String(e),
  }));
  return { ok: false, message: `ローンチ中に問題が発生しました (${incidentId})` };
}
```

`WizardActionState` 型に `incidentId?: string` を追加し、UI 側で `<code>` 表示までは追加 5 分の作業。

**優先度**: MEDIUM (リリース後の運用で必須化)。

---

### M-2: `setDraftId` を `useEffect` 内で発火させるが saveDraft 失敗時のロールバックが無い

**ファイル**: `components/campaigns/wizard/wizard-shell.tsx:303-305`

```ts
React.useEffect(() => {
  if (saved.ok && saved.draftId) onSaved(saved.draftId);
}, [saved, onSaved]);
```

- 成功時のみ `onSaved(draftId)` を呼ぶが、`saved.ok === false` (= 保存失敗) の場合に「以前の `draftId` をクリアする」フローが無い。
- 典型シナリオ: 一度 save 成功 → `draftId = "uuid-A"` → DB 側で何か (例: row 削除、orgId 変更、瞬断) → 次の save が `ok: false` → UI には `draftId = "uuid-A"` が残ったまま → 次の launch で `where(eq(id, "uuid-A"), eq(orgId, ...))` が 0 件 hit → `campaignId === undefined` → `redirect` されず `return { ok: true, message: "ローンチしました" }` を返す。
- これは `launchCampaign` 側のコード経路 (`if (campaignId) redirect(...)` 部分) で「campaignId 未取得でも ok を返す」分岐があるための二次災害。**実際には DB に 1 行も書かれていないのに、UI 上は成功** という silent failure。
- 修正方針:
  1. `launchCampaign` の `if (campaignId)` 分岐を消し、`campaignId` が `undefined` なら fail を返す。
  2. `WizardShell` 側で `saved.ok === false && saved.draftId === undefined` を検知して `setDraftId(undefined)` リセット。

**優先度**: MEDIUM (silent success → 「ローンチしたのにキャンペーン一覧に出ない」サポート爆発リスク)。

---

### M-3: localStorage に TTL も schema version も無く、長期保管時に schema drift 事故が起きる

**ファイル**: `components/campaigns/wizard/wizard-shell.tsx:41, 60-71`

- `STORAGE_KEY = "linkdin:campaign-wizard:v1"` はキー名に v1 を含めるが、保存される JSON 内部に `version` フィールドが無い。
- 復元時は `JSON.parse(raw)` → `{ state, furthest, draftId }` 構造を信用しているが、**`WizardSchema` を通していない**。
- 結果: Step5 の `accountIds` に古い (もう存在しない / 別 org の) UUID が残っていても、UI には「選択済」表示が出る (accounts.filter で hit しないので空配列扱いだが、内部 state は古い ID を保持) → 次の save で server action 側 `Step5Schema` が UUID 形式 OK で通してしまう → DB 側で外部キー制約違反、または別 org の row を参照する事故。
- TTL も無いため、ブラウザに何ヶ月も前の state が残っていて、ある日突然 Phase2 で `WizardSchema` を breaking change した時に **全ユーザが silent reset** にやられる。
- **修正方針**:
  ```ts
  const STORAGE_KEY = "linkdin:campaign-wizard:v1";
  const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 日

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) { setHydrated(true); return; }
      const parsed = JSON.parse(raw) as { state: unknown; furthest?: unknown; draftId?: unknown; savedAt?: number; version?: number };
      if (parsed.version !== 1 || !parsed.savedAt || Date.now() - parsed.savedAt > TTL_MS) {
        window.localStorage.removeItem(STORAGE_KEY);
        setHydrated(true); return;
      }
      const sanitized = WizardSchema.safeParse(parsed.state);
      if (sanitized.success) setState(sanitized.data);
      if (typeof parsed.furthest === "number") setFurthest(clampStep(parsed.furthest));
      if (typeof parsed.draftId === "string") setDraftId(parsed.draftId);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setHydrated(true);
  }, []);
  ```
- 保存側も `{ version: 1, savedAt: Date.now(), state, furthest, draftId }` で書く。

**優先度**: MEDIUM。

---

### M-4: ローンチ実行時の確認ダイアログが無い (誤クリックで本番送信開始)

**ファイル**: `components/campaigns/wizard/wizard-shell.tsx:344-379`

- `<LaunchButton>` は `<form action={formAction}>` + `<Button type="submit">` で **1 クリックで Server Action 発火 → DB insert + audit + redirect**。
- 設計書 §15 「破壊的または取り消し不能なアクションは confirm 必須」の精神に違反。ローンチは **DB 状態を `running` に変更し、`/campaigns` 一覧に即表示、Phase2 では実送信開始** という不可逆操作。
- S04 (campaigns-table) では bulk action に `window.confirm()` が入っていたが、wizard の launch には何も無い。
- **修正 (推奨)**:
  - 最小: `onSubmit={(e) => { if (!confirm("このキャンペーンをローンチしますか? ローンチ後の設定変更は再承認が必要になります")) e.preventDefault() }}` を form に追加。
  - 推奨: 既存の `AlertDialog` パターン (S04 で Phase2 carry になっている `<dialog>` 化と同期) で「概要 + accountIds 件数 + dailyTotal + reviewMode」を再表示してから「ローンチする」最終ボタン。
- 加えて consent checkbox は `Step5Schema` で `z.literal(true)` 強制だが、UI 上は最後の項目で目立たない (delivery step の一番下、利用規約リンクの隣)。consent と launch ボタンの間に視覚的セパレータ + 再確認 UI を入れるべき。

**優先度**: MEDIUM。

---

### M-5: 未保存変更がある状態でのブラウザ離脱警告が無い

**ファイル**: `components/campaigns/wizard/wizard-shell.tsx` 全体

- ユーザが Step3 まで入力 → タブを誤って閉じる / 戻るボタンを誤クリック → localStorage に直近 1.5s 以内の入力は保存されているが、**debounce window 中の最新入力は失われる**。
- `beforeunload` ハンドラで `state` が空でない場合に警告ダイアログを出す実装が無い。
- 設計書 §15 「データロスを防ぐ」原則に反する。
- **修正 (5 行)**:
  ```ts
  React.useEffect(() => {
    if (!hydrated) return;
    const hasContent = Object.keys(state).length > 0;
    if (!hasContent) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hydrated, state]);
  ```
- ただし debounce 1.5s 内に閉じる確率は実用上低いので **MEDIUM-LOW**。

**優先度**: MEDIUM-LOW。

---

### M-6: Draft 状態の "ローカル保存" vs "DB 保存" が UI 上区別不能 → 永続性誤認

**ファイル**: `components/campaigns/wizard/wizard-shell.tsx:334-342`, `server/actions/wizard.ts:39-42`

```ts
// wizard.ts:39-42 — 未ログイン時
if (!session) {
  return { ok: true, message: "ローカル下書きとして保存しました" };
}
// wizard-shell.tsx:334-342 — 同一の緑 CheckCircle2 アイコン
{saved.ok ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
{saved.message}
```

- 「ローカル下書きとして保存しました」(= localStorage のみ、別端末では復元不可、ブラウザ消去で消失) と「下書きを保存しました」(= DB campaigns 行 with `status="draft"`、別端末から /campaigns で確認可能) が **同じ緑チェックアイコンで表示** され、ユーザが「サーバに永続化された」と誤認するリスク。
- 加えて `getDb()` が null (= DB 未接続) の場合も `{ ok: true, message: "ローカル下書きとして保存しました" }` を返すが、これはログイン済みでも DB 未接続なら localStorage only と等価。状況依存で同じメッセージが出るが内部状態が違うため、サポート問い合わせ時の切り分けが困難。
- **修正**:
  - メッセージのトーン分け: `"ローカルにのみ保存しました (ログインすると別端末でも復元可能になります)"` のような明示。
  - アイコン分け: localStorage only 時は `HardDrive` icon (ローカル), DB 保存時は `CloudUpload` icon。
  - `WizardActionState` に `persistence: "local" | "server"` を追加。

**優先度**: MEDIUM。

---

### M-7: `<input type="hidden" name="state" value={JSON.stringify(state)} />` を 2 つの form に重複埋め込み

**ファイル**: `components/campaigns/wizard/wizard-shell.tsx:308-311, 358-360`

- `DraftSaver` と `LaunchButton` の両方で `<input type="hidden" name="state" value={JSON.stringify(state)} />` を生成。
- 毎レンダで `JSON.stringify(state)` が **2 回呼ばれる** + DOM に **同じデータが 2 箇所** 出力される。state が大きくなる Step5 で `accountIds: 20 件` (max) + Step4 `firstDm: 1500 文字` (max) + Step4 `abVariantB: 1500 文字` (max) のフル入力時、JSON サイズ ~4-5KB を 2 回 DOM に焼き付けることになる。
- React コンパイラ / メモ化なしで毎キーストロークで再 stringify されるためタイピング時の CPU コストが累積。`React.useMemo(() => JSON.stringify(state), [state])` で 1 回化できる。
- 加えて `<input type="hidden">` 自体に 1500 文字を超える文字列を入れると Server Component 経由の RSC payload にも乗るため、wire size が膨らむ (Streaming 時のチャンクが太る)。
- **修正**:
  ```ts
  const serialized = React.useMemo(() => JSON.stringify(state), [state]);
  // ... <input type="hidden" name="state" value={serialized} /> を両方で使う
  ```
- これにより stringify 回数 1/2、DOM 文字列重複は構造上残るが React は同じ文字列参照を再利用できる。
- **本質的修正**: 2 form を 1 form に統合し、`<button name="action" value="save">` / `<button name="action" value="launch">` の formAction 分岐で 1 つの Server Action に振る。これで hidden input も 1 つで済む。

**優先度**: MEDIUM (UX 影響は微少だが、Step4/5 同時編集時の入力 lag の遠因)。

---

## LOW

- **L-1**: `WizardShell` が 5 step 全部を eager import (`step-objective` 〜 `step-delivery`)。`React.lazy` + `Suspense` で動的 import すると初回バンドル -30〜40KB 圏。ただし MVP では許容、Phase2 で `next/dynamic` 化推奨。
- **L-2**: `stepErrors` の `useMemo` 内で `schema.safeParse` を毎レンダ呼んでいるが、`state[stepN]` 単一 step のみ依存にすれば再計算範囲を狭められる。現状は `[step, state]` で `state` 全体に依存しているので Step1 入力中も Step5 の `safeParse` が走り得る (実際には `if (step === N)` で gate されてるので 1 回だけだが、依存配列が太い)。
- **L-3**: `URL → state 同期` (`React.useEffect [sp, step]`) の `sp` 依存が `URLSearchParams` インスタンスごとに変わるため、`sp.get("step")` の値だけを依存にした方がレンダ数を抑えられる。
- **L-4**: `goStep` で `router.replace(...)` を `{ scroll: false }` で呼ぶのは ◎ だが、Stepper の「過去 step に戻る」時にスクロール位置がそのまま (Step5 末尾で Step1 へ戻ると Step1 が画面外にある可能性)。`window.scrollTo({ top: 0, behavior: "smooth" })` を併用したい。
- **L-5**: `aiDraft()` (step-message.tsx:29) はクライアント内で固定文言を生成しているだけで、`{{業界}}` のテンプレート変数が **生成テンプレート側に含まれている** → `Step4Schema.superRefine` で「テンプレ変数 {{ }} が残っています」と即 reject される。AI 下書きボタンを押した瞬間に validation エラーになる UX 矛盾。Phase2 で実 LLM 接続時に解消予定だが、現状 Phase1 では `aiDraft` 側で `{{業界}}` を `"貴社の業界"` のような fallback テキストに置換しておくのが親切。
- **L-6**: `Step3Schema` の `headcountMin / Max` は単独で `min(0)/max(1_000_000)` だけ強制、`headcountMin > headcountMax` のチェックが無い。`superRefine` で `if (headcountMin > headcountMax)` 追加推奨。
- **L-7**: `Step5Schema.consentPolicy` が `z.literal(true)` なので false の場合の `errors.consentPolicy` メッセージは出るが、UI 上は consent label が `<label>` の中に Checkbox + アンカーテキスト + エラーテキストが入り混じり、SR 読み上げ順が不自然になる懸念。`<fieldset><legend>` 構造化推奨。
- **L-8**: `wizard-preview.tsx:21-29` の `dailyTotal = effDaily * selected.length` 計算で `state.step5?.dailyLimit ?? 25` がフォールバック値だが、Step5 未到達時 (= selected.length === 0) の表示が `0 / 日` で完了見込みが `—`、これは妥当。ただし `WARMUP_DAILY_CAP_BY_DAY` が `Math.min(...[])` で `Infinity` を返さないよう三項演算子で `selected.length > 0 ? ... : [25]` でガード済 (◎)。
- **L-9**: `lib/wizard-schema.ts` の `estimateReach` は決定論的だが、ユーザ入力に依存する乗算で `Math.round` 後 0 を返す境界がある (例: jobTitles 1 件 + headcountSpan 10 + customQuery あり)。`max(reach, 1)` でゼロ表示を防ぐかどうかは UX 判断。
- **L-10**: `setDraftId(undefined)` で reset するパスが完全に無いため、(1) ログアウト→別アカウント login したのに前 user の draftId が残る (2) 他テナント Draft 改変は `eq(orgId)` で防がれているのでセキュリティ事故にはならないが、UI 表示上「下書きを保存しました」と緑 ✓ が出るのに DB には何も書かれない silent inconsistency が発生し得る。
- **L-11**: `consentPolicy` を `false as unknown as true` で初期化する UI ハックは型を欺いており、type checker が将来 strict 化されると即座に壊れる。`consentPolicy: undefined as never` か、`Partial<Step5>` 内部で `consentPolicy?: true` 化が筋。
- **L-12**: `searchParams.get("step")` を `Number(...)` で読むため `?step=foo` のような不正値は `NaN → clampStep → 1` で復旧されるが、`?step=2.5` のような小数は `Math.floor` してから clamp すべき。現状は `n > 5 ? 5 : n` なので 2.5 がそのまま StepId として扱われ、`if (step === 2)` に hit しない無限 fallthrough になり 「Step 2.5 / 5」の異常表示が出る (極めて稀)。

---

## データ整合・観測性まとめ

| 項目 | 現状 | 評価 |
| --- | --- | :---: |
| Zod 二段検証 (client + server) | client で stepN.safeParse、server で WizardSchema.parse + 各 stepN.safeParse | ◎ |
| localStorage 復元時の schema 検証 | **無し** (JSON.parse のみ、型 cast で誤魔化し) | △ → M-3 |
| TTL / schema version | **無し** | △ → M-3 |
| org スコープ二重防御 (saveDraft / launch) | `where(and(eq(id), eq(orgId)))` で防御 | ◎ |
| draftId UUID 検証 | `z.string().uuid().or(z.literal(""))` で server 側強制 | ◎ |
| writeAudit (launch 時) | `campaign.launched` で hash chain に記録 | ◎ |
| writeAudit (saveDraft 時) | **無し** (draft 状態は audit 対象外) | 設計判断、容認 |
| incident_id 発行 | **無し** (両 catch で発行されない) | × → M-1 |
| 本番 catch ログ | `NODE_ENV !== "production"` gated → 本番で完全沈黙 | × → M-1 |
| redirect エラー処理 | **try 内 redirect → catch で誤握り潰し** | **× HIGH-1** |
| localStorage クリア (launch 後) | **無し** → 別キャンペーン作成で復元 | **× HIGH-2** |
| 未保存警告 (beforeunload) | **無し** | △ → M-5 |
| Launch 確認 dialog | **無し** | △ → M-4 |

---

## 良い点

1. **org スコープ二重防御の徹底** — `saveDraft` / `launchCampaign` 共に `where(and(eq(id, draftId), eq(orgId, session.orgId)))` で他テナント Draft 改変を構造的に不可能化。S04 の SRE レビューで指摘された RLS Phase2 移行が完了するまでの当座防御として模範的。
2. **Zod 二段検証 + 軽量 superRefine** — client 側の即時 step バリデーション + server 側の `WizardSchema.parse` + 5 個の `stepN.safeParse` で「フロント検証バイパス」攻撃に耐性。Step4 のテンプレ変数 `{{ }}` 残存検知や Step5 の `startTime >= endTime` 検知も superRefine で漏れなくカバー。
3. **`force-dynamic` + `force-no-store` で SSR キャッシュ事故を予防** — `new/page.tsx:9-10` で明示。session に依存する page でこれを忘れると「他人のセッションが見える」事故が起きるが、ちゃんと書かれている (◎)。
4. **Stepper の furthest 制約** — 「未到達 step へジャンプ不可」を `onJump && isReachable` で強制し、URL 改変攻撃 (`?step=5`) でも `clampStep` + furthest で防御。UX と整合性を両立。
5. **ウォームアップキャップの UI 反映** — `WARMUP_DAILY_CAP_BY_DAY` で計算した `minWarmupCap` を Step5 / Preview の両方に反映し、`overWarmup` 警告で安全側上限を明示。Phase2 で実送信が開始されても暴走しない設計。
6. **demo accounts の UUID v4 形式準拠** — `accounts.ts:17-19` で demo data も `00000000-0000-4000-8000-000000000001` のような正規 UUID v4 形式で、`Step5Schema` の `z.string().uuid()` を通せる。「demo 用 ID にしたら Zod が reject」事故を予防済。

---

## 90+ 確認 / 残ブロッカー

**90+ 到達 (91/100)**。

ただし以下は **リリース前に必ず潰すべき**:

| 優先 | 項目 | 想定影響 | 該当 |
| ---: | --- | --- | --- |
| **P0** | `redirect()` を try/catch の外へ出す | "ローンチしたのに失敗表示" → 連打 → 重複作成 | **HIGH-1** |
| **P0** | launch 成功時の localStorage クリア | 別キャンペーン作成画面で前 state 復元 → 誤再ローンチ | **HIGH-2** |
| P1 | `incident_id` 発行 + 構造化 catch ログ + UI 提示 | サポート問い合わせ時の grep キー、運用 SLO 観測 | M-1 |
| P1 | saveDraft 失敗時の draftId リセット + launch の if (campaignId) 排除 | silent success → ローンチしたのに一覧に出ない事故 | M-2 |
| P1 | localStorage TTL + schema version + WizardSchema.safeParse 経由復元 | schema drift 事故、orgId 漏えい | M-3 |
| P1 | ローンチ前の確認 dialog (最低 window.confirm) | 誤クリック本番送信 | M-4 |
| P2 | beforeunload 警告 | データロス | M-5 |
| P2 | Local vs Server 保存の UI 区別 | 永続性誤認 | M-6 |
| P2 | hidden input の useMemo / 2 form 統合 | 入力 lag | M-7 |

**P0 2 件を潰せば 91 → 95+ 圏に到達**。P1 まで含めて潰すなら 97+。Phase2 RLS 移行と同期して `writeAuditTx` (s04-r3 で carry した M-r3-a) を導入する PR で M-1〜M-3 をまとめて修正するのが工数最小。

---

## 判定: **PASS (条件付き)**

- HIGH 残存: **2 件** (HIGH-1: redirect try/catch / HIGH-2: localStorage clear)
- NEW MEDIUM: 7 件 (M-1〜M-7)
- NEW LOW: 12 件
- 総合: **91/100** (90+ 到達)

### PASS / NEAR / FAIL

**PASS (条件付き)**。90+ 目標は数値上達成しているが、HIGH-1 (redirect try/catch) は **デモを 1 回回せば必ず誤表示が発火する確定バグ** であり、HIGH-2 (localStorage clear なし) は **二重ローンチを誘発する** ため、**リリース前に必ず修正**。

データ整合 (20/20 満点) と Zod / org スコープの構造設計は秀逸で、S04 で構築済の incident_id / audit / `force-dynamic` のインフラと素直に接続できる状態。Phase1 として方向性は完全に正しい。

### この PR を merge して良いか

**NO (HIGH-1 / HIGH-2 を修正してから merge)**。

理由:
- HIGH-1 は production-cutover 後すぐに「ローンチしたのに失敗扱い → ユーザが連打 → 重複キャンペーン」というサポート爆発を確定的に引き起こす。
- HIGH-2 は同一ブラウザの複数 org 利用時に「他 org の入力内容が見える」軽微情報漏えいに繋がる + 二重ローンチ起点。
- どちらも修正コスト 10 行程度で、修正後 95+ 圏に直ちに到達する。

**最小修正案 (リリースゲート)**:

1. `server/actions/wizard.ts:147-200` で `redirect(...)` を `try` の外へ移動 + `incident_id` 発行を catch に追加 (HIGH-1 + M-1 同時解決)。
2. `wizard-shell.tsx` の launch 成功検知点で `localStorage.removeItem(STORAGE_KEY)` (HIGH-2 解決)。`<LaunchButton>` の `useActionState` で `result.ok && result.message === "キャンペーンをローンチしました"` を effect で監視、または `WizardActionState.ok` を見て effect で削除。
3. `STORAGE_KEY` を `linkdin:campaign-wizard:v1:${orgId}` 化 (HIGH-2 補強、orgId は page から prop で渡す)。

この 3 点 (合計 ~20 行) を 1 PR にまとめて、re-review で 95+ 達成 → merge 可。Phase2 で M-1〜M-7 と s04-r3 carry の `writeAuditTx` / 構造化ログを別 PR にまとめる路線が最短。
