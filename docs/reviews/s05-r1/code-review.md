# S05 キャンペーン作成 Wizard 精密コードレビュー (r1)

- **対象ブランチ / 範囲**: `app/(app)/campaigns/new/page.tsx`, `components/campaigns/wizard/*`, `lib/wizard-schema.ts`, `server/actions/wizard.ts`, `server/queries/accounts.ts` 関連
- **スタック**: Next.js 15.0.3 (App Router) / React 19 RC / Zod 3.23 / TypeScript 5.6 / Tailwind v4
- **レビュー日**: 2026-05-11
- **レビュアー**: Code-Review Agent (Collaborative mode)

---

## 総合スコア

| # | 評価軸 | スコア | 補足 |
|---|---|---|---|
| 1 | 型安全 (any/cast/Zod推論) | **15 / 20** | `as unknown as true` と複数の `as never` を含むため -5 |
| 2 | React 19 / Next 15 (use client境界・useActionState/useFormStatus) | **17 / 20** | 構造は適切。フォーム外への `useActionState` 副作用伝搬とSearchParams Suspense不在で -3 |
| 3 | a11y (Stepper/Radio/Checkbox/コントラスト) | **16 / 20** | role/aria-current/fieldsetは概ね適切。`role="radiogroup"` の中身が radio でない、ARIA 重複、コントラスト不足で -4 |
| 4 | エッジケース (空配列・null・URL同期・再ロード・LocalStorage復元) | **15 / 20** | URL→state片方向同期/二重 effect/`Math.min(...[])` 周辺の `Infinity`回避や `headcountMin>Max` 未検証で -5 |
| 5 | コード匂い (重複・命名・巨大コンポ) | **16 / 20** | `Field` 3 重定義/`AccountOption` vs `AccountListItem` 二重定義/`updateStep` 未使用などで -4 |
| **合計** | | **79 / 100** | **90+ には未到達**。HIGH を 3〜4 件潰せば 90 越え可能 |

> **90+ 判定: 未到達 (FAIL)** — 後述 HIGH#1〜#5 のうち少なくとも HIGH#1, #2, #4, #5 を解消し、MEDIUM の 30〜40% を反映すれば 92 前後に到達する見込み。

---

## サマリー (1分版)

良いところ:
- Server Component (`page.tsx`) → Client Component (`WizardShell`) の境界が明快で、データ取得はサーバで完結している。
- Step ごとに Zod スキーマ → `z.infer` で派生型を一元管理しており、`Step1`〜`Step5` は型と検証が連動している。
- `useActionState` + `useFormStatus` を **submit ボタンだけ別コンポーネント化** している点は React 19 のベストプラクティスに沿っている。
- a11y は `aria-current="step"`, `role="checkbox"` + `aria-checked="mixed"`, `fieldset/legend` (Step1), `role="radiogroup"` (Step5 ReviewMode) が入っており初期実装としては丁寧。
- バリデーション後の `Reach Indicator` の警告/危険レベル分岐や、ウォームアップキャップの自動押し戻し UI は実装意図が伝わる。

致命的:
- `step5.consentPolicy: false as unknown as true` という **Zod の `z.literal(true)` を欺くキャスト** が `wizard-shell.tsx:241` に直書きされている。スキーマと UI 型の整合性破壊。
- Stepper の `aria-current="step"` を `<button>` ではなく `<span>` にも適用する設計、`role="radiogroup"` 内に `aria-pressed` の `<button>` が並ぶなど、**ARIA セマンティクスが不整合**。
- `WizardShell` の `updateStep` ジェネリックは **どこからも呼ばれていないデッドコード** であり、署名上の問題以前に未使用。
- `useSearchParams()` を Server-rendered ページから渡された Client Component で使う場合、Next 15 では **`<Suspense>` バウンダリ必須** だが未設置。`next build` 時に CSR-bailout 警告。

---

## 詳細評価

### 軸1: 型安全 (15 / 20)

| 観点 | 状態 | 評価 |
|---|---|---|
| `any` の有無 | 0 件 | OK |
| `as any` の有無 | 0 件 | OK |
| `as unknown as <Lit>` | 1 件 (consentPolicy) | **NG** |
| `as never` | 6 件 (regions/funding) | NG |
| Zod 推論 (z.infer) 利用 | Step1〜5 全て | OK |
| Discriminated union | 該当なし (`Objective` 等は string literal union で十分) | OK |
| Server Action 戻り値型 | `WizardActionState` 明示 | OK |

**問題点**:

- **`wizard-shell.tsx:241` — `consentPolicy: false as unknown as true`**
  Zod が `z.literal(true)` を要求しているため、UI 上の初期値 `false` を入れたいが TS が通らず *キャストで型を欺いている*。これは「型上は同意済を初期値にしている」と「実値は未同意」が乖離している状態で、もし `Step5Schema` の `default` を撤去するとここが TS エラーになる「型バンソウコウ」。
  → **修正案**: `WizardState["step5"]` を `Partial<Step5>` に保つか、`consentPolicy: false as boolean as true` ではなく**初期値そのものを省略**(Zod の super-refine で `consentPolicy !== true` を弾く方が正しい)。あるいは `Step5Schema` を `z.object({...})` で `consentPolicy: z.boolean()` + `.refine(v => v.consentPolicy === true, ...)` に変えれば UI 型と DTO 型が完全一致する。

- **`step-icp.tsx:93 / 101 / 102 / 122 / 130 / 131` — `r.value as never` / `f.value as never`**
  `merged.regions: ("jp"|"global"|"us"|"eu")[]` に対し `r.value: "jp"|...` を `.includes()` するときに ReadOnlyArray の widening 問題を `as never` で回避している。これは型推論を放棄する典型的アンチパターン。
  → **修正案**: `as const` 配列の `value` を `Step3["regions"][number]` で明示すれば不要。例:
  ```ts
  const REGIONS: { value: Step3["regions"][number]; label: string }[] = [
    { value: "jp", label: "日本" }, ...
  ];
  ```
  または `(merged.regions as readonly string[]).includes(r.value)` の **ナローイングしない側を** ワイデンする。`as never` は意味が逆。

- **`wizard-shell.tsx:108-115` の `tryParse` 型署名**:
  ```ts
  const tryParse = (schema: { safeParse: (v: unknown) => { success: boolean; error?: {...} } }, data: unknown) => ...
  ```
  Zod の `safeParse` 本来の型 `SafeParseReturnType<I, O>` ではなく **structural な手書き型** を当てている。これにより:
  1. `success: true` のとき `result.data` 存在を TS が知らない → 今のロジックでは `data` を使わないので動くが、将来 `result.data` を使うと型が穴空き。
  2. Zod のバージョン更新で `issues` の `path` 型が `(string | number)[]` から `PropertyKey[]` に変わったとき silently break する。
  3. `r.success || !r.error` で抜けるロジックは `r.success === true` のとき `r.error` が `undefined` であることを **手書き型では保証していない** (本物の Zod の判別 union なら自動)。
  → **修正案**:
  ```ts
  import type { ZodSchema } from "zod";
  const tryParse = (schema: ZodSchema, data: unknown) => {
    const r = schema.safeParse(data);
    if (r.success) return;
    for (const issue of r.error.issues) { ... }
  };
  ```

- **`updateStep` ジェネリック (`wizard-shell.tsx:126-136`)**:
  シグネチャ自体は妥当 (`<K extends keyof WizardState>`, `partial | ((prev) => next)`) だが、**実装内で `prev[key]` が `undefined` の場合 `{ ...undefined, ...partial }` を spread している** ため、関数オーバーロードの「partial として渡された場合」ブランチでは `prev[key]` が undef のとき空オブジェクトに `partial` をマージするだけになり、Zod の `default` を失う。さらに **どこからも `updateStep` は呼ばれていない** (各 `setState((p) => ...)` がインラインで書かれている)。
  → **修正案**: `updateStep` を使うか削除する。Step1〜5 の各 `setState` で同じ `step1/2/.../5` の default 構造が **重複定義** されているのを `updateStep` に集約すべき。これは **コード匂い軸**にも跨る問題。

**Score: 15/20** (HIGH#1, HIGH#2, MEDIUM#1)

---

### 軸2: React 19 / Next.js 15 (17 / 20)

| 観点 | 状態 | 評価 |
|---|---|---|
| `"use client"` 境界 | page=Server / Wizard以下=Client。Header はServer | OK |
| `useActionState` の使い方 | submit form を別コンポに分離 | OK |
| `useFormStatus` の使い方 | `DraftButton`, `LaunchSubmit` で正しくフォーム内に配置 | OK |
| Server Action `redirect()` の位置 | try/catch の外 (`launchCampaign:194`) | OK |
| `useSearchParams` の Suspense | **未設置** | NG |
| Streaming / `loading.tsx` | 該当なし (動的ページなので不要) | OK |
| Form state リセット / `key` 戦略 | Draft 後の `saved` リセット導線なし | NG (MEDIUM) |

**問題点**:

- **`useSearchParams` が `<Suspense>` で包まれていない (HIGH#3)**
  Next 15 では `useSearchParams()` を呼ぶ Client Component が **静的レンダリングをブロックしないよう Suspense でラップする必要がある**。`page.tsx` で `export const dynamic = "force-dynamic"` を設定しているため `next build` でエラーにはならないが、Next 15 のドキュメントの推奨に反する。
  → **修正案**: `app/(app)/campaigns/new/page.tsx` で `<Suspense fallback={<div />}>` に `<WizardShell />` をラップ。または **URL ステート同期を `useSearchParams` ではなく `useSelectedLayoutSegment` 風に sessionStorage で代替**。

- **`useActionState` の `_prev` を実際に使っていない (LOW#1)**
  `saveDraft(_prev, formData)`, `launchCampaign(_prev, formData)` — `_prev` を使う設計でないなら、`useActionState` の第1引数を活用していない設計。問題ではないが、フォーム送信を**冪等にする**ために `_prev.draftId` を server action 内で参照すれば再送防止できる。

- **`DraftSaver` 内の `useEffect([saved, onSaved])` (MEDIUM#2)**
  `saved` (useActionState の結果オブジェクト) は action 発火のたびに **新しい reference** で返ってくるため `saved.ok && saved.draftId` が変わらなくても `onSaved(saved.draftId)` が再度 set される可能性。`onSaved` は親で `setDraftId` を呼ぶので React の `Object.is` で短絡されるが、`saved.draftId` を `useRef` で記憶してから dedupe するのが安全。

- **`DraftSaver` で `state` を `JSON.stringify` した hidden input に詰める (MEDIUM#3)**
  これは Server Action の常套手段ではあるが、**Step5 までの全 state を毎回送信** している。Step1〜4 の draft 保存時に Step5 の `consentPolicy:false` などまで往復するため、ペイロード肥大とログ汚染のリスク。
  → **修正案**: `saveDraft` には `step1` + `step2.companyName` + `step3.icp要約` のみ送るスリム DTO を別途定義する。

- **`launchCampaign` 後の form リセット (LOW#2)**
  `redirect(...)` が成功時は走るので問題ないが、失敗時にもう一度ボタンを押せる UI 設計になっており、その時 `result.message` は残り続ける。`role="alert"` だがメッセージのライフサイクルが曖昧。

- **`page.tsx` の `dynamic = "force-dynamic"` + `fetchCache = "force-no-store"` (LOW#3)**
  認証セッションを使うので妥当だが、`dynamic = "force-dynamic"` だけで `fetchCache` は冗長 (force-dynamic がそれを内包)。

**Score: 17/20** (HIGH#3, MEDIUM#2, MEDIUM#3)

---

### 軸3: アクセシビリティ (16 / 20)

| 観点 | 状態 | 評価 |
|---|---|---|
| Stepper `role="list"` + `aria-current="step"` | あり | OK |
| Stepper の `<button>`/`<span>` 切替 | `Tag = onJump && isReachable ? "button" : "span"` | NG (HIGH) |
| Step1 Radio の `fieldset/legend` | あり (`legend` は `sr-only`) | OK |
| Step3 地域/Funding | `role="group"` + `aria-pressed` の `<button>` | OK (Toggle) |
| Step4 Tone/Length | `<button aria-pressed>` のみ。`role="group"` も `aria-label` も無し | NG (MEDIUM) |
| Step5 ReviewMode | `role="radiogroup"` + 中身は `<input type="radio">` | OK |
| Checkbox `aria-checked` + `aria-label` | あり | OK |
| TagInput | `role="group"` + `aria-label` あり / 削除ボタン `aria-label` あり | OK |
| URL Input `type="url"` | あり | OK |
| エラー `role="alert"` | あり (HIGH 寄りで多用しすぎ) | △ |
| `aria-invalid` | Step2/3/4 概ねあり、Step5 に欠落 | NG (MEDIUM) |
| `aria-describedby` でエラー文紐付け | **なし** | NG (HIGH) |
| カラーコントラスト (`text-ink-400` on white) | 推定 < 4.5:1 | NG (MEDIUM) |
| キーボード操作 (Stepper) | `<span>` のときキーボード到達不可は意図的 | OK |

**問題点**:

- **HIGH#4 — エラーと入力フィールドの関連付け (`aria-describedby` / `aria-errormessage`)**
  `errors?.firstDm` などのエラーは `role="alert"` だけで対応しており、**`<textarea>` から `aria-describedby="..."` で参照されていない**。スクリーンリーダーで「フィールドにフォーカスしたときにエラーが読み上げられない」典型問題。`aria-invalid` だけでは「無効である」ことしか伝わらず、何が問題かが伝わらない。
  → **修正案**: `Field` コンポーネント側で `id` を払い出し、`children` を `React.cloneElement` か Context で `aria-describedby` を注入する。各エラー `<div>` に対応する `id` を付与。

- **HIGH#5 — Stepper の `<span>` 切替で `aria-current` が `<span>` にも適用される**
  `aria-current="step"` を `<button>` または `<span>` 共通で付けているが、`<span>` (= 未到達ステップを含む UI) でも `current === s.id` の時に `<span>` がレンダリングされうる…と思いきや、**`isReachable` が真でないと button にならない**ので、未到達ステップに current が当たることはなく**論理的にはOK**。ただし、`type="button" as const` を `<span>` 要素にも一旦割り当てて `undefined` 振り分けしている書き方は型不純で、`Tag` ジェネリックスとして書き直すのが妥当。
  ```ts
  // 推奨パターン
  const commonProps = { 'aria-current': isCurrent ? 'step' : undefined, className: ... };
  return isReachable && onJump
    ? <button type="button" onClick={...} disabled={!isReachable} {...commonProps}>{...}</button>
    : <span {...commonProps}>{...}</span>;
  ```

- **MEDIUM#4 — Step4 の Tone/Length トグル群に `role="group"`/`aria-label` がない**
  Step3 の REGIONS/FUNDING は `role="group" aria-label="..."` を持っているのに、Step4 の Tone/Length 群 (`step-message.tsx:82-99`, `:101-118`) は持っていない。`Field label="トーン"` の `<label>` で包まれてはいるが、`<label>` は単一コントロール用であり、`<button>` 群を子に持つのはセマンティクス違反 (`<label>` の `for/控制` 関係が崩れる)。
  → **修正案**: Step4 でも Step3 同様 `role="group" aria-label="トーン"` を使う。`Field` の `<label>` を `<div>` に変えることが必要 (Step1 でも同じ問題候補)。

- **MEDIUM#5 — Step5 `consentPolicy` エラーが該当 Checkbox に紐付いていない**
  `errors?.consentPolicy` を `Field` ではなく独立した `<div role="alert">` で表示しており、`<Checkbox>` に `aria-invalid` も `aria-describedby` もない。

- **MEDIUM#6 — `text-ink-400` (placeholder) on white**
  `--color-ink-400` の値は不明だが、placeholder/disabled テキストが ink-400 / 一部 ink-500 で出ており、WCAG AA (4.5:1 for normal text) を満たさない可能性。`text-ink-500` で description を出している箇所も 11px と小さいため、ANY 4.5:1 必須。
  → **対応**: CSS 変数の値を測ること。`docs/design/tokens.css` などで `--color-ink-500` のコントラスト比を記録。

- **LOW#4 — Step2「強み」TagInput `aria-label="強みタグ"` の「タグ」は冗長**
  「強み」だけで十分。スクリーンリーダーで「強みタグ・グループ」となる。

**Score: 16/20**

---

### 軸4: エッジケース (15 / 20)

| 観点 | 状態 | 評価 |
|---|---|---|
| 空配列 `state.step5.accountIds` 未定義時の preview | `state.step5?.accountIds.includes(...)` で `step5` undef なら `.includes` で TypeError | NG (HIGH) |
| `Math.min(...[])` = `Infinity` | `selected.length > 0 ? ... : [25]` で回避済み | OK |
| URL 再ロード時に step 復元 | `initialStep = clampStep(Number(sp.get("step") || 1))` で復元 | OK |
| LocalStorage 復元 | `useEffect` で復元、`hydrated` フラグで savemerge | OK |
| LocalStorage 破損データ | `try { JSON.parse } catch {}` で握りつぶし | △ (黙殺) |
| `headcountMin > headcountMax` | Zod で **未検証** | NG (HIGH) |
| `dailyLimit` 0 入力 | `Number(e.target.value) \|\| 1` → 0 が 1 に化ける | △ (意図的ならOK) |
| 同時タブで draft 上書き | 競合制御なし | NG (MEDIUM) |
| 認証切れ時 (DraftSaver) | `session === null` で `localStorage 保存` メッセージ返す | OK |
| LocalStorage SSR 安全性 | `useEffect` 内で `window.localStorage` アクセス | OK |
| `parsed.state` の妥当性検証 | `as { state: WizardState; ... }` で**型 assertion のみ**、Zod 検証なし | NG (MEDIUM) |

**問題点**:

- **HIGH#6 — `WizardPreview` の null safety 不足**
  ```ts
  const selected = accounts.filter((a) => state.step5?.accountIds.includes(a.id));
  ```
  `state.step5` が undefined のとき `state.step5?.accountIds` は `undefined` で、`undefined.includes` は TypeError。 optional chaining が `accountIds` まで届かない誤用。
  → **修正案**: `state.step5?.accountIds?.includes(a.id) ?? false`。

- **HIGH#7 — `headcountMin > headcountMax` の検証欠落**
  Zod スキーマ `Step3Schema` に `superRefine` がなく、UI 側でも `min/max` 関係を検証していないため、ユーザが min=10000 max=10 と入力できる。`estimateReach` の `headcountSpan = Math.max(10, step3.headcountMax - step3.headcountMin)` で `Max(10, -9990) = 10` となり、リーチが過小推定される。
  → **修正案**: `Step3Schema.superRefine` で `if (v.headcountMin > v.headcountMax) ctx.addIssue(...)` を追加。Step5 の `startTime >= endTime` と同じパターン。

- **MEDIUM#7 — LocalStorage 復元時に Zod 検証していない**
  ```ts
  const parsed = JSON.parse(raw) as { state: WizardState; ... };
  if (parsed.state) setState(parsed.state);
  ```
  破損 / 古いバージョン / 攻撃者がコンソールから注入したペイロードが信頼されてしまう。`WizardSchema.safeParse(parsed.state)` を通すべき。STORAGE_KEY に `v1` を含めているがマイグレーション戦略なし。

- **MEDIUM#8 — URL→state 同期の double-effect 問題**
  ```ts
  useEffect(() => {
    const fromUrl = clampStep(Number(sp.get("step") || 1));
    if (fromUrl !== step) setStep(fromUrl);
  }, [sp, step]);
  ```
  `goStep` も `router.replace(...)` するため `sp` が新しくなる → effect が再走 → `fromUrl === step` で no-op になる。動くが、`step` を deps に入れた結果 **`setStep` 自身が effect の再走を引き起こす**。React StrictMode で見つけにくいバグの温床。
  → **修正案**: deps から `step` を外し、`sp` のみで判定。または `useSyncExternalStore` を導入。

- **MEDIUM#9 — `goStep` で `setFurthest` のロジックが不可逆**
  ステップを戻ったあと、編集内容を空にしてから「次へ」を押すと `canProceed=false` で進めないが、Stepper の furthest はそのまま → 飛び越えジャンプで進めるため**バリデーション skip 抜け穴**。
  → **修正案**: `furthest` をジャンプ時に `Math.min(furthest, step)` で縮める、または各ステップ進む直前に再 validate。

- **LOW#5 — TagInput の `onBlur={() => commit(draft)}` 競合**
  「追加」ボタンを `onMouseDown` で押す前に input から blur されると、`commit(draft)` が走り `setDraft("")` するため**「追加」ボタンを押した瞬間に追加が二重に走る、または draft が空になって追加が無効化される**経路がある。実測すべき。
  → **修正案**: 「追加」ボタンを `onMouseDown={e => e.preventDefault()}` で focus を保つ。または `onBlur` を削除して Enter / カンマ / 「追加」ボタンのみで commit。
  なお、`commit(raw)` 自体は `if (!item) return;` で空 commit を防止しているので**空 commit 連発の懸念は不在**。

**Score: 15/20**

---

### 軸5: コード匂い (16 / 20)

| 観点 | 状態 | 評価 |
|---|---|---|
| 重複定義 | `Field` が 3 ファイルで再定義、`AccountOption` と `AccountListItem` が二重 | NG |
| 未使用コード | `updateStep` 未使用、`STORAGE_KEY` の `v1` 動作未実装 | NG |
| 命名 | `STEPS` の `key` が "objective"/"product"/.. と stepN ではない | OK |
| 巨大コンポ | `WizardShell` 409 行 (推定)、`StepMessage` 271 行 | △ |
| Magic number | `25` (dailyLimit デフォルト), `10/10000` (headcount), `1500` (firstDm 上限) の散在 | △ |
| ロジック散在 | `wizard-shell.tsx` の `setState` 内に Step2〜5 のデフォルト値を**重複定義** | NG |
| エラーハンドリング | server action の catch で `console.error` を `NODE_ENV !== "production"` で出し分け | OK |

**問題点**:

- **MEDIUM#10 — `Field` コンポーネントが 3 ファイル (`step-product`, `step-icp`, `step-delivery`, `step-message`) で重複定義**
  全 4 つでほぼ同一実装 (`step-product` だけ counter prop あり)。
  → **修正案**: `components/ui/field.tsx` に統一。`label`/`hint`/`required`/`error`/`counter`/`htmlFor`/`describedById` を持つ単一実装。これにより HIGH#4 (aria-describedby) も自動的に解決。

- **MEDIUM#11 — `AccountOption` (step-delivery) と `AccountListItem` (server/queries/accounts) が同一形**
  双方 `id/name/warmupDay/status` を持つ。
  → **修正案**: `server/queries/accounts.ts` で `AccountListItem` を export し、`step-delivery.tsx` は `import type { AccountListItem as AccountOption } from "@/server/queries/accounts";` または直接利用。

- **MEDIUM#12 — `WizardShell.setState` 内のデフォルト値定義が Step ごとに重複**
  `step2`, `step3`, `step4`, `step5` の各 `onChange` 内で空ベース値 (`companyName: "", productSummary: "", strengths: [], ...`) が**コンポーネントの内部**にハードコードされている。Zod スキーマの `default()` が活きていない。
  → **修正案**:
  ```ts
  const INITIAL: WizardState = {
    step1: undefined,
    step2: { companyName: "", productSummary: "", strengths: [] },
    step3: Step3Schema.parse({}),  // default が走る
    step4: Step4Schema.partial().parse({}),
    step5: Step5Schema.partial().parse({}),
  };
  ```
  ただし `Step4Schema.superRefine` などがあるとパースエラーになる → ハッカブルだが各 Schema に `.partial()` ラッパーを用意するか `.extend({}).optional()` で初期値を作る方が安全。

- **LOW#6 — `STEPS` の `key` が "objective"/"product"/... なのに `WizardState` のキーは "step1"/"step2"/...**
  対応関係を埋めるマッピングテーブルがない。`STEPS[0].key === "objective"` と `state.step1.objective` がそれぞれ独立しており、片方をリネームしたときに整合が崩れる。
  → **修正案**: `STEPS` の各エントリに `stateKey: keyof WizardState` を追加。

- **LOW#7 — `stepTitle(s)` が配列の `[""]` を先頭に置く形 (`step-shell.tsx:383`)**
  ```ts
  return ["", "目的を選んでください", ...][s] ?? "";
  ```
  `s` は 1-indexed なのでこうなる。`STEPS` テーブルに `title` を入れて参照する方がメンテブル。

- **LOW#8 — `WizardShell.tsx` の `state.step5?.accountIds.length` を audit `diff` に渡す部分 (`server/actions/wizard.ts:185`)**
  `accountIds` は `string[]` で `min(1)` だが、`state.step5?.accountIds.length` は `step5` が undef なら例外。`.accountIds?.length` で optional chain 必須。

- **LOW#9 — Magic numbers 一覧**
  `25` (defaultDailyLimit), `09:00/18:00`, `10/10000` headcount, `1500/40/300` 文字数。`lib/wizard-schema.ts` 末尾に `DEFAULTS` という const として export し、UI から参照すべき。

**Score: 16/20**

---

## 優先度別 修正リスト

### HIGH (PR ブロック相当 / 90+ 到達には必須)

| # | 箇所 | 内容 | 影響 |
|---|---|---|---|
| **H1** | `wizard-shell.tsx:241` | `consentPolicy: false as unknown as true` を撤去し、`Step5Schema` の `consentPolicy` を `z.boolean().refine(v => v === true, ...)` に変更 (UI 型と Zod 型を整合させる) | 型安全 + ランタイム整合 |
| **H2** | `step-icp.tsx:93,101,102,122,130,131` | `as never` 撤去。`REGIONS` / `FUNDING` の `value` を `Step3["regions"][number]` 等で型注釈し、`Array.from(set)` の戻り値も同型でナロー | 型推論回復 |
| **H3** | `app/(app)/campaigns/new/page.tsx` | `<WizardShell />` を `<Suspense fallback={...}>` でラップ。`useSearchParams` の Next 15 ベストプラクティス遵守 | ビルド警告 / 将来 ISR 切替時の互換 |
| **H4** | `step-product/icp/message/delivery.tsx` | `Field` を共有コンポーネントに統合し、`htmlFor` / `aria-describedby="<errId>"` を入力に注入 | a11y (SR 体験) |
| **H5** | `stepper.tsx:24-29` | `<Tag>` 動的タグ切替を廃止し、`isReachable && onJump` 分岐で `<button>` / `<span>` を明示。`aria-current` の付け方を要素別に最適化 | 型/ARIA 整合 |
| **H6** | `wizard-preview.tsx:21` | `state.step5?.accountIds?.includes(a.id) ?? false`。同じく `dailyTotal/effDaily` 周辺の null safety | ランタイム例外回避 |
| **H7** | `lib/wizard-schema.ts` Step3 | `superRefine` で `headcountMin <= headcountMax` を強制 | 入力整合 |

### MEDIUM (90 越えの加点要素)

| # | 箇所 | 内容 |
|---|---|---|
| M1 | `wizard-shell.tsx:108` | `tryParse` の `schema` 型を `ZodSchema` (Zod本物) に変更。`result.data` 取り出し未対応 |
| M2 | `DraftSaver` | `saved.draftId` の dedupe を `useRef` で行うか、useEffect deps を `saved.ok && saved.draftId` のみに絞る |
| M3 | `DraftSaver` | `state` 全体を hidden input に詰めず、`saveDraft` 専用のスリム DTO を送信 |
| M4 | `step-message.tsx` Tone/Length | `role="group" aria-label="..."` を Step3 と同様付与 |
| M5 | `step-delivery.tsx:217` | `consentPolicy` の Checkbox に `aria-invalid` / `aria-describedby` |
| M6 | グローバル | `--color-ink-400` / `--color-ink-500` の WCAG AA 検証 |
| M7 | `wizard-shell.tsx:60-70` | LocalStorage 復元時に `WizardSchema.safeParse` を通す |
| M8 | `wizard-shell.tsx:73-77` | URL→state 同期の `useEffect` deps から `step` を外す |
| M9 | `wizard-shell.tsx:goStep` | 戻ったとき `furthest` を縮めるか、ジャンプ時に未来 step の Zod 再検証 |
| M10 | 4 ファイル | `Field` を `components/ui/field.tsx` に統合 |
| M11 | `step-delivery.tsx` | `AccountOption` を `AccountListItem` から import 統合 |
| M12 | `wizard-shell.tsx` | Step2〜5 の `setState` のデフォルト値を `INITIAL_STATE` 定数に抽出 |

### LOW (Nitpick / 任意)

| # | 箇所 | 内容 |
|---|---|---|
| L1 | server actions | `_prev` を活用するか引数名を `_prev` のままにする (現状OK) |
| L2 | `LaunchButton` | エラーメッセージのライフサイクル (再 submit でクリア) |
| L3 | `page.tsx` | `fetchCache = "force-no-store"` は redundant |
| L4 | `step-product.tsx:83` | `aria-label="強みタグ"` → `"強み"` |
| L5 | `tag-input.tsx:86` | `onMouseDown e.preventDefault()` で「追加」ボタンの focus 競合を防ぐ |
| L6 | `lib/wizard-schema.ts` | `STEPS` に `stateKey: keyof WizardState` を追加 |
| L7 | `wizard-shell.tsx:383` | `stepTitle` を `STEPS` テーブルから参照 |
| L8 | `server/actions/wizard.ts:185` | `state.step5?.accountIds?.length` |
| L9 | `lib/wizard-schema.ts` | Magic number を `DEFAULTS` 定数に集約 |

---

## チェック箇所への個別回答 (ユーザ指示の精査リクエスト)

### Q1. `wizard-shell.tsx` の `updateStep` ジェネリック型が壊れていないか?

> シグネチャは妥当だが**未使用**。実装内の `{ ...prev[key], ...partial }` は `prev[key]` が `undefined` のとき `{ ...undefined, ...partial }` を spread していて挙動上は OK (空 + partial = partial)、しかし**型上 `prev[key]` が `WizardState[K] | undefined`** なので `partial as WizardState[K]` を渡すケースの戻り値が `{[k in keyof Partial<WizardState[K]>]: ...}` 相当に narrow されず TS 厳格モードで弾かれ得る。さらに function ブランチ (`(prev) => prev`) では `prev[key]` を渡しているが、partial ブランチでは `{ ...prev[key], ...partial }` という**スプレッド型ガード**で `prev[key]: undefined` を許してしまう非対称。

> **判定**: ジェネリックは壊れていない (`<K extends keyof WizardState>` は正しい) が、**シグネチャ <-> 実装の整合に穴があり、かつ完全に未使用** なので**削除推奨**。代わりに各 Step の `setState` 内重複 default を `updateStep` で正しく書き直すべき。

### Q2. Step5 `consentPolicy: boolean` vs `z.literal(true)` の整合 (`false as unknown as true` キャスト)

> **完全に NG**。`z.literal(true)` の型は `true` であり、TS の型レベルでは「常に `true` 」を要求する。UI 上 `false` を初期値にしたいが Zod が拒むため、強引なキャストで型を欺いている。実害は:
> 1. Step5 が `state.step5` に**「同意済の状態を初期値とする」と型上は宣言**している → 別の開発者が `if (state.step5?.consentPolicy)` で初期値=true を前提に書く誘発要因。
> 2. `Step5Schema.safeParse` 実行時に `consentPolicy: false` が真っ当に **`invalid_literal`** エラーになるが、その時のメッセージは `errorMap` で「利用規約への同意が必要です」になる ✓ — つまり**実害は Zod が救っているだけ**でコードは型と意図がずれている。
>
> → **推奨修正**:
> ```ts
> consentPolicy: z.boolean().refine(v => v === true, { message: "利用規約への同意が必要です" }),
> ```
> こうすれば UI 側で `false` を初期値にできる (`Partial<Step5>` で undefined にできる) し、`as unknown as true` も消える。スキーマ型は `boolean` だがバリデーション結果は `true` だけが通る。

### Q3. Step3 の `regions`/`funding` バックエンド型と UI 型のずれ

> ずれている。`Step3Schema.regions: z.array(z.enum(["jp","global","us","eu"]))` (Zod) vs UI の `REGIONS` 配列 (`{value: "jp" | ..., label: string}[]`) は **value 部分の型を別個に定義**している。同期は手書きで、Zod の enum を追加したとき UI を忘れる。
>
> → **推奨修正**:
> ```ts
> // wizard-schema.ts
> export const REGIONS_ALL = ["jp", "global", "us", "eu"] as const;
> export type Region = typeof REGIONS_ALL[number];
> // step-icp.tsx
> const REGIONS: { value: Region; label: string }[] = [...];
> ```
> これにより `as never` も消え、Zod と UI の単一情報源化が達成。

### Q4. `stepErrors` の `tryParse` 型 (Zod の正しい安全な使い方)

> 現状の structural 型 `{ safeParse: (v: unknown) => { success: boolean; error?: {...} } }` は Zod の本物の判別 union を**模倣しているが不正確**。`r.success === true` のときに `r.error` を `undefined` と保証する判別子になっていない。
>
> → **推奨修正**:
> ```ts
> import type { ZodTypeAny } from "zod";
> const tryParse = (schema: ZodTypeAny, data: unknown) => {
>   const r = schema.safeParse(data);
>   if (r.success) return;
>   for (const issue of r.error.issues) {
>     const key = (issue.path[0] as string | undefined) ?? "_";
>     if (!result[key]) result[key] = issue.message;
>   }
> };
> ```

### Q5. `DraftSaver`/`LaunchButton` 内で `useActionState` を form 内 `useFormStatus` と組み合わせる位置

> **正しい**。`useActionState` は form 外でも form 内でも呼べるが、`useFormStatus` は **form の子コンポーネント** から呼ぶ必要があり、現状の `DraftButton` / `LaunchSubmit` は `<form>` の中にレンダリングされている ✓。
>
> ただし**注意点**:
> - `useActionState` を `DraftSaver` という親で呼び、`formAction` を `<form action={formAction}>` に渡す構造は React 19 のドキュメントが推奨する形 ✓。
> - `useFormStatus` を `DraftButton` (form の直下) で呼ぶのは ✓。
> - **`saved` 結果を Effect で `onSaved` に伝搬している部分が惜しい**。React 19 ベストプラクティスは「Effect で派生せず、render 時にメッセージを表示する」だが、`draftId` を親 state に持ち上げる必要があるので Effect 必要。`saved.draftId` を `useRef` で記憶して dedupe するか、`useFormState` (旧) ではなく `useActionState` の戻り値オブジェクトに `key` を持たせる方法もある。

### Q6. TagInput の `commit`/`blur` 競合 (空 commit が連発しないか)

> **空 commit は連発しない**。`commit(raw)` は `if (!item) return;` で空文字を弾く ✓。
>
> ただし**別の競合がある**:
> - 「追加」ボタンを `<input>` のフォーカスから `onBlur` 経由でクリックした場合、blur が `commit(draft)` を走らせて `setDraft("")` → その後ボタンの `onClick` も走るが draft はもう空 → 二度目の commit は `!item` で no-op。**結果として動作上は1回だけ追加され見かけ上問題なし**。
> - 重複タグの suppression は `if (value.includes(item)) return;` で OK。
> - Enter / カンマの後の `onBlur` 競合: Enter で `e.preventDefault(); commit()` → input にフォーカス残るので blur 起きず ✓。
> - **問題は**: 入力 → タブキー → input から離脱 → onBlur で commit → 隣接フォーカス先(削除ボタンなど)で意図せず focus 喪失。これは UX 問題で、`commit` ボタンに mouseDown preventDefault を入れるのが定石。
>
> → **判定**: 空 commit 連発の懸念はない。**Tab 離脱時の意図しない commit と、追加ボタン focus 競合** が残課題 (LOW)。

---

## 結論

- **総合スコア: 79 / 100**
- **90+ 判定: 未到達 (FAIL)**
- HIGH を 5 件 (H1〜H5) 解消すれば 91 前後、加えて MEDIUM を 4-5 件解消すれば 94 前後到達。
- **コア構造 (Server Component / Client Wizard / useActionState / Zod / a11y 基盤) は健全**。問題は「型のごまかし1箇所 (consentPolicy)」「Zod の structural 模倣」「Field の重複」「Suspense 不在」「null safety 1箇所」など、 修正コスト**合計 1〜2 PR 程度** で 90+ に到達可能なクオリティ。

---

## 参考: 関連ファイル一覧 (absolute paths)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\new\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-shell.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\stepper.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-objective.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-product.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-icp.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-message.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-delivery.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-preview.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\wizard-schema.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\wizard.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\accounts.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\ui\tag-input.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\ui\checkbox.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\ui\input.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\ui\button.tsx`
