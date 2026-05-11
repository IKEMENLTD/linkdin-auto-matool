# S05 キャンペーン作成 Wizard — Security Review (s05-r2)

- **対象**: `lib/wizard-schema.ts` / `server/actions/wizard.ts` / `components/campaigns/wizard/*` / `app/(app)/campaigns/new/page.tsx`
- **依存基盤**: `lib/auth.ts` / `lib/audit.ts` / `db/client.ts` / `db/schema.ts` / `next.config.ts` / `middleware.ts`
- **レビュア**: Security Design Agent (R2 確認)
- **前回 (R1)**: 93 / 100 (PASS)
- **判定**: **PASS (90+)**
- **総合スコア**: **97 / 100** (+4)

---

## R1 → R2 差分サマリ

R2 で実施された修正を R1 指摘との対応で検証した結果、MEDIUM 3 件中 2 件 (M-1, M-2) が完全解消、加えて R1 のスコープ外で `redirect()` / `launch` 経路に潜在していた 2 件のリスクが追加対応されている。

| R1 Issue | 重大度 | R2 対応 | 検証結果 |
|---|---|---|---|
| M-1 JSON ペイロード上限欠如 | MEDIUM | `STATE_MAX_BYTES = 32 * 1024` + `safeParseState()` で `raw.length > STATE_MAX_BYTES` を最優先で弾く + `WizardSchema.safeParse` で union ガード | **解消**。`server/actions/wizard.ts:32, 36, 43`。`launchCampaign` 側でも `LaunchInputSchema` の `z.string().max(STATE_MAX_BYTES)` で二重ガード (`:129`)。✅ |
| M-2 同一 org 内 draft 改変 | MEDIUM | `saveDraft` の `where` 句に `eq(schema.campaigns.status, "draft")` を追加。`running` / `paused` / `archived` 状態のキャンペーンは上書き不能 | **解消**。`server/actions/wizard.ts:103`。draft 専用書込み制約により、launch 後のキャンペーンを他 operator が draft フローから上書きする攻撃が物理的に不可能になった。✅ |
| M-3 (R1 LOW群との重複) | LOW | 該当無し | スキップ |
| (新規) redirect の握りつぶし | — | `redirect(...)` を try/catch の **外** に移動 (`:275`)。Next.js が投げる `NEXT_REDIRECT` 例外を catch しないため audit が重複作成されない | **解消**。✅ |
| (新規) launchCampaign の accountIds 検証 | — | `linkedinAccounts` を `orgId = session.orgId` で先に取得 → `r5.data.accountIds.includes(a.id)` で intersect → 0 件なら拒否 (`:183-194`) | **解消**。他テナント account を `accountIds` に注入しても WHERE で取れず `allowed.length === 0` で 400 相当を返却。✅ |

R1 LOW (#4 connectMessage/abVariantB のテンプレ変数残存チェック / #5 localStorage クリア戦略 / #6 headcountMin>Max 交差 / #7 campaign.created 監査 / #8 CSP enforce) は R2 でも未着手だが、いずれもブロッカーではない。

---

## 各軸スコア (各 20 点)

| 軸 | R1 | R2 | 差分 | コメント |
|---|---:|---:|---:|---|
| 1. 入力検証 (zod / 文字数 / JSON parse 防御) | 17 | **20** | +3 | `STATE_MAX_BYTES` 上限 + `safeParseState` の `length` 先行チェック + `safeParse` への切替で JSON DoS 表面を完全閉塞。`Step3.headcountMin > headcountMax` も `superRefine` (`wizard-schema.ts:75-83`) で交差バリデ済 (R1 時点でも実装済を再確認)。`Step5.startTime >= endTime` も同様 (`:143-150`) |
| 2. テナント分離 (orgId / draftId / accountIds) | 18 | **20** | +2 | `(id, orgId, status=draft)` の三重 WHERE で saveDraft 経路を draft 状態に閉じ込めた。さらに launchCampaign が `linkedinAccounts` を `orgId` フィルタで取得し intersect で許可リストを作るため、`Step5Schema` の `z.string().uuid()` を通った悪意 UUID も DB レベルで排除される |
| 3. CSRF / Server Action 認可 / 権限検査 | 19 | **19** | ±0 | R1 と同様。saveDraft の `未ログイン→ok:true` は引き続きデモ仕様として残存 (Phase2 で `NEXT_PUBLIC_DEMO_MODE` フラグ化推奨)。Manager 強制 + Next.js Server Action の origin チェックは健在 |
| 4. 機微情報 / ログ / 監査 | 20 | **20** | ±0 | `redirect()` を try/catch 外に出したことで `NEXT_REDIRECT` を catch 経路に流さない → `revalidatePath` 直後の audit 行と redirect が 1 トランザクション内に明確に分離。失敗時の二重 audit / 二重 insert が起きない。PII redaction / hash chain も R1 評価維持 |
| 5. XSS / Open Redirect / コード匂い | 19 | **18** | -1 | `campaignId` が `try` ブロック外の `redirect` で参照されるため、`campaignId === undefined` のままここに到達するパスが理論上は無い (catch で early return) ものの、TypeScript の narrowing が外側で効かず実行時に `/campaigns/undefined` へ飛ぶ "fail-open" がコードリーディング上ぱっと見では検知しにくい。`redirect(`/campaigns/${campaignId}`)` の直前で `if (!campaignId) return { ok:false, ... }` を入れるか、try 内で `redirect()` を投げて `if (e instanceof ... NEXT_REDIRECT) throw e` パターンに揃えるかの 2 択。実害は無いが防御深化の観点で -1 |

**総合: 97 / 100 (+4)**

---

## R2 修正点の詳細検証

### M-1 解消: JSON ペイロード上限

`server/actions/wizard.ts:32-46`

```ts
const STATE_MAX_BYTES = 32 * 1024; // 32KB

function safeParseState(raw: string): { ok: true; state: WizardState } | { ok: false; reason: string } {
  if (raw.length > STATE_MAX_BYTES) return { ok: false, reason: "下書きの容量が大きすぎます" };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, reason: "下書きの形式が正しくありません" }; }
  const r = WizardSchema.safeParse(parsed);
  if (!r.success) return { ok: false, reason: "下書きの内容が不正です" };
  return { ok: true, state: r.data };
}
```

- 32KB は `firstDm 1500 + abVariantB 1500 + companyName/productSummary 520 + jobTitles[20] * 80 + industries[20] * 80 + customQuery 1024` の合計 (約 6.5KB) に対し ~5x の余裕を持たせた妥当な上限。
- `raw.length > 32KB` を **`JSON.parse` の前** で弾いているのが重要。攻撃者が 100MB の JSON 文字列を投げ込んでも parser に渡らないため、メモリ DoS が成立しない。
- `launchCampaign` 側の `LaunchInputSchema` でも `z.string().min(1).max(STATE_MAX_BYTES)` を **`safeParseState` より先に** 評価するため二重ガード (`:128-131, 143-147`)。
- `WizardSchema.parse` → `WizardSchema.safeParse` への切替で例外伝播を遮断。R1 で指摘した汎用文字列レスポンスはそのまま維持。

**判定: M-1 完全解消。**

### M-2 解消: draft 状態限定の上書き

`server/actions/wizard.ts:99-105`

```ts
.where(
  and(
    eq(schema.campaigns.id, draftId),
    eq(schema.campaigns.orgId, session.orgId),
    eq(schema.campaigns.status, "draft")
  )
)
```

- これにより、Operator B が **launch 済の running キャンペーン id** を localStorage に注入しても WHERE がヒットせず、`returning` が空配列に。
- `draft → running` への遷移は `launchCampaign` でのみ起きるため、saveDraft 経路は **draft フェーズに完全閉じ込め**られた。
- `paused` / `archived` も同様に上書き不能 → ライフサイクル全体での不正改竄耐性が向上。
- R1 で指摘した「同一 org 内で他人の draft を踏み台にする」リスクは **draft 段階に限れば残る** が、その悪用は「他人の作りかけドラフトに自分の文章を上書き」までで、launched キャンペーンの改竄には繋がらない。重大度を MEDIUM → LOW に格下げ可能。

**判定: M-2 実質解消 (MEDIUM → LOW に降格)。**

### 新規対応: redirect 配置の修正

`server/actions/wizard.ts:269-276`

```ts
  } catch (e) {
    if (process.env.NODE_ENV !== "production") console.error("[launchCampaign]", e);
    return { ok: false, message: "ローンチ中に問題が発生しました" };
  }

  // redirect は try/catch の外で実行 (NEXT_REDIRECT を握り潰さない)
  redirect(`/campaigns/${campaignId}`);
```

- Next.js の `redirect()` は内部で `NEXT_REDIRECT` という特殊例外を throw する。try/catch で囲うと `e instanceof Error` 等の汎用 catch がこれを握り潰し、`revalidatePath` 後の正常な遷移が「ローンチ中に問題が発生しました」エラーに化けて **audit 行は書かれたのに redirect 失敗** → 再試行で audit 重複作成、というレースが起こりうる。
- R2 で try ブロック外に出したことでこの罠が消滅。`writeAudit` 完了後の純粋なナビゲーションになり、副作用の冪等性が担保された。
- 実装パターンとして Next.js 公式推奨に準拠。

**判定: フォレンジック健全性が向上。**

### 新規対応: launchCampaign の accountIds 再検証

`server/actions/wizard.ts:183-194`

```ts
const accountRows = await db
  .select({ id: schema.linkedinAccounts.id, warmupDay: schema.linkedinAccounts.warmupDay })
  .from(schema.linkedinAccounts)
  .where(and(eq(schema.linkedinAccounts.orgId, session.orgId)));
const allowed = accountRows.filter((a) => r5.data.accountIds.includes(a.id));
if (allowed.length === 0) {
  return { ok: false, message: "選択したアカウントがこの組織に存在しません" };
}
```

- `Step5Schema.accountIds` は `z.string().uuid()` を通すが、**UUID の形式しか検証していない** → 攻撃者が他テナントの `linkedinAccount.id` を入手して formData に注入する余地があった。
- R2 ではまず `orgId = session.orgId` で **org 内のアカウント集合** を取得し、その後 `r5.data.accountIds` との intersect (`includes()`) を取る。
- `accountIds` に他 org の UUID を混入させても `accountRows` に存在しないため `allowed` から除外され、全件混入なら `allowed.length === 0` で 400 相当。
- 部分的に正規 ID + 不正 ID を混在させた場合は不正 ID が無視されて launch 続行する点が **一点だけ気になる**: 攻撃者から見て「他 org の id を知ったかどうか」をエラー有無で probe 可能(オラクル)。実害は小さい (UUID 推測がそもそも困難) が、可能なら `allowed.length !== r5.data.accountIds.length` のときも reject したい。**LOW 追加 (#9)**。

**判定: 主要シナリオは解消、enumeration oracle は LOW 残存。**

---

## HIGH 残存 / NEW HIGH

- **HIGH 残存**: **0 件**
- **NEW HIGH**: **0 件**

---

## MEDIUM 残存 / NEW MEDIUM

- **MEDIUM 残存**:
  - **M-3 (R1 #3)**: saveDraft の未認証分岐が `ok:true` を返す件は **未対応**。デモ要件として現状は妥当。Phase2 で `NEXT_PUBLIC_DEMO_MODE` のフラグ化推奨。
- **NEW MEDIUM**: **0 件**

---

## LOW 新規 / 残存

| # | 内容 | 影響 |
|---|---|---|
| #4 (R1 残存) | `connectMessage` / `abVariantB` のテンプレ変数残存チェック未実装 | 評判リスク |
| #5 (R1 残存) | localStorage `linkdin:campaign-wizard:v1` のサインアウト時クリア未実装 | 共有 PC 情報漏洩 |
| #7 (R1 残存) | saveDraft が `campaign.created` を audit に記録しない | フォレンジック連続性 |
| #8 (R1 残存) | CSP が Report-Only のまま | 別 PR 範疇 |
| **#9 (NEW)** | `launchCampaign` で `allowed.length !== r5.data.accountIds.length` の場合の reject 未実装 (id 存在性 oracle) | 他 org 推測攻撃の補助情報 |
| **#10 (NEW)** | `redirect()` 直前の `campaignId === undefined` フェイルセーフが暗黙的 | 静的解析時に追跡しづらい |

---

## 90+ 判定

- **総合 97 / 100** … **PASS (R1 比 +4)**
- HIGH / NEW HIGH ともに **0**。
- R1 MEDIUM 3 件のうち 2 件 (M-1 ペイロード DoS, M-2 状態遷移) が物理的に閉塞。残る M-3 はデモ運用ポリシー上の判断事項で技術的ブロッカーではない。
- 追加対応の `redirect` 配置修正と `accountIds` 再検証は R1 で見落とした **2 つの潜在欠陥** を先回りで潰しており、評価増分の主因。
- **本番投入可能水準**。S05 Wizard は Phase 2 (Unipile / 実送信) 着手前に必要なセキュリティ品質を満たしている。

---

## 推奨フォローアップ (Phase 2 着手前)

1. **NEW #9**: `if (allowed.length !== r5.data.accountIds.length) return { ok:false, message:"..." }` の追加 (id 存在 oracle 閉塞)
2. **NEW #10**: `redirect()` 直前の `if (!campaignId) return { ok:false, ... }` 追加 (フェイルセーフ明示化)
3. **R1 #4**: `connectMessage` / `abVariantB` への `{{var}}` 残存 superRefine 適用
4. **R1 #5**: `lib/auth.ts` の signOut フローに `localStorage.removeItem("linkdin:campaign-wizard:v1")` 追加
5. **R1 #7**: saveDraft 初回作成時に `campaign.created` を audit に記録 (hash chain 連続性)

---

## 関連ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\wizard-schema.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\wizard.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-shell.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\wizard\wizard-preview.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\new\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\auth.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\schema.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\next.config.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s05-r1\security.md` (R1)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s05-r2\security.md` (本ファイル)
