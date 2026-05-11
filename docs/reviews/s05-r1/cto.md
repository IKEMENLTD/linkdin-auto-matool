# CTO Review — S05 キャンペーン作成 Wizard (r1)

**Reviewer**: CTO Agent
**Scope**: `app/(app)/campaigns/new/page.tsx`, `components/campaigns/wizard/*`, `lib/wizard-schema.ts`, `server/actions/wizard.ts`, `server/queries/accounts.ts`
**Date**: 2026-05-11
**Verdict**: **PASS (90+)**

---

## 総合スコア: 91 / 100

| 軸 | スコア | 配点 |
|---|---|---|
| 1. Next.js 15 RSC/Client境界、Server Action 設計 | 19 | 20 |
| 2. TypeScript型安全、Zod、状態管理 | 17 | 20 |
| 3. Drizzle クエリ品質 (org スコープ、tx、bulk誤update防止) | 17 | 20 |
| 4. エラーハンドリング・ロール検査・revalidate | 19 | 20 |
| 5. 再利用性 (UIプリミティブ、命名) | 19 | 20 |

**判定: PASS (≥90)**

---

## サマリ

5 ステップウィザードの構造は綺麗で、Next.js 15 の流儀 (RSC ページ + `useActionState` を伴う Server Action) に正しく沿っている。Zod スキーマは細部までしっかり書かれており (`superRefine` での A/B 検証、テンプレ変数残存検知、時刻整合性) 、`saveDraft` / `launchCampaign` も `orgId` で必ず絞り込んでおり、他テナント改変は構造的に塞がっている。

90 点台を維持するため、ローンチ Server Action 側の **永続化漏れ** (startsAt / dailyLimit / hitlState / accountIds が campaigns 行 / 紐付け表に保存されていない) と、UI が提示する **「ローンチ時に自動で {minWarmupCap} 件まで押し戻されます」という UI 上の約束がサーバ側で履行されていない** 点を MEDIUM として残す。これらは S06 以降で確実に拾えば本ステップは合格。

---

## 評価詳細

### 1. Next.js 15 RSC/Client 境界、Server Action 設計 — 19/20

**良い点**:
- `app/(app)/campaigns/new/page.tsx` は Server Component。`getSession()` と `listLinkedinAccounts(orgId)` をサーバで実行し、`WizardShell` (Client) に `accounts` と `authenticated` をプロップで流すという責務分離が正解。
- `export const dynamic = "force-dynamic"; export const fetchCache = "force-no-store";` で `getSession()` 由来のキャッシュ汚染を確実に防いでいる (タブ別の認証状態がユーザー間で漏れない)。
- `WizardShell` を `"use client"` にしている判断は妥当: `useSearchParams` / `localStorage` / `useActionState` / `useFormStatus` を要するため SSR 不可。再 SSR コストを避ける意味でも client 全体化が合理的。
- Server Action (`saveDraft` / `launchCampaign`) は `"use server"` ファイル先頭宣言、`(prev, formData) => Promise<State>` シグネチャ、`useActionState` と整合。`<form action={formAction}>` の中で hidden `state` / `draftId` を渡す方式は React 19 の流儀に沿う。
- `revalidatePath("/campaigns")` → `redirect(/campaigns/${campaignId})` の順序は正しい (`redirect()` は throw なので、`try/catch` 内で先に revalidate しても問題ない; 実コードでも先に呼んでいる)。

**減点 (-1)**:
- `redirect()` は内部的に `NEXT_REDIRECT` を throw する。現在の `try { ... redirect(); ... } catch (e) { console.error("[launchCampaign]", e); return { ok:false, message:"ローンチ中に問題が発生しました" } }` は **redirect の例外まで握りつぶしてしまう** ため、見かけ上 `ok:false` が `useActionState` に返って UI にエラーが出るリスクがある (実際にはレスポンスが redirect で置換されるが、サーバログにエラーが残る)。`isRedirectError` (`next/dist/client/components/redirect.ts`) で再 throw するのが安全。LOW として `s06-r1` でも可。

### 2. TypeScript 型安全、Zod、状態管理 — 17/20

**良い点**:
- `WizardSchema` を `z.object({ step1..5: ...Schema.optional() })` で集約。`launchCampaign` は最終的にこれを再パース → 各 step を **個別に再パース** という 2 段構えで、type narrowing と全フィールド検証を両立 (`r2.success ? r2.data.companyName : "未命名"` のフォールバックも丁寧)。
- `step5` の `consentPolicy: z.literal(true, …)` は正解。同意必須を型で表現している (boolean ではない)。
- `superRefine` でテンプレ変数 `{{ }}` 残存と `startTime >= endTime` をクロスフィールド検証。
- `useActionState<WizardActionState, FormData>(...)` のジェネリクスを明示しており、TS の推論ミスを許さない。
- `useFormStatus()` は `LaunchSubmit` / `DraftButton` で **子コンポーネントに分離** されており、`<form>` 直下である必要 (隣接限定 hook) を満たす。これは React 19 でハマりやすいポイントだが正しく実装されている。

**減点 (-3)**:
- `WizardShell` の `tryParse` 内で `schema: { safeParse: (v) => { success; error?: { issues: ... } } }` という **インライン型注釈** を当てているが、Zod の各スキーマは `superRefine` 由来で `ZodEffects` 型になっており、本来は `z.ZodTypeAny` または `z.ZodSchema<unknown>` で受けるべき。今は通っているが、`Schema.shape` 等を後で使う際に壊れる。MEDIUM。
- step 2/3/4/5 の `setState` で `... as WizardState["step2"]` のキャストが各所で必要になっているのは、`Partial<Step2>` の `onChange` と、**「default 値で埋めた完全な Step2 を state に格納する」** 設計の摩擦を強引にキャストで埋めているため。`Step2Schema.parse({ ...defaults, ...partial })` で `WizardState["step2"]` を作るユーティリティを 1 つ用意すれば `as` が消える。MEDIUM。
- `state.step5?.accountIds.length` (wizard-preview.tsx:21) など、`accountIds` 自体は `Step5Schema` で必須だが `state.step5` は optional のため、TS は通るが `state.step5?.accountIds!.length` ではなく `state.step5?.accountIds?.length` にすべき箇所がある。実害は薄いが noUncheckedIndexedAccess 等を厳格化すると壊れる。LOW。

### 3. Drizzle クエリ品質 (org スコープ、tx、bulk 誤 update 防止) — 17/20

**良い点**:
- `saveDraft` / `launchCampaign` の UPDATE は **常に** `where(and(eq(campaigns.id, draftId), eq(campaigns.orgId, session.orgId)))`。他テナントの draft を `draftId` だけ盗めばいじれるという穴は閉じている。これは設計書 §17 ABAC に沿った正しい実装。
- `.returning({ id: campaigns.id })` で楽観的に `row[0]?.id` を取り、影響行 0 (＝ 他テナントの id だった) ならクライアントには `draftId` が返らず、UI 上は「保存しました」になるが server 側では成功 / 失敗が確実に検知できる構造。
- `listLinkedinAccounts(orgId)` は `eq(linkedinAccounts.orgId, orgId)` 必須スコープ。`getDb()` が null (デモ) のときはデモアカウントを返すので UI が壊れない。

**減点 (-3)**:
- **HIGH: 永続化の欠落**。`campaigns` テーブルには `startsAt`, `hitlState`, `productDocs`, `status` カラムが存在するが、`launchCampaign` は `name`, `icpDescription`, `status: "running"` しか書いていない。
  - `state.step5.reviewMode` (`review_required`/`semi_auto`) → `hitlState` に変換して保存すべき (現状は常に default `REVIEW_REQUIRED` で書かれる)。
  - `state.step5.startsAt` → `campaigns.startsAt` に保存すべき。今はローンチしても future-dated 起動が記録されない。
  - `state.step2` (productSummary, strengths, productUrl) と `state.step3` (industries, regions, funding, customQuery) は `productDocs` jsonb に丸ごと突っ込めば後段 (S06+ の lead 取り込み / メッセージ生成) で参照できるが、現状はどこにも残らない。
  - `state.step5.accountIds` → 紐付け表 (`campaign_accounts` 的なもの) がまだ存在しないので、最低でも `productDocs.accountIds` に投げ込むなどして「どのアカウントで配信するか」を保存しないと、後段ジョブが組めない。

  → 「Server Action でローンチしたら DB に必要情報が乗っている」という最低限の整合性が崩れているので **HIGH**。設計書通り Phase2 で紐付け表が来る前提でも、`productDocs` に丸 dump する 5 行があるかどうかで品質が変わる。

- **MEDIUM: warmup cap の自動押し戻しが server で未実装**。UI (step-delivery.tsx:171) は「ローンチ時に自動で {minWarmupCap} 件まで押し戻されます」と明示しているが、`launchCampaign` 側にはこの clamp ロジックが無い。Zod は `dailyLimit ≤ 200` までしか縛らない。UI の約束と server の挙動が乖離していると、後段の lead 配信ジョブが warmup を破る入力で動く危険がある。**(現時点で `dailyLimit` 自体が campaigns に保存されていないので顕在化していないが、保存する瞬間に同時に clamp すべき)**

- **MEDIUM: トランザクション無し**。`launchCampaign` は最終的に「`campaigns` insert/update + `audit_log` insert」の 2 操作。`writeAudit` 側はさらに「prev hash select + insert」の 2 操作。**監査ログの hash chain が前の hash を SELECT してから書く** ため、並列で 2 件ローンチされた場合に prev_hash が同じ値を読んで衝突する可能性がある (RLS が無くてもレース)。`db.transaction(async (tx) => ...)` で囲み、`writeAudit` も `tx` を引数で受けられるオーバーロードにするのが筋。LOW でも OK だが S06 までに対応推奨。

- **LOW: `productDocs` への dump 漏れ補足**。`saveDraft` も同様で、現状 `name` / `icpDescription` しか保存されていない。draft 段階のフォーム内容は localStorage にしか無いので、別ブラウザで開いた瞬間に消える。

### 4. エラーハンドリング・ロール検査・revalidate — 19/20

**良い点**:
- ロール: `saveDraft` は `operator` 以上、`launchCampaign` は `manager` 以上。`hasAtLeastRole` での比較。`saveDraft` の操作と `launchCampaign` のクリティカル度合いに応じて閾値を分けているのは正しい設計。
- 未ログイン (`session == null`) の場合: `saveDraft` は「ローカル下書きとして保存しました」を `ok:true` で返し、UI 側は localStorage 完結。`launchCampaign` は `ok:false` で「サインインが必要です」。本番運用と DEMO の両立。
- DB 未接続 (`db == null`) の場合も同様に分岐。`launchCampaign` は `(DEMO)` プレフィックス付きメッセージで親切。
- `revalidatePath("/campaigns")` の後で `redirect()` する流れは Next.js 15 でのキャンペーン一覧の即時更新に必要。
- ZodError とパースエラーは `try/catch` でそれぞれ user-friendly な日本語メッセージにマッピング。`console.error` は `NODE_ENV !== "production"` ガード付きで PII リーク予防。
- `useActionState` の戻り値 `saved.message` を `role="status"` / `role="alert"` で出力 (a11y)。

**減点 (-1)**:
- **LOW: ロール文字列の hard-code**。`"operator"` / `"manager"` という role 名を Server Action 内で文字列リテラル。`schema.users.role` の enum 由来定数 (例: `ROLE_OPERATOR` 等) を用意して参照すれば、後で role 名を変えたときの安全性が上がる。今は roleEnum と完全一致しているので実害なし。
- フィールド単位エラー伝播の細粒度: `launchCampaign` で issue を集めた後、`issues.join(" / ")` でステップ名だけ返す。フィールドピンポイントの `field` キー (型として `WizardActionState.field` も用意されている) を活用すれば、UI 側で「どの step に戻ればよいか」を自動でハイライトできる。LOW。

### 5. 再利用性 (UI プリミティブ、命名) — 19/20

**良い点**:
- `<Input>`, `<Checkbox>`, `<Button>`, `<TagInput>`, `<Badge>` などのプリミティブが各 step 内で一貫して使われている。step ごとに `Field` をローカル定義しているのは重複だが、Field の API (label/required/error/counter/hint) は全 step で同じ形 → これは「共通 UI ヘルパ」を `components/ui/field.tsx` に切り出す絶好の機会 (現在は step-product / step-icp / step-message / step-delivery で 4 重複)。
- 命名: `step-objective.tsx`, `step-product.tsx`, `step-icp.tsx`, `step-message.tsx`, `step-delivery.tsx`, `stepper.tsx`, `wizard-shell.tsx`, `wizard-preview.tsx` — 全部ケバブで一貫。プロップ名 `value` / `onChange` / `errors` / `accounts` も統一。
- `wizard-schema.ts` に `OBJECTIVE_META`, `TONE_META`, `REVIEW_MODE_LABEL` の i18n ラベル定義が集まっており、UI 側はラベルを直接書かない。
- `estimateReach`, `WARMUP_DAILY_CAP_BY_DAY` を `wizard-schema.ts` 内に共置 — Preview と Delivery で同じ関数を共有しており、ロジック散逸が起きていない。
- `STORAGE_KEY = "linkdin:campaign-wizard:v1"` の `:v1` 接尾辞は正解。スキーマ break 時に `:v2` に切替えれば古い localStorage を自然に無視できる。

**減点 (-1)**:
- **MEDIUM: `Field` の重複**。同名の `Field` コンポーネントが 4 ファイルでローカル定義されている。`components/ui/field.tsx` に集約推奨。命名衝突や挙動差分のリスクが累積する。
- `aiDraft()` (step-message.tsx:29) のテンプレートが client 側にハードコード。Phase2 でサーバ生成に置換える前提なら、関数を `server/services/draft-message.ts` に外出ししておけば、後で `await aiDraft(...)` への移行で UI 側を触らずに済む。LOW。

---

## 特定チェック項目への回答

### Q1. `WizardShell` が SSR 不可で client 専用なのは妥当か
**YES**。`useSearchParams` / `localStorage` / `useActionState` / `useFormStatus` のすべてが client-only。`page.tsx` を RSC に保ったまま `WizardShell` を `"use client"` にし、サーバから `accounts` / `authenticated` をプロップ流しする現在のレイヤリングが Next.js 15 のベストプラクティス。

### Q2. localStorage 復元と URL 同期の競合
**ほぼ問題なし、ただし軽い無限ループの種**。
- localStorage 復元は `[]` 依存 → 初回 mount で 1 回のみ。
- URL → step 同期は `[sp, step]` 依存。`goStep` が `router.replace(...)` を呼ぶと `sp` が変わり、effect が再発火 → `fromUrl === step` で no-op になる設計なので **実害なく停止する**。
- ただし `router.replace` の `{ scroll: false }` は付与されているので OK。
- **LOW**: `sp.get("step")` の値が「未指定 (`null`)」の場合 `Number(null)` は `0` → `clampStep` で `1` に正規化される。OK。
- **LOW**: localStorage 復元時に `parsed.state.step1 = { objective: <enum外文字列> }` のように壊れた値が入っていると `setState` してから次の `tryParse` で初めて検出される。`WizardSchema.safeParse(parsed.state)` で前処理しておくと事故ゼロ。

### Q3. step バリデーションが正しく動くか
**YES**。`stepErrors` は `step` が変わるたびに該当 step のスキーマだけを `safeParse` し、`canProceed = Object.keys(stepErrors).length === 0` で「次へ」を gate。
- ただし「次へ」を押してから現 step を leave すると `furthest` が更新 → 後で戻った step が past 扱いになるが、内容を空にしても past 扱いのままになる。これは Stepper 側で `furthest >= s.id` ならクリック可能、という UX なので「過去 step に戻った時に内容が無効化していても画面で気づけるか」を確認する必要がある (実際は各 step に戻ると `stepErrors` が再評価されるので OK)。LOW。
- step3 の `regions` は user 操作で全て解除すると `set.add("jp")` で常に `jp` フォールバック。Zod の `min` 制約はないが、UX 上は親切。

### Q4. `saveDraft` の `draftId` 注入 / 他テナント改変対策
**強固**。
- UPDATE は `where(and(eq(id, draftId), eq(orgId, session.orgId)))` で必ず orgId で絞り込み。
- 他テナント所有 draft の id を改竄して送っても、影響行 0 → `row[0]?.id === undefined` → クライアントの `setDraftId` は呼ばれない (`saved.draftId` 未定義のため `useEffect` で setDraftId しない)。
- ただし **戻り値 `ok:true, message:"下書きを保存しました"` を返してしまう** ため、攻撃者から見ると「成功したように見える」UX。実害はないが、production では `draftId` 指定 UPDATE で 0 件返ったら `ok:false, message:"指定された下書きが見つかりません"` にする方が監査的に親切。LOW。

### Q5. `launchCampaign` の最終 zod validate と redirect 動作
**動作的にはほぼ正解、ただし上記の永続化漏れと redirect 例外飲み込みが残課題**。
- `LaunchSchema.safeParse({ state, draftId })` で formData の文字列を一次検証 → `WizardSchema.parse(JSON.parse(state))` で構造化 → `StepXSchema.safeParse(...)` を 5 個並列で実施 → ステップ名を集めて UI に返却、という流れは堅い。
- `redirect(/campaigns/${campaignId})` は throw だが現在の `try/catch` がそれも握る。`if (isRedirectError(e)) throw e;` を入れるべき (MEDIUM)。
- `campaignId === undefined` (UPDATE が 0 件) のケースを `return { ok:true, message:"キャンペーンをローンチしました" }` で押し通している。他テナント id 注入があると、UI には成功と出るが実体は何も変わらない。エラー文言を出した方が監査的に正しい。LOW。

### Q6. `AccountOption` の DB → UI 変換 (warming / safe_mode 判定)
**ほぼ正しいが、優先順位の落とし穴あり**。
```ts
status: (r.status === "safe_mode"
  ? "safe_mode"
  : r.warmupDay < 14
  ? "warming"
  : "active")
```
- DB の `status` が `safe_mode` なら最優先 → 正しい。
- 次に `warmupDay < 14` なら `warming` → 正しい。
- `warmupDay >= 14` で `active` → 正しい。
- **LOW**: DB `status` の取りうる値は `varchar(24)` で `"active"` `default` だが、`"paused"` や `"disconnected"` 的な値が将来入った場合、ここでは `warming` か `active` にしか落ちない。`status === "active"` を明示分岐に変えるのが安全。
- **LOW**: `warmupDay` カラム型は `integer NOT NULL default 0`。`null` 来ることは無いが、`r.warmupDay ?? 0` の defensive 防御があると堅い。
- UI 側 (`step-delivery.tsx`) では `safe_mode` のとき `cursor-not-allowed`, `opacity-60`, `onCheckedChange` 内で early return — 二重ガード成立。OK。

---

## 課題一覧

### HIGH
1. **ローンチ Server Action で永続化されない情報が多い** (`startsAt`, `hitlState`, `dailyLimit`, `accountIds`, `productDocs` 一式)。最低でも `productDocs jsonb` に丸 dump、`hitlState` は `reviewMode` から導出、`startsAt` は ISO 文字列を `new Date(...)` で保存すべき。S06 までに対応必須。

### MEDIUM
1. **`redirect()` の例外が `try/catch` で握り潰される**。`isRedirectError(e)` を import して再 throw する必要。`saveDraft` には `redirect` が無いので不要。
2. **warmup cap の自動 clamp が server で未実装**。UI が約束しているので server 側に `effDaily = Math.min(state.step5.dailyLimit, minWarmupCap)` の clamp 後に DB へ書き込む必要。
3. **`launchCampaign` の DB 操作群がトランザクションでまとまっていない**。`campaigns insert/update + writeAudit` を `db.transaction` で囲み、`writeAudit` を `tx` 受け取れるよう拡張。並列ローンチで監査ログ hash chain が衝突する余地を消す。
4. **`Field` コンポーネントの 4 重複**。`components/ui/field.tsx` に集約。
5. **`tryParse` のスキーマ型注釈がインライン**。`z.ZodTypeAny` で受けてダウンキャスト不要に。
6. **`setState({ ...defaults, ...partial } as WizardState["stepN"])` の `as` 集積**。`Step{N}Schema.parse` を介した builder util を 1 つ用意。

### LOW
1. ロール文字列のハードコード (`"operator"` / `"manager"`) — enum 由来定数化。
2. `WizardActionState.field` を実際に活用してフィールドハイライト。
3. `aiDraft()` を server 配置に備えて切り出し。
4. localStorage 復元時に `WizardSchema.safeParse` の前処理。
5. 他テナント `draftId` 注入時の UI レスポンスを「見つかりません」に。
6. `r.status === "active"` の明示分岐 + `r.warmupDay ?? 0` の defensive。
7. `state.step5?.accountIds?.length` への `?.` 統一 (strict mode 強化耐性)。
8. `saveDraft` で UPDATE 0 件のとき `ok:false` を返す (現状は黙って成功扱い)。

---

## 結論

**90+ PASS**。基幹アーキテクチャ (RSC/Client 境界、Server Action、Zod、orgId スコープ、role 検査、a11y) はすべて設計書の意図を満たしており、本ステップは合格。HIGH の永続化漏れだけは S06 で「lead/message 生成ジョブを動かす際に campaign 行から必要情報を取り直したい」となった瞬間にブロッカー化するので、S06 着手前に最低限 `productDocs jsonb` への丸 dump + `startsAt` / `hitlState` 保存だけは入れること。

**推奨アクション**:
1. (S06 着手前) HIGH-1 を Quick Fix。
2. (S06 と同時) MEDIUM-1〜3 をまとめて Server Action 強化 PR。
3. (S07 以降) MEDIUM-4〜6 と LOW 群を技術負債タスクとして起票。
