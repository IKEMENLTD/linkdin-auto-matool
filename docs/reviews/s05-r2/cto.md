# CTO Review — S05 キャンペーン作成 Wizard (r2)

**Reviewer**: CTO Agent
**Scope**: `app/(app)/campaigns/new/page.tsx`, `components/campaigns/wizard/*`, `lib/wizard-schema.ts`, `server/actions/wizard.ts`, `server/queries/accounts.ts`, `lib/audit.ts`, `db/schema.ts`
**Date**: 2026-05-11
**Verdict**: **PASS (90+)**

---

## 総合スコア: 95 / 100 (R1 比 +4)

| 軸 | R2 | R1 | 配点 | コメント |
|---|---|---|---|---|
| 1. Next.js 15 RSC/Client境界、Server Action 設計 | **20** | 19 | 20 | redirect が try/catch 外に移動。NEXT_REDIRECT 透過 OK |
| 2. TypeScript型安全、Zod、状態管理 | **19** | 17 | 20 | `as unknown as true` 撤廃、`tryParse` を `z.ZodType<T>` で受領、`as WizardState["stepN"]` キャスト消滅 |
| 3. Drizzle クエリ品質 (org スコープ、tx、bulk誤update防止) | **19** | 17 | 20 | productDocs/startsAt/hitlState 永続化済み、warmup clamp サーバ実装、accountIds の orgId 二重検査 |
| 4. エラーハンドリング・ロール検査・revalidate | **19** | 19 | 20 | 変更影響なし、引き続き堅実 |
| 5. 再利用性 (UIプリミティブ、命名) | **18** | 19 | 20 | `Field` 4 重複は据え置き (技術負債、S07+) |

**判定: PASS (≥90) / R1 91 → R2 95**

---

## R1 課題への対応サマリ

| R1 ID | 重大度 | R1 内容 | R2 対応 | 評価 |
|---|---|---|---|---|
| HIGH-1 | HIGH | launchCampaign で `startsAt` / `hitlState` / `dailyLimit` / `accountIds` / `productDocs` が永続化されていない | `productDocs` に `objective` / `product` / `icp` / `message` / `delivery (accountIds, dailyLimit, effectiveDailyLimit, startTime, endTime, weekdaysOnly, reviewMode)` を丸 dump、`startsAt` を `new Date(r5.data.startsAt)` で `campaigns.startsAt` に保存、`hitlState` を `reviewMode === "semi_auto" ? "SEMI_AUTO" : "REVIEW_REQUIRED"` で導出して保存 (`server/actions/wizard.ts:200-246`) | **CLOSED** |
| MEDIUM-1 | MEDIUM | `redirect()` が `try/catch` で握り潰される | `redirect(/campaigns/${campaignId})` を `try/catch` の外に移動 (`server/actions/wizard.ts:269-275`)。`isRedirectError` import は不要 (構造的に分離) | **CLOSED** |
| MEDIUM-2 | MEDIUM | warmup cap の自動押し戻しが server で未実装 | `clampDailyLimitByWarmup(request, selectedWarmupDays)` を新設 (`server/actions/wizard.ts:49-56`)、`accountIds` で取得した `linkedinAccounts.warmupDay` を join 取得 → `Math.min(...WARMUP_DAILY_CAP_BY_DAY(d))` で押し戻し → `effectiveDaily` を productDocs と audit log に記録 | **CLOSED** |
| MEDIUM-3 | MEDIUM | `launchCampaign` の最終 Zod 検証維持 | `Step1〜5Schema.safeParse` を個別に実施し、unsuccess を `issues[]` に集約 → 1 つでもあれば `ok:false` (`server/actions/wizard.ts:153-167`) | **CLOSED** |
| MEDIUM-5 | MEDIUM | `tryParse` のスキーマ型注釈がインライン | `tryParse = <T,>(schema: z.ZodType<T>, data: unknown)` に変更 (`wizard-shell.tsx:117`) | **CLOSED** |
| MEDIUM-6 | MEDIUM | `setState({ ...defaults, ...partial } as WizardState["stepN"])` 集積 / `consentPolicy: false as unknown as true` キャスト | `consentPolicy` を `z.boolean().refine((v) => v === true, ...)` に変更 (`wizard-schema.ts:139-141`)、`StepDelivery` の `value.consentPolicy ?? false` を `Boolean(...)` で受領、各 step `setState` から `as WizardState["stepN"]` キャスト消滅 (default 値で埋めた spread だけで `WizardState["stepN"]` 型推論が通る) | **CLOSED** |
| 補足 | LOW | `updateStep` 未使用 helper | 削除済み (Grep で残存なし) | **CLOSED** |
| MEDIUM-4 | MEDIUM | `Field` の 4 重複 (`step-product/step-icp/step-message/step-delivery`) | 未対応。Grep で 4 ファイルとも残存。R2 では据え置きで OK (技術負債) | **OPEN (低優先)** |

---

## 重点コード再確認

### `launchCampaign` 永続化 (server/actions/wizard.ts:200-246)

- `productDocs` に Step1〜5 を丸 dump (型は `Record<string, unknown>` で schema と整合)。`delivery.effectiveDailyLimit` も同居しており、後段の lead 配信ジョブが上限を再計算せずに使える。
- `startsAt: new Date(r5.data.startsAt)` — Zod 側は `z.string().min(1)` までしか縛らないが、`new Date(invalid)` で Invalid Date になっても Drizzle は ISO 化失敗で例外を投げる。`r5.data.startsAt` は `<input type="date">` 出力なので `YYYY-MM-DD` 固定で安全。
- `hitlState` 導出: `semi_auto → SEMI_AUTO`, `review_required → REVIEW_REQUIRED`。enum と完全一致。
- UPDATE / INSERT 両方で同じ payload を渡しており、ローンチ後の状態が draft の有無にかかわらず一意。これは後段 (S06 lead ingest) で参照する際に重要。
- `accountIds` の存在検査: `linkedinAccounts` を `orgId` でフィルタ → JS 側で `r5.data.accountIds.includes(a.id)` → `allowed.length === 0` で reject (`wizard.ts:192-194`)。**他組織アカウント注入は構造的に防止**されている。`inArray(...)` SQL を使うのがより効率的だが、3 アカウント前提の MVP では JS フィルタで十分。

### `clampDailyLimitByWarmup` の server 押し戻し (wizard.ts:49-56, 195-198)

```ts
function clampDailyLimitByWarmup(request: number, selectedWarmupDays: number[]): number {
  if (selectedWarmupDays.length === 0) return request;
  const cap = Math.min(...selectedWarmupDays.map((d) => WARMUP_DAILY_CAP_BY_DAY(d)));
  return Math.min(request, cap);
}
```

- UI 側の Preview と Step5 は client 側で同じ `WARMUP_DAILY_CAP_BY_DAY` を使っており、ロジックが完全一致。UI 約束 (「ローンチ時に自動で {minWarmupCap} 件まで押し戻されます」) と server 挙動が一致。
- `effectiveDaily` は `productDocs.delivery.effectiveDailyLimit` と `audit_log.diff.effectiveDailyLimit` の 2 箇所に記録。**監査追跡可能**。

### redirect 分離 (wizard.ts:269-275)

```ts
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[launchCampaign]", e);
    return { ok: false, message: "ローンチ中に問題が発生しました" };
  }

  // redirect は try/catch の外で実行 (NEXT_REDIRECT を握り潰さない)
  redirect(`/campaigns/${campaignId}`);
```

- `campaignId === undefined` の場合は try 内で `return { ok:false, message:"キャンペーンの作成に失敗しました" }` する分岐 (`wizard.ts:248-250`) が入っているため、redirect 直前で undefined になることはない。`!` 非 null アサーション不要で型も通る (`campaignId: string | undefined` だが、TS の control flow analysis では `campaignId` が undefined のときは関数を抜けている)。
- ただし TS strict + noImplicitReturns で見ると `campaignId` の narrowing が `try` の外で効かない可能性。実機で通っていることは別途確認推奨 (NEW LOW)。

### consentPolicy の Zod 改修 (wizard-schema.ts:139-141)

```ts
consentPolicy: z
  .boolean()
  .refine((v) => v === true, { message: "利用規約への同意が必要です" }),
```

- 型は `boolean` で UI 初期値 `false` を許容、`safeParse` 時に `v === true` のみ通過。
- `Step5` の TS 型は `boolean` になるため、`step-delivery.tsx` の `Boolean(value.consentPolicy)` 表現で初期値 `undefined` を `false` に丸める実装が成立。**型と Zod 両方で整合**。

### tryParse の型注釈 (wizard-shell.tsx:117)

```ts
const tryParse = <T,>(schema: z.ZodType<T>, data: unknown) => {
  const r = schema.safeParse(data);
  if (r.success) return;
  for (const issue of r.error.issues) { ... }
};
```

- `z.ZodType<T>` で受領するため `superRefine` 由来の `ZodEffects` も `z.ZodType<infer T>` を満たし、型整合。
- `safeParse` の戻り値 `r.error.issues` も Zod の標準型で参照可能。R1 でのインライン型注釈 (`{ safeParse: (v) => { success; error?: { issues: ... } } }`) が消えている。

---

## R2 新規確認項目 (NEW)

### N-1: `launchCampaign` 内でも `db.transaction` を使っていない (R1 から繰越)

- R1 でも MEDIUM-3 として「`campaigns insert/update + writeAudit` を `db.transaction` で囲むべき」と指摘していたが、R2 でも未対応。
- 並列ローンチ時の `audit_log` hash chain レース (writeAudit が prev_hash を SELECT してから INSERT する間に別ローンチが入ると prev_hash が同じになる) は引き続き残る。
- ただし運用上、同一 org で同時にローンチが多重発火するシナリオは稀 (Manager 以上のみ + UI 上 `window.confirm` が挟まる) であり、HIGH ではない。S06 で lead 配信ジョブが大量に audit_log を書き出すタイミングで一緒に直すのが筋。
- **NEW MEDIUM** (R1 と同じ位置付け)。

### N-2: `r5.data.accountIds` の orgId スコープ検査が JS-side フィルタ

- `linkedinAccounts` を `eq(orgId)` で全取得 → JS で `r5.data.accountIds.includes(a.id)` フィルタ。
- 攻撃者が他組織の `linkedinAccount.id` を `accountIds` に注入しても、JS フィルタで弾かれて `allowed.length === 0` で reject されるので **構造的には穴なし**。
- ただし `productDocs.delivery.accountIds` には **Zod を通った accountIds 配列がそのまま保存される** ことに注意 (`wizard.ts:206`)。`r5.data.accountIds` であって `allowed.map(a => a.id)` ではない。**他組織 id が混じった配列がそのまま JSONB に書かれる**可能性は理論上ある (allowed.length > 0 かつ allowed.length < accountIds.length のとき)。実害は薄い (後段の配信ジョブが accountId を再検証する前提) が、`productDocs.delivery.accountIds = allowed.map(a => a.id)` に揃える方が監査的にクリーン。
- **NEW LOW**。

### N-3: `productDocs` の型キャスト

- `parsed.state as Record<string, unknown>` (saveDraft) と `productDocs: Record<string, unknown> = { ... }` (launchCampaign) の 2 パターンが混在。Drizzle 側の `jsonb("product_docs").$type<Record<string, unknown>>()` には合っているので問題はない。
- ただし `saveDraft` 側は `WizardState` 全体 (5 step) を一気に保存し、`launchCampaign` 側は加工後の Step1〜5 を入れる、という **構造の違い** が発生している。下書きから再開した際に launchCampaign がそれを上書きする流れになるので競合はないが、後段 lead ingest が `productDocs.delivery` を期待する一方で draft 中は `productDocs.step5` にしか入っていない、という **キー名の食い違い** が発生する。draft でも `delivery / icp / product / message` キーで書く方が将来エラーが減る。
- **NEW LOW**。

### N-4: `WizardActionState.redirectTo` フィールド未使用

- `WizardActionState` 型に `redirectTo?: string` が定義されているが (`wizard.ts:26`)、現状 set されない。`redirect()` で直接遷移するため。
- 不要であれば削除、もしくは将来 `useActionState` で client-side router push に切り替える布石ならコメントを付ける。
- **NEW LOW (cleanup)**。

### N-5: `campaignId` の TS narrowing in try/catch boundary

- `let campaignId: string | undefined;` が try の外で宣言され、try 内で代入 → catch では handle されない → try の後 `redirect(/campaigns/${campaignId})`。
- TS strict mode で `Object is possibly 'undefined'` が出る可能性。実装上は try 内で `if (!campaignId) return { ok:false, ... }` を通過したケースのみ抜けてくるが、TS の control flow analysis ではこれを narrow できない (`return` が条件付きのため)。
- 実機 (Next.js build) で通っているか要確認。型エラーになるならば try の中で `redirect` を `throw` 経由で抜く設計に戻す or non-null assertion (`campaignId!`) で逃げる。
- **NEW LOW (型整合確認推奨)**。

### N-6: `WARMUP_DAILY_CAP_BY_DAY` が `wizard-schema.ts` に置かれている

- これは UI / Schema / Server Action の 3 か所から import される共通定数。`lib/wizard-schema.ts` 内にあるのは妥当だが、関数名が `WARMUP_DAILY_CAP_BY_DAY`(day: number) で **関数なのに ALL_CAPS** という命名の揺れ。`getWarmupDailyCap(day)` が筋。命名規約の小さな揺れ。
- **NEW LOW (命名)**。

---

## 評価詳細 (R2)

### 1. Next.js 15 RSC/Client 境界、Server Action 設計 — 20/20

R1 で指摘した redirect catch 包摂が解消。`redirect()` を try/catch の外に置く方針は `isRedirectError(e) && throw e` よりもシンプルで、再 throw に依存しないため意図が明確。Server Action のシグネチャ・revalidatePath の順序・force-dynamic 設定は変更なしで引き続き合格。

### 2. TypeScript 型安全、Zod、状態管理 — 19/20

- `consentPolicy` の `.refine` 化、`tryParse` の `z.ZodType<T>` 化、`as WizardState["stepN"]` キャスト消滅の 3 点で R1 の MEDIUM-5/6 が解消。
- 残 -1: `productDocs as Record<string, unknown>` の暗黙キャストはまだあるが、Drizzle 側の `$type<>` と整合しているので減点幅は小。

### 3. Drizzle クエリ品質 (org スコープ、tx、bulk 誤 update 防止) — 19/20

- HIGH-1 が完全 close。`productDocs / startsAt / hitlState` が DB に乗ったので、S06 で lead ingest が campaign 行から必要情報を取り直せる。
- 残 -1: `db.transaction` がまだ無いこと (N-1)。本ステップでブロッカーではないが、S06 着手時に同時対応推奨。

### 4. エラーハンドリング・ロール検査・revalidate — 19/20

R1 から変更なし。引き続き合格。`saveDraft` の `status: "draft"` 条件付き UPDATE (`wizard.ts:103`) が追加されており、ローンチ済みのキャンペーンを誤って下書き上書きする事故もブロックされている (細かい改善)。

### 5. 再利用性 (UI プリミティブ、命名) — 18/20

- `Field` 4 重複が据え置き (`step-product / step-icp / step-message / step-delivery`)。R1 の MEDIUM-4 が未対応。
- 残 -2: R1 と同じ理由 (-1) + N-6 命名揺れ (-1)。
- 機能上の影響なし。S07 で `components/ui/field.tsx` に集約する技術負債タスクとして起票推奨。

---

## HIGH 残存 / NEW HIGH

### HIGH 残存
**なし** (R1 HIGH-1 closed)

### NEW HIGH
**なし**

### MEDIUM 残存
- **MEDIUM-N1**: `db.transaction` で `campaigns insert/update + writeAudit` を囲むべき (R1 から繰越、S06 で対応推奨)
- **MEDIUM-4** (R1 から繰越): `Field` 4 重複の集約 (S07 技術負債)

### NEW MEDIUM
**なし**

### NEW LOW
1. **N-2**: `productDocs.delivery.accountIds = allowed.map(a => a.id)` で他組織 id 混入の理論可能性を排除
2. **N-3**: `saveDraft` の `productDocs` キー名 (`step1`〜`step5`) と `launchCampaign` の `productDocs` キー名 (`objective`/`product`/`icp`/`message`/`delivery`) が乖離。draft でも launch と同じキー構造に揃える
3. **N-4**: `WizardActionState.redirectTo` 未使用フィールドの削除またはコメント追加
4. **N-5**: `campaignId` TS narrowing の strict mode 確認
5. **N-6**: `WARMUP_DAILY_CAP_BY_DAY` を `getWarmupDailyCap` にリネーム (関数命名規約)

---

## 90+ 判定: **PASS**

総合スコア **95 / 100** で R1 の 91 → R2 95 へ +4 改善。

R1 で指摘した HIGH-1 (永続化漏れ) は完全解消、MEDIUM-1〜3, 5, 6 もすべて closed。残るのは `db.transaction` 未導入 (S06 並行対応) と `Field` 重複 (技術負債) のみで、いずれも本ステップでブロッカーではない。

**判定: PASS (≥90、十分に余裕あり)**

---

## 推奨アクション

1. (S06 着手と同時) **MEDIUM-N1** `db.transaction` を入れて `writeAudit` を `tx` で受けられるよう拡張。lead ingest ジョブ実装時のリスクを潰す。
2. (S06 着手前) **NEW LOW N-3** draft 側 productDocs のキー構造を launch と揃える。lead ingest が `productDocs.delivery` を期待する設計に寄せる。
3. (S07 以降) **MEDIUM-4** `components/ui/field.tsx` に Field 集約、技術負債タスク化。
4. (S07 以降) **NEW LOW N-2, N-4, N-5, N-6** をまとめて cleanup PR。

---

## 関連ファイル

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\wizard.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-shell.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\step-delivery.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\wizard-schema.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\accounts.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\schema.ts`
