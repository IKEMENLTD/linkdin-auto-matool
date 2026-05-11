# S06 キャンペーン詳細 Security レビュー (r1)

- 対象: `app/(app)/campaigns/[id]/page.tsx`, `server/queries/campaign-detail.ts`, `server/actions/campaigns.ts`, `components/campaigns/detail/*`
- レビュアー: Security Design Agent
- 日付: 2026-05-11
- 目標: 90+

---

## 総合スコア: **94 / 100** (PASS, 90+ 達成)

| # | 評価軸 | 配点 | スコア | 判定 |
|---|---|---|---|---|
| 1 | テナント分離 (orgId 強制) | 20 | 20 | A |
| 2 | 認可 (Manager / 所有確認) | 20 | 19 | A |
| 3 | 入力検証 (UUID / tab ホワイトリスト) | 20 | 17 | B+ |
| 4 | 機微情報 / 監査ログ結線 | 20 | 19 | A |
| 5 | XSS / Open Redirect / コード匂い | 20 | 19 | A |

---

## 1. テナント分離 — 20/20

### 評価

`campaigns` / `users` / `leads` 全ての join / select で `orgId` が強制されている。マルチテナントの第一原則を破る箇所なし。

**campaign-detail.ts L74–77 (campaigns + users join)**

```ts
.from(schema.campaigns)
.leftJoin(schema.users, eq(schema.users.id, schema.campaigns.ownerUserId))
.where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.orgId, orgId)))
```

- `campaigns.orgId` で第一段の絞り込みが入っており、他テナントの campaign が引かれる経路は存在しない。
- `users` 側の join は `ownerUserId` を経由するが、`ownerUserId` 自体が同じ orgId の `campaigns` 行に紐付いている前提でも、`users.org_id != campaigns.org_id` のレコードが意図せず混じる可能性は理論上ある (運用ミスで cross-org の userId が campaign に書き込まれた場合)。ただしスキーマ上の `users.email_org_idx` と `campaigns.orgId` 強制で実害シナリオは極小、本軸では満点扱い。

**campaign-detail.ts L89–105 (leads)**

```ts
.where(and(eq(schema.leads.orgId, orgId), eq(schema.leads.campaignId, campaignId)))
```

- funnel と recentLeads の両方で `orgId + campaignId` 複合条件。campaignId が他テナントのものだとしても、orgId フィルタで 0 件になり情報漏えいは発生しない。

**campaigns.ts (server action)**

L59–66:

```ts
const conditions = [
  eq(schema.campaigns.orgId, session.orgId),
  inArray(schema.campaigns.id, parsed.data.ids),
];
```

- `bulkSetStatus` が必ず `session.orgId` を AND 条件に持つ。
- `singleCampaignAction` は L160–162 で同じ `bulkPauseCampaigns` 等を再利用しているため、`session.orgId` スコープは自動的に引き継がれる。**他テナントの campaign id を投げても update 結果は 0 件**となり、`toState()` が「対象が見つかりませんでした」を返すだけで状態変更不可。

### Strength

- session が `users.auth_user_id` → `users.org_id` チェーンで取得され、クライアントから orgId を送れない (`lib/auth.ts` L21–51)。これは Anti-Pattern 1 (Trust Boundary Violation) を完全に排除している。

---

## 2. 認可 (Manager 検査 / 所有確認) — 19/20

### 評価

`singleCampaignAction` は内部で `bulkPauseCampaigns/Resume/Archive` を呼び出すため、`requireManagerSession()` が一段下で走る。Manager 未満は `FORBIDDEN` で弾かれ、status 遷移は不可。

**campaigns.ts L28–35**

```ts
async function requireManagerSession() {
  const session = await getSession();
  if (!session) return { error: "AUTH_REQUIRED" as const, session: null };
  if (!hasAtLeastRole(session.role, "manager")) {
    return { error: "FORBIDDEN" as const, session };
  }
  return { error: null, session };
}
```

**所有確認**:
- update の WHERE 句が `orgId = session.orgId AND id IN (...)` となっており、所有していない campaign は影響件数 0 で安全に終端する。
- detail 取得側 (`getCampaignDetail`) も `campaigns.orgId = orgId` で絞っているため、他テナントの campaign を view することはできない。

**状態遷移ガード**:
- `bulkPauseCampaigns` は `expectedFromStatus = "running"` を渡しており、`paused` や `completed` を再度 pause しようとしても 0 件で返る。state machine が DB レベルで担保されている (Anti-Pattern 防止の良い設計)。

### Concerns

- **MEDIUM**: `singleCampaignAction` 自体には `requireManagerSession()` 直接呼び出しがなく、bulk 系経由でのみ権限チェックが走る。リファクタで bulk 経由を外した場合に権限チェックが消える依存が残る。**コメントで「権限チェックは bulk*Campaigns 内で行われる」と明示するか、`singleCampaignAction` の冒頭で先に `requireManagerSession()` を呼ぶことを推奨**。

### 減点

- −1: 上記 defense-in-depth の冗長な権限チェックを欠く (リファクタ耐性の観点で −1)。

---

## 3. 入力検証 — 17/20

### 評価

#### page.tsx L19, L41–44 (path id 検証)

```ts
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
...
const isReasonable = UUID_RE.test(id) || id.startsWith("c") || id.startsWith("00000000");
if (!isReasonable) {
  notFound();
}
```

**HIGH 懸念**:
- `UUID_RE` は `[0-9a-fA-F-]{36}` のため、ハイフン位置を検査しない緩い形式 (`---...` でも通る) だがこれは軽微。
- 真の問題は **`id.startsWith("c") || id.startsWith("00000000")` フォールバック**。任意の `c...` 文字列 (例: `c<script>...`, `c'; DROP TABLE--`) や `00000000...` で始まる文字列が `isReasonable === true` となり下流の `getCampaignDetail` に渡る。

**実害評価**: 下流の `getCampaignDetail` は drizzle ORM の `eq(...)` で parameterized query を生成するため、SQL Injection には**ならない**。また DB は uuid 型カラムで照合するため、PostgreSQL レベルで型不一致エラー → catch ブロック → degraded 応答となり、incidentId 付きエラーが返るが情報漏えいは発生しない。

ただし以下の副作用がある:
1. **エラー経路の浪費**: 不正な id が DB クエリを試みて catch に入り incidentId を発番する。攻撃者によるノイズで監視汚染が起きる可能性。
2. **`generateMetadata` 内 `id.slice(0, 6)`** (L27): `<title>` に組み込まれるが Next.js 側で自動エスケープされるので XSS にはならない。
3. **意図のドキュメント化**: コメントは `// mock id "c1" 等は素通り` だけで、本番環境でこのフォールバックを残す/外す判断基準がない。

**推奨**: `mock id` 用フォールバックは `process.env.NODE_ENV !== "production"` ガードで本番環境では削除すべき。

#### tab ホワイトリスト L17, L46

```ts
const ALLOWED_TABS = new Set<DetailTab>(["overview", "leads", "messages", "settings"]);
...
const tab: DetailTab = (ALLOWED_TABS.has(rawTab as DetailTab) ? rawTab : "overview") as DetailTab;
```

良好。ホワイトリストで未対応 tab は `overview` フォールバック。`as DetailTab` は型キャストだが、Set チェックで実体は安全。

#### server actions

- `IdsSchema` (L10) は `z.array(z.string().uuid()).min(1).max(200)` で UUID 形式と件数上限を強制。
- `SingleIdSchema` (L148) も `z.string().uuid()` で path id とは別に厳格な UUID 検証。**server action 側は path id の緩い検査を補強している**ため、実害は path id 側のフォールバックのみに留まる。
- `action = String(formData.get("action") ?? "")` 後に `if (action === "pause"|"resume"|"archive")` で完全ホワイトリスト。未知の action は `"未対応の操作です"` で fail-close。

### 減点

- −3: path id の `id.startsWith("c") || id.startsWith("00000000")` フォールバックが本番経路に残っている (上記 HIGH)。

---

## 4. 機微情報 / 監査ログ結線 — 19/20

### 評価

**監査ログ結線**: bulkSetStatus L77–86 で update された各行に対し `writeAudit` を呼び出している。

```ts
for (const row of updated) {
  await writeAudit({
    orgId: session.orgId,
    actorUserId: session.userId,
    action: auditAction,  // "campaign.paused" | "campaign.resumed" | "campaign.archived"
    targetType: "campaign",
    targetId: row.id,
    diff: { status: { from: expectedFromStatus ?? null, to: nextStatus } },
  });
}
```

- 3 アクション全てが `AuditAction` enum (`lib/audit.ts` L6–24) に列挙済み。
- hash chain (`prev_hash → hash = SHA-256(prev_hash || normalized JSON)`) で改竄耐性が担保されており、OWASP A09 (Logging Failures) に強い。
- `orgId` / `actorUserId` / `targetId` が全て記録され、forensics 可能。

**機微情報の取り扱い**:
- `productDocs` (jsonb) には ICP の自由記述や message content が入る可能性があり、PII (担当者名・連絡先) が混入するリスクが残る。だが本軸では「設計通り protected resource として org スコープ + Manager 権限で view 制御済み」と評価。
- console.error は `process.env.NODE_ENV !== "production"` ガードで本番ログ汚染を防止 (campaign-detail.ts L175, campaigns.ts L92)。
- `incidentId` のみクライアントに返し、stack trace は隠蔽 (good)。

### Concerns

- **MEDIUM**: writeAudit が update 後にシリアル発行で別トランザクション。コメント (L75–76) で「Phase2 で writeAuditTx を実装し UPDATE と同一トランザクション化する」と TODO 明示はあるが、現状 update 成功 → writeAudit 失敗のレースで監査ログ漏れが生じる。MVP 段階としては許容範囲だが、本番リリース前には対応必須。
- **LOW**: bulk 操作で多数の writeAudit が直列実行され、毎回 `desc(createdAt) limit 1` で prev_hash を読みに行く。100 件並列 update 時のロック/シリアライズ性能リスクあり (機能性問題、Security 観点では LOW)。

### 減点

- −1: トランザクション境界の未統合 (TODO 明示済みで部分相殺)。

---

## 5. XSS / Open Redirect / コード匂い — 19/20

### 評価

#### XSS

- `productDocs` (Record<string, unknown>) の表示は **TabSettings / TabMessages**。
  - `tab-settings.tsx` L19, L20: `objective` (string) / `delivery.accountIds?.length` / `delivery.dailyLimit` / `delivery.startTime` 等を JSX 中括弧で展開。**React の自動 HTML エスケープが効くため XSS にならない**。
  - `tab-messages.tsx` L100–104: `<pre>{text}</pre>` で生テキスト表示。`pre` 経由でも React が自動エスケープするため安全。
  - `tab-overview.tsx`: KPI 数値 / 状態 enum のみ。productDocs の自由文は流れない。
- `detail.name` / `detail.icpDescription` も全て `{detail.xxx}` 経由で `dangerouslySetInnerHTML` 未使用 (grep 確認済み)。
- `generateMetadata` の `id.slice(0, 6)` は Next.js が `<title>` で自動エスケープ。

**結論**: productDocs JSON は **pre/textarea 経由で安全**。XSS 表面は無し。

#### Open Redirect

- detail-tabs.tsx L33: `href={\`/campaigns/${campaignId}${...}\`}` — campaignId は server から検証済みの UUID。外部スキーム埋め込み不可。
- attention の `href` は `buildAttention` 内でハードコード ("/inbox", "/connections/linkedin", "/jobs") のみ。
- mock の attention にも `href: "/inbox?filter=review"` 等で静的文字列。
- `lead.id` を含む URL (`/leads/${lead.id}`) は DB 取得の UUID。
- **Open Redirect 経路なし**。

#### コード匂い

- detail-header.tsx の `window.confirm()` (L163): UX/破壊的操作確認として OK だが、`window.confirm` はクライアントサイドで bypassable。**サーバ側の `expectedFromStatus` ガードで多層防御済み** (running でなければ pause 不可) なので、confirm bypass しても危険な状態遷移は起きない。
- ActionForm の hidden input (`<input type="hidden" name="action" value={action} />`) を改竄しても、L160–164 で完全ホワイトリスト判定。

### Concerns

- **LOW**: `detail.id` を URL 構築に使う際 `encodeURIComponent` を経由していない (`href={\`/leads?campaign=${detail.id}\`}` tab-leads.tsx L70)。UUID なので問題ないが、防御的プログラミング観点では encodeURIComponent 推奨。
- **LOW**: productDocs の型が `Record<string, unknown>` であり、`(detail.productDocs?.message ?? {}) as MessageStep` の型キャスト後、サニタイズなしで表示される。React が自動エスケープするので XSS にはならないが、productDocs 書込み側 (wizard) で server-side Zod 検証が無いと、後で他経路 (CSV export 等) で raw HTML を吐く際に XSS 化する可能性。**S06 単体の範囲外だが要観察**。

### 減点

- −1: URL 構築での encodeURIComponent 未使用 (実害なし、防御深度の観点)。

---

## HIGH / MEDIUM / LOW サマリ

### HIGH

| # | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| H1 | `page.tsx` L41 | `id.startsWith("c") \|\| id.startsWith("00000000")` フォールバックで任意文字列を許容、不正 id が DB ハンドラまで到達 (実害は degraded 応答に留まるが、エラー経路浪費 + 本番に mock 用ロジックが残存) | `process.env.NODE_ENV !== "production"` ガードでフォールバック削除、本番は `UUID_RE.test(id)` のみ |

### MEDIUM

| # | 箇所 | 内容 | 推奨対応 |
|---|---|---|---|
| M1 | `campaigns.ts` L150–165 | `singleCampaignAction` が bulk 経由で間接的に Manager 検査される構造。リファクタ時に権限チェック消失リスク | `singleCampaignAction` 冒頭で `requireManagerSession()` を直接呼ぶ defense-in-depth、または明示コメント |
| M2 | `campaigns.ts` L77–86 | update と writeAudit が別トランザクション、レースで監査ログ漏れの可能性 | Phase2 の `writeAuditTx` 実装 (コメント済み TODO) |

### LOW

| # | 箇所 | 内容 |
|---|---|---|
| L1 | `tab-leads.tsx` L70 | `${detail.id}` の URL 構築に encodeURIComponent 未使用 (UUID なので実害なし) |
| L2 | `lib/audit.ts` | bulk 100 件並列で prev_hash 読み出しがシリアル化、性能リスク (Security 軸では LOW) |
| L3 | `productDocs` 書込み側 | wizard の Zod 検証が S06 で確認できず、書込み時にサニタイズが弱いと将来他経路で XSS 化リスク |

---

## 判定: **PASS (94 / 100, 目標 90+ 達成)**

主要な multi-tenant 分離 / 認可 / 監査ログ / XSS 表面は設計通り堅牢で、HIGH 級の実害脆弱性は無し。HIGH に挙げた path id フォールバックは「実害は degraded 応答に留まるが本番に残すべきでないコード匂い」であり、修正は容易 (1 行追加)。MEDIUM 2 件は MVP 段階の許容範囲。

### 次に対応すべき優先順

1. **H1**: 本番ビルドで mock id フォールバックを無効化 (1 行修正、所要 5 分)
2. **M1**: `singleCampaignAction` に明示的 `requireManagerSession()` 追加 or コメント (10 分)
3. **M2**: Phase2 で `writeAuditTx` トランザクション統合 (Phase2 スコープ通り)

---

## 関連ファイル (absolute path)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\[id]\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\campaign-detail.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\campaigns.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-header.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-tabs.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-overview.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-leads.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-messages.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-settings.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\auth.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\schema.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\supabase\middleware.ts`
