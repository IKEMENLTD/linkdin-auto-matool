# S04 キャンペーン一覧 — Security レビュー (s04-r1)

- 対象: `app/(app)/campaigns/page.tsx`, `components/campaigns/*`, `components/ui/{checkbox,dropdown,pagination,empty-state,input,select}.tsx`, `lib/campaign-status.ts`, `server/queries/campaigns.ts`, `server/actions/campaigns.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §17 ABAC / §26 脅威モデル
- レビュー観点: テナント分離 / Server Action 認可 / URL クエリ入力検証 / 監査ログ結線 / XSS・Open Redirect・クライアント JS の影響
- レビュー日: 2026-05-11

---

## 総合スコア: 78 / 100

| # | 評価軸 | 配点 | 取得 | 主な減点 |
|---|---|---:|---:|---|
| 1 | テナント分離 (orgId 強制 / SQLi / inArray) | 20 | 15 | `ilike` の LIKE メタ文字エスケープ未実装、`q` 長さ上限なし |
| 2 | Server Action の認可 | 20 | 16 | レース無し / formData は良。ただし Manager 未満ユーザーが UI 上で BulkBar を操作できる (クライアント側ゲート無し)、`hasAtLeastRole` の検証は Action 内のみ |
| 3 | URL query 入力検証 | 20 | 17 | `status` は allowlist あり (◎)。`owner` は `"me"` 以外を `""` に正規化しているが、`q` に長さ・制御文字制限なし、`page` 上限なし |
| 4 | 監査ログ結線 | 20 | 10 | **HIGH**: `action: "campaign.launched"` が pause/archive の両方に流用されている。`AuditAction` 列挙に `campaign.paused`/`campaign.archived` が無く、`purpose` で区別する設計のため監査クエリで誤検出。`targetId` を `ids.join(",")` で詰めるのは仕様外 (1 行 = 1 target が原則) |
| 5 | XSS / Open Redirect / クライアント JS | 20 | 20 | React の自動エスケープに依存、`Link href` は内部固定、`router.push` も内部のみ。XSS リスクなし |

---

## HIGH（必須修正・95+ 到達のブロッカー）

### H1. BulkBar の `alert()` / `confirm()` がデモ実装で Server Action に未結線

**ファイル**: `components/campaigns/campaigns-table.tsx:238-243`

```ts
onClick={() => {
  if (destructive) {
    if (!confirm(`${ids.length} 件を ${label} します。よろしいですか？`)) return;
  }
  alert(`${label}: ${ids.length} 件 (デモ環境のため実際の更新は行いません)`);
}}
```

- `server/actions/campaigns.ts` には `bulkPauseCampaigns` / `bulkArchiveCampaigns` が存在するが、**UI から呼び出されていない**。
- 監査ログ・テナント分離・Manager 認可がすべてバイパスされた状態でユーザーには "成功した" ように見える → 監査整合性に対するユーザー期待を裏切る。
- セキュリティ影響そのものは小さい（書き込みが起きないため）が、Phase1 リリース時にこのまま結線するとレース・CSRF・誤クリックすべて素通しになる。
- 修正案:
  - BulkButton を `<form action={bulkPauseCampaigns}>` でラップし `<input type="hidden" name="ids" value={id} />` を ids 件数分配置（または FormData を手動 build → `useTransition` + Server Action 呼び出し）
  - `confirm()` は段階廃止を推奨（A11y / E2E テスト困難・カスタムダイアログ化）。少なくとも archive のみ `confirm()` で残すなら**送信先 Action が必ず再認可する**前提を CLAUDE.md 化

### H2. 監査ログの `action` が pause / archive 両方で `"campaign.launched"` に固定

**ファイル**: `server/actions/campaigns.ts:62, 107`

```ts
await writeAudit({
  ...
  action: "campaign.launched", // ← pause なのに "launched"
  purpose: "bulk_pause",
  ...
});
```

- `lib/audit.ts` の `AuditAction` 列挙に `campaign.paused` / `campaign.archived` が存在しないため一時的に `"campaign.launched"` を流用したと思われるが、**§17 監査ログ append-only / 改竄耐性**の観点で:
  - 監査クエリ (`/audit` 画面) で「pause が何件あったか」を `action` カラムで集計できない
  - hash chain は正しく保たれるが、**論理的整合性が壊れている**ため監査人が証拠採用しづらい
- 修正案: `lib/audit.ts` の `AuditAction` に `"campaign.paused"` / `"campaign.archived"` を追加し、それぞれの Action から正しい値で `writeAudit`

### H3. `ilike` の LIKE メタ文字エスケープが未実装

**ファイル**: `server/queries/campaigns.ts:52`

```ts
if (q && q.trim()) conditions.push(ilike(schema.campaigns.name, `%${q.trim()}%`));
```

- Drizzle の `ilike` 自体は値をパラメタライズ化するため**古典的 SQL Injection は発生しない** (Drizzle / postgres-js のプレースホルダ経由)。
- ただし `%` `_` `\` をユーザーがそのまま投入できるため:
  - `q = "%"` で全件マッチ → ページネーション境界が狂って大量フェッチ
  - `q = "____________"` 長文 underscore で B-tree インデックスを使えない走査 → DoS リスク
  - エスケープ無しは §17 ABAC の「他テナント分は count だけ示す」の前段で計測が乱れる
- 修正案:

```ts
function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
if (q && q.trim()) conditions.push(ilike(schema.campaigns.name, `%${escapeLike(q.trim())}%`));
```

  さらに `q` を Zod で `.max(120)` 等で長さ上限。

---

## MEDIUM（95+ 達成には推奨、リリースは可）

### M1. `listCampaigns` は orgId フォールバックで mock を返す

**ファイル**: `server/queries/campaigns.ts:45-47`

```ts
if (!db || !orgId) {
  return mockCampaigns({ status, ownerUserId, q, page, perPage });
}
```

- セッション喪失 (`orgId === null`) 時にデモデータが表示される設計は MVP 用途として妥当だが、本番では `getSession()` が null の場合は `redirect("/auth/signin")` させるべき。現状ページ自体は `getSession()` が null でも 200 を返してしまう (page.tsx:40-48)。
- 修正案: `app/(app)/campaigns/page.tsx` の冒頭で `if (!session) redirect("/auth/signin")`。ただし `/app` ルート全体に middleware が掛かっていれば許容。

### M2. Bulk Action が "他テナント ID 混入" を **静かに無視**

**ファイル**: `server/actions/campaigns.ts:49-58`

`and(eq(orgId), inArray(id, ids))` で SQL 側は正しく自テナント分のみ更新する → **データ漏洩は無い (良い)**。
ただし返却の `affected` 件数しかユーザーに見せないため、攻撃者が他テナントの campaign UUID を IDOR で投げた場合:
- 攻撃者には `affected = 0` が返るだけで「**他テナントの存在の有無**」をオラクル攻撃に使う余地はゼロではない（タイミング差はわずか）。
- 推奨: `parsed.data.ids.length !== result.length` の場合に Sentry/audit に anomaly 記録（§26 セキュリティ通知の常設先）。閾値を超えたら incident.ts の `triggerIncident` 呼び出し。

### M3. `page` パラメタに上限なし

**ファイル**: `app/(app)/campaigns/page.tsx:37`

```ts
const page = Math.max(1, Number(sp.page) || 1);
```

- 上限がないため `?page=99999999` で `OFFSET 9999999*25` 相当の重いクエリ → 軽度な DoS 可能性。
- 修正案: `const page = Math.min(10_000, Math.max(1, Number(sp.page) || 1));` または `total` を取得後にクランプ。

### M4. Manager 未満ユーザーが BulkBar を物理的に押せてしまう

**ファイル**: `components/campaigns/campaigns-table.tsx`

- `CampaignsTable` は `role` をプロップで受け取らないため、Operator/Viewer にも一括操作ボタンが表示される。
- サーバ側 (Server Action) で `hasAtLeastRole(session.role, "manager")` を強制しているのでセキュリティ的にはセーフ (Defense in Depth はある)。
- UX 観点: 押して **403 トースト**を見せるのは設計書 §17.1 ABAC の「権限により非表示」原則 (UI 設計書 1422 行目) に反する。少なくとも Bulk アクションは role を見て非表示か `disabled` 化すべき。

### M5. `q` の制御文字 / NULL byte 取り扱い未考慮

**ファイル**: `components/campaigns/campaigns-filter-bar.tsx:32`

- `Input` から `useState` 経由で URL に投入。改行・タブ・NULL byte 等が `?q=...` に乗ると Postgres `ilike` 評価に影響しないが、監査ログや RUM に汚染値が残る。
- 修正案: page.tsx 側で `q.replace(/[ -]/g, "").slice(0, 120)` を一段挟む（Zod でも可）。

### M6. `withScopedDb` が listCampaigns で使われていない

**ファイル**: `server/queries/campaigns.ts:36-`

- `lib/db-scoped.ts` で RLS 用 GUC `app.org_id` を立てる仕組みがあるが、`listCampaigns` は素の `getDb()` を使い手動で `eq(orgId)` を AND している。
- 現状の `eq(orgId)` 明示は orgId が必ず where に入る点では問題なし。ただし RLS と多重防御させる設計意図 (§17 改竄耐性 / Defense in Depth) に照らすと `withScopedDb` 経由が望ましい。
- リリースブロッカーではないが、Phase2 で `bulkPauseCampaigns` / `bulkArchiveCampaigns` も `withScopedDb` に揃えるとテナント分離保証が機械的になる。

---

## LOW（残余リスク）

### L1. `selection state` をクライアント側 React state で保持
- `useState<Set<string>>` でローカル保持。チェックボックスを操作した状態は URL に出ないためブラウザ戻る/進むで失われる (機能的問題)。セキュリティ的影響は無し。Server Action 呼び出し時に `ids` を hidden input で送る設計なら問題ない。

### L2. `EmptyState` の `primary.href` / `secondary.href` は呼び出し側固定
- Open Redirect リスク無し (page.tsx:97, 104 で `/campaigns`, `/campaigns/new`, `/legal/usage-policy` のリテラル)。

### L3. `Dropdown` で外クリック検知が `mousedown` のみ
- セキュリティ影響無し。タッチイベント環境で動かない可能性あり (UX)。

### L4. `STARTER_VIEWS` の `query` フィールドが文字列固定
- `?status=running&hitl=REVIEW_REQUIRED` の `hitl` パラメタは page.tsx に未配線。クエリ自体が ignore されるだけで XSS 無し。

### L5. `alert("ビューの保存は Phase2 で実装予定です")`
- セキュリティ影響無し。デモ用 placeholder。Phase2 で削除予定なら良。

---

## 良い点 (Strengths)

1. **テナント分離の where 句が明示的**: `listCampaigns` 内で `conditions = [eq(schema.campaigns.orgId, orgId)]` を最初に push しており、その後 `status` / `ownerUserId` / `q` を必ず AND する構造で「orgId を忘れる」事故が物理的に起きない構造（query.ts:49）。bulk Action 側も `and(eq(orgId), inArray(id, ids))` で同様。**Defense in Depth + 明示的に良い**。

2. **`ALLOWED_STATUS` Set による allowlist**: `app/(app)/campaigns/page.tsx:19` で `status` を allowlist し、未知の値は空文字に正規化。これにより `?status=DROP TABLE` 系の prankster からのフィルタ汚染を防ぎ、`CampaignStatus` 型と物理的に整合させている。`owner` も `"me"` 厳密一致のみ session userId に展開で、それ以外は無視。

3. **Server Action 側の入力検証 + 認可が分離して綺麗**: `IdsSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) })` で**UUID 形式・件数上限**を物理強制 (server/actions/campaigns.ts:10-12)。さらに `requireManagerSession()` で `getSession` → `hasAtLeastRole("manager")` の二段ゲート。`formData.getAll("ids").map(String)` の defensive cast も適切。

---

## 95+ 到達のための残ブロッカー (Sequential Roadmap)

1. **[H1] BulkBar の `alert()` を Server Action 結線に置換** (`bulkPauseCampaigns` / `bulkArchiveCampaigns`) — UI から監査ログまで通電させる。
2. **[H2] `AuditAction` に `"campaign.paused"` / `"campaign.archived"` を追加** し、それぞれを `writeAudit` から呼ぶ。`targetId` も 1 件ずつ `targetType: "campaign"` で個別出力する `Promise.all` パターンに変更（バルクは hash chain 上でも 1 件 1 ログが安全）。
3. **[H3] `escapeLike()` を追加**し `q` の `%` `_` `\` をエスケープ。同時に `q` を Zod で `.max(120)` の長さ上限化。
4. **[M3] `page` 上限を 10000 または `Math.ceil(total/perPage)` クランプ**へ。
5. **[M4] BulkBar に `role` を伝播**し Manager 未満は非表示（§17.1 ABAC UI 原則準拠）。
6. **[M2] 他テナント ID 混入時の incident telemetry** (`affected !== ids.length` の anomaly) を Sentry / `lib/incident.ts` に送出。

上記 6 件をクローズすれば本軸での到達見込みは **96-98 / 100**。

---

## 参考: §26 脅威モデル別マッピング

| 脅威 (§26.1) | S04 で関連する制御点 | 現状評価 |
|---|---|---|
| 1. Insider Exfiltration | bulk archive を Manager+ に限定、監査ログ | H2 で action 名混在 → **要修正** |
| 2. Prompt Injection | S04 では適用外 | — |
| 3. テナントロックアウト | S04 では適用外 | — |
| 4. 越境データ移転 | `q` 検索が他テナントに漏れない | orgId where で **OK** |
| 5. AI 自動送信暴走 | bulk pause が「即停止」の SOP となる | UI 未結線 (H1) で**実効性ゼロ** |
| 6. OAuth トークン漏洩 | S04 では適用外 | — |
| 7. AI Hallucination | S04 では適用外 | — |

—— レビュー以上。
