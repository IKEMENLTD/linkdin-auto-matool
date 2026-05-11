# S09 受信箱 — CTO レビュー (r1)

- **対象コミット**: 未コミット (working tree)
- **対象ファイル**
  - `app/(app)/inbox/page.tsx`
  - `server/queries/inbox.ts`
  - `components/inbox/inbox-filter-tabs.tsx`
  - `components/inbox/inbox-thread-list.tsx`
- **比較対象**: `lib/utils.ts`, `lib/incident.ts`, `lib/state-machine.ts`, `db/schema.ts`, `db/client.ts`, `components/ui/pagination.tsx`, `components/ui/state-chip.tsx`
- **評価者**: cto-agent
- **基準**: 90+ 合格

---

## 総合スコア: **87 / 100** — 90+ 不合格 (HIGH 2 件残)

| 軸 | 配点 | 評点 | 主観メモ |
|---|---|---|---|
| 1. Next.js 15 RSC / Server Action | 20 | 14 | RSC ガード概ね良好。ただし Server Component → `"use client"` Pagination に **関数 prop `hrefFor` を渡している**。Next 15 では RSC→Client 境界の関数 prop は Server Action 化されていない限りシリアライズ不可。dev は通っても prod build / strict mode で fail し得る (HIGH) |
| 2. TypeScript / Drizzle 型安全 | 20 | 16 | orgId は全 join に伝播済 (campaigns / users 両方)。`sql.join(leadIds, sql\`, \`)` は parameterized。一方 `r.state` を `InboxThread.state: LeadState` に直入れしているが、Drizzle の enum select 戻り値は `LeadState` を含む union literal なのでこれは OK。`(msgRows as unknown as { rows?: ... }).rows` の **二段キャスト** は事実上 escape hatch (MEDIUM) |
| 3. データ取得 (Promise.all 3並列 + 最終msg) | 20 | 17 | 3並列 + window function 1発の合計 4 RTT は良設計。N+1 を回避。ただし最終 message は **orgId tenancy 条件が無く** `messages.lead_id IN (...)` のみで取得 (HIGH: tenant cross-leak risk) |
| 4. エラーハンドリング (degraded + incident_id) | 20 | 19 | try/catch で `source: "degraded"` + `incidentId` 表示、role="alert"、本番では console.error 抑止、UI 側で `<code>` 表示まで一貫。ほぼ完璧 |
| 5. 再利用性 / 命名 | 20 | 21→**上限 20** | EmptyState / Pagination / StateChip / Badge / Input を素直に再利用。ThreadFilter 型 export、ALLOWED_FILTERS をホワイトリスト化。grid columns の md prefix 二重 (LOW) |

> 軸 5 は実質満点だが配点 20 で頭打ち。

---

## ホワイトリスト / 既知チェック項目への所感

| チェック観点 | 結果 |
|---|---|
| `listInboxThreads` の `sql.join(leadIds, sql\`, \`)` パラメータ化 | **OK**。Drizzle `sql.join` は各要素を個別の placeholder としてビルダーに push する (リテラル展開ではない)。leadIds は UUID select 結果 = string なので postgres-js が `text` として bind。SQLi なし |
| `(msgRows as unknown as { rows?: ... }).rows` の二段キャスト | **MEDIUM**。`db.execute()` の戻り値が driver 依存で型安定しないための逃げだが、(a) `unknown` 経由は型ガード無し、(b) `r.lead_id` を `String()` で str 化しているのに valid UUID か未検証、(c) `r.sent_at` を `new Date(...)` で寛容に受けている。せめて zod 等で `messageRowSchema.parse(r)` を 1 行入れたい |
| ThreadFilter のホワイトリスト | **OK**。`ALLOWED_FILTERS = new Set<ThreadFilter>([...])`、`ALLOWED_FILTERS.has(sp.filter as ThreadFilter) ? ... : "all"` の三項分岐で型 narrow も成立 |
| ThreadRow grid columns の md prefix 重複 | **LOW (確認)**。`grid-cols-[1.5fr_120px_minmax(180px,2.4fr)_120px_24px] md:grid-cols-[1.5fr_120px_minmax(180px,2.4fr)_120px_24px]` は base と md で **完全に同一定義**。冗長なだけで実害は無いが、`hidden md:flex` で中段カラム自体は md 未満で非表示なので、base はそもそも 5 カラム不要 (=1 カラム or 2 カラム+ChevronRight)。コンパイル後の Tailwind class が膨らむだけなのでクリーンアップ推奨 |
| counts の `all` が `statusMap` の sum (=tenant全体) であり、フィルタ後 `total` と分離されているか | **OK & 設計通り**。`all` は `MESSAGED|REPLIED|MEETING|COMPLETED|FAILED` の orgId 内総数、`total` は filter+q 適用後の件数。タブの数字は "全体" が見えていないと UX が壊れるので妥当。ただし `q` で絞ったときも `counts.all` は不変なので「全件にスイッチして q を維持できる」UX を実現しており設計意図通り。**ドキュメント or コメントで明示するとレビュー摩擦が減る (LOW)** |

---

## HIGH (90+ 阻害)

### H-1. `Pagination` (`"use client"`) に関数 prop `hrefFor` を渡している
`app/(app)/inbox/page.tsx:108` で `<Pagination ... hrefFor={hrefFor} />` を Server Component から渡しているが、`components/ui/pagination.tsx:1` は `"use client"`。Next 15 / React Server Components の境界では、**Server → Client への function prop は Server Action ('use server' 関数) でない限りシリアライズ不可**。

- dev では一見動くケースもあるが、`reactProductionProfiling`/`turbo build` / Vercel prod で `Functions cannot be passed directly to Client Components` エラーが出る。
- もしくは黙ってクライアント側で関数がリビルドされ、SSR/CSR 不一致 (hydration mismatch) になる。

**Fix (推奨)**: `Pagination` を **Server Component 化** する。`Link` 自体は RSC で OK で、`PagerLink` の disabled span 分岐も client interaction 不要。`"use client"` を外し、`hrefFor` を関数 prop のまま受ければ問題ない。あるいは `hrefFor` を渡さず `basePath` + `query` を渡す純粋データ prop に変える。

```diff
- "use client";
+ // RSC: Pagination is a pure rendering component, no client interactivity needed.
```

### H-2. `messages` の最終メッセージ取得に orgId が無い (cross-tenant 漏えい余地)
`server/queries/inbox.ts:149-164` の raw SQL は `messages.lead_id IN (leadIds)` のみ。`leadIds` は **当該 orgId 内の leads から作られている** ため現実には他テナントの message を引かないが、

- `messages` テーブル自体に `org_id` 列が無い (`db/schema.ts:180-196`)
- 将来 `leads.id` のスコープが膨らんだり、`leadIds` の生成元が変わる/バグると tenant leak の単一防壁が壊れる
- 監査・ABAC 観点 (設計書 §17) で defense-in-depth が無い

**Fix**: 最終 message クエリでも明示的に orgId を join する。

```sql
select m.lead_id, m.content, m.direction, m.sent_at
from (
  select m.lead_id, m.content, m.direction, m.sent_at,
         row_number() over (partition by m.lead_id order by m.sent_at desc) as rn
  from messages m
  inner join leads l on l.id = m.lead_id and l.org_id = ${orgId}
  where m.lead_id in (${sql.join(leadIds, sql`, `)})
) m
where m.rn = 1
```

または schema レベルで `messages.org_id` を追加し RLS / index を貼る (本筋)。短期は前者で十分。

---

## MEDIUM

### M-1. `(msgRows as unknown as { rows?: ... }).rows` の二段キャスト
`server/queries/inbox.ts:166`。

- `db.execute()` は drizzle-orm の driver bridge で戻り型が `unknown` 寄り。`as unknown as` は意図的な escape hatch だが、**zod スキーマでの runtime 検証を一切していない**ため、driver の挙動変更 / driver swap 時に silent fail する。
- `r.lead_id` を `String(r.lead_id)` しているが、UUID 形式の検証 (`UUID_RE`) を別途定義しているのに使っていないのは惜しい。
- `new Date(String(r.sent_at))` は `r.sent_at` が `Date` でも `string` でも `null` でも通る寛容実装。`null` 時の `Invalid Date` が `lastAt instanceof Date && !isNaN(lastAt.getTime())` まで詰まないと SLA 計算がバグる。

**Fix**: 既に定義してある `UUID_RE` を使う最小ガード + Date null チェックを入れる。

```ts
const MessageRowSchema = z.object({
  lead_id: z.string().regex(UUID_RE),
  content: z.string(),
  direction: z.enum(["outbound", "inbound"]),
  sent_at: z.coerce.date(),
});
```

### M-2. `sql\`... in ('MESSAGED','REPLIED',...)\`` の重複定義
`server/queries/inbox.ts:96-97` と `:137` で同一 state リテラル列挙が 2 箇所。タイポ・列挙ドリフトが起きやすい。`const INBOX_ACTIVE_STATES = sql\`... in ('MESSAGED','REPLIED','MEETING','COMPLETED','FAILED')\`` で定数化、または `inArray(leads.state, INBOX_ACTIVE_STATES_TS)` で TS 配列 + Drizzle 標準を使えば二重メンテ不要。

### M-3. `LeadState as` cast の混入 (mock データ)
`server/queries/inbox.ts:356` で `"CONNECTED" as LeadState` と強制キャスト。**enum に "CONNECTED" は存在する** (`db/schema.ts:27`, `lib/state-machine.ts:31`) のでこの cast は不要。本番では `state: "CONNECTED"` で十分通る。`as` を残すと将来 enum から外れても TS が warning しなくなる。

---

## LOW

### L-1. Grid columns の `md:` プレフィックス完全重複
`components/inbox/inbox-thread-list.tsx:118`。base = md が同一定義なら `md:` 不要。さらに base 表示では中段 `hidden md:flex` などで実カラム数が減るので、base 用 grid をシンプルにしてもよい。CSS bundle が数十バイト痩せる。

### L-2. `counts.all` の意味コメント不足
`counts.all` は filter/q を無視した orgId-wide 件数なのに、`total` と並ぶと「同じ意味」と読み違える。

```ts
// counts.* は orgId 全体の件数 (タブ切替時に "全件 N" を表示するため),
// total はフィルタ+検索後の件数 (ページネーション基準).
```

を 2 行入れるだけで保守性が大幅向上。

### L-3. `clamp(Math.floor(Number(page) || 1), 1, PAGE_MAX)` が 2 箇所
`app/(app)/inbox/page.tsx:27` と `server/queries/inbox.ts:67` で同じ式が重複。query 関数の中で再 clamp しているので page.tsx 側は冗長 (ただし URL 表示用に hrefFor で使っているので消せない)。defensive で許容範囲だが、page 共通ヘルパ `parsePage(sp.page)` にすると DRY。

### L-4. `escapeLikePattern` のテスト不在
`lib/utils.ts:12` の実装は正しいが、`%`, `_`, `\` を含む実入力でのテストが無さそう。`pnpm test` に 3 ケース足すだけ。

### L-5. `dynamic = "force-dynamic"` + `fetchCache = "force-no-store"` の二重指定
`app/(app)/inbox/page.tsx:11-12`。Next 15 は `dynamic = "force-dynamic"` の時点で fetch cache も無効化されるため `fetchCache = "force-no-store"` は redundant。実害なし。

### L-6. `InboxFilterTabs` の検索が `useEffect` debounce 内で `router.push` していて key undo がぎこちない
入力が早いと最後の文字でなく中間状態に snap することがある。`useTransition` 化を将来検討。

---

## 90+ 判定

**不合格 (87/100)**。HIGH 2 件を解消すれば、各軸の上昇幅は以下の通り想定:

- H-1 解消 → 軸 1: 14 → **19** (+5)
- H-2 解消 → 軸 3: 17 → **19** (+2)
- M-1 (zod 検証) → 軸 2: 16 → **18** (+2)

→ 想定スコア **96 / 100** に到達。MEDIUM/LOW は r2 で合わせて clean up 可能。

---

## 推奨修正順序 (r2 で潰す優先度)

1. **H-1**: `components/ui/pagination.tsx` から `"use client"` を削除し RSC 化。`hrefFor` 関数 prop はそのままで通る。
2. **H-2**: `listInboxThreads` の raw SQL に `inner join leads l on l.id = m.lead_id and l.org_id = ${orgId}` を追加。
3. **M-1**: `db.execute` 戻り値を zod で 1 段検証。`UUID_RE` を流用。
4. **M-2 / M-3**: 列挙の定数化、不要 cast 除去。
5. **L-1 / L-2**: grid columns の base/md 統合 + コメント追記。
6. その他 LOW は時間があれば。

---

## 参考: 強み

- `Promise.all` 3 並列 (rows / total / statusCounts) は ベストプラクティス。
- 最終 message を **window function 1 発** に畳んで N+1 を完全に潰したのは設計者の判断力が出ている。
- `source: "live" | "mock" | "degraded"` の 3 値 + `incidentId` 表示は **設計書 §24 (incident_id 表示)** に厳格に準拠。`role="alert"` / `role="status"` まで使い分けている点は a11y 観点で◎。
- SLA 超過セクションを分離 + 左 3px の danger bar + 上部 subtitle 通知の 3 重表現は、UI/UX 設計書 §3 のマルチチャネル表現原則に合致。
- `clamp` + `Q_MAX_LEN=120` + `PAGE_MAX=1000` の二重ガード (page.tsx + query) は防御的でよい。
- `ALLOWED_FILTERS` ホワイトリスト → 型 narrow の流れが綺麗。
- `EmptyState` / `Pagination` / `StateChip` / `Badge` / `Input` の primitives 再利用率が高く、CSS 重複が極小。

以上。
