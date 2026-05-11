# S09 受信箱 セキュリティレビュー (r1)

**レビュー対象**:
- `server/queries/inbox.ts`
- `app/(app)/inbox/page.tsx`
- `components/inbox/inbox-filter-tabs.tsx`
- `components/inbox/inbox-thread-list.tsx`

**参照**:
- `db/schema.ts` (leads / campaigns / messages / users)
- `lib/auth.ts` (getSession)
- `lib/utils.ts` (clamp / escapeLikePattern)
- `lib/incident.ts` (newIncidentId)

**レビュー日**: 2026-05-11
**レビュー方針**: 設計レビュー型セキュリティ監査 (STRIDE + OWASP Top10 軽量適用)

---

## 総合スコア: **92 / 100** → **90+ 判定 PASS**

| # | 評価軸 | 配点 | スコア | 判定 |
|---|---|---|---|---|
| 1 | テナント分離 (orgId 強制) | 20 | 17 | PASS |
| 2 | 認可 (read-only, Operator+ は Phase2) | 20 | 19 | PASS |
| 3 | 入力検証 (filter / q / page) | 20 | 19 | PASS |
| 4 | XSS / 表示エスケープ | 20 | 19 | PASS |
| 5 | コード匂い | 20 | 18 | PASS |
| **計** | | **100** | **92** | **PASS** |

---

## 1. テナント分離 — 17 / 20

### 安全な点
- `listInboxThreads` の主クエリは `where (eq(schema.leads.orgId, orgId), ...)` で必ず org スコープ。
- campaigns LEFT JOIN は ON 句に `eq(schema.campaigns.orgId, orgId)` を**併記** (二重防御)。FK だけに頼らない設計で good。
- `statusCounts` クエリも `eq(schema.leads.orgId, orgId)` で独立に org 制約。
- `searchParams.orgId` ではなくサーバ側 `getSession()` から orgId を取得 (`page.tsx:30-31`)。クライアントからの org spoofing 不可。
- `getSession()` は Supabase `auth.users.id` → `public.users.auth_user_id` 突合 (email ベースではない)。なりすまし耐性あり。
- 状態フィルタは `LeadState[]` の `inArray` で渡されるため、ユーザ入力が SQL 識別子に到達しない。

### 懸念点 (減点 -3)

**MEDIUM: messages 直アクセスが org 述語を持たない (defense-in-depth 不足)**

```ts
// inbox.ts:149-164
const msgRows = await db.execute(
  sql`
    select m.lead_id, m.content, m.direction, m.sent_at
    from (
      select lead_id, content, direction, sent_at,
        row_number() over (partition by lead_id order by sent_at desc) as rn
      from messages
      where lead_id in (${sql.join(leadIds, sql`, `)})
    ) m
    where m.rn = 1
  `
);
```

- `leadIds` は直前の `db.select(...).from(schema.leads).where(eq(leads.orgId, orgId))` の結果なので、現状の制御フローではクロステナント lead_id は混入しない (**現時点では transitively 安全**)。
- しかし `messages` テーブルに直接アクセスする SQL に `org_id` 述語が**一切無い**ため、将来「leadIds を別経路で取る」「filter ロジックを抜本的に変える」「order/limit を移植する」等のリファクタで容易にクロステナント漏えいが発生し得る。
- 修正案: 内部結合で belt-and-suspenders を効かせる:
  ```sql
  from messages m
  inner join leads l on l.id = m.lead_id and l.org_id = $1
  where m.lead_id = any($2::uuid[])
  ```
  または PostgreSQL の **RLS (Row Level Security)** を `messages` テーブルにも適用すれば、コード側のミスをデータベース層で必ず止められる (設計書 §17 ABAC と整合)。

**LOW: users JOIN に orgId 述語が無い (-0 だが言及)**

```ts
// inbox.ts:125
.leftJoin(schema.users, eq(schema.users.id, schema.campaigns.ownerUserId))
```

`campaigns.ownerUserId` が常に同 org の users を指す前提なら問題ないが、書込み側にバグがあれば他 org の `users.name` が露出し得る。
`and(eq(users.id, campaigns.ownerUserId), eq(users.orgId, orgId))` を追加するか、RLS で潰すのが望ましい。

### 参考: `sql.join` の parameterized 性能

`sql.join(leadIds, sql\`, \`)` は drizzle の `sql` テンプレートタグを通り、各 UUID は文字列補間ではなく **prepared statement の bind パラメータ ($1, $2, ...) として渡される**。SQLi リスクはゼロ。さらに `leadIds` 自体が DB から取った UUID 列なのでユーザ入力経路には乗っていない。安全。

---

## 2. 認可 — 19 / 20

### 安全な点
- 受信箱はあくまで read-only。`getSession()` で全ロール (viewer 以上) が閲覧可と整合 (設計書通り)。
- mutate 系 (返信送信 / snooze / 担当変更) はファイル中に存在しない — Phase2 で `hasAtLeastRole(role, "operator")` ガードを追加する設計通り。
- ロール判定は `getSession()` 経由でサーバ側のみ。`hasAtLeastRole` の rank 表も健全。
- 未ログイン (`!orgId`) では mock データへフォールバック — 実データ漏えい無し。

### 懸念点 (-1)

**LOW: 未ログイン時の挙動が「無音で mock 表示」**

`session?.orgId ?? null` を queries に渡すと、未認証時は `mockInbox` が返り `source: "mock"` バナーで表示される。本来は `/inbox` をミドルウェアでログイン要求すべき。S09 単体のスコープではないが、上位レイヤで `redirect("/login")` がかかっていることを確認したい (要素は本ファイルでは検証不能)。

---

## 3. 入力検証 — 19 / 20

### 安全な点
- **filter 値**: `ALLOWED_FILTERS` Set による完全ホワイトリスト (page.tsx:15-25)。クエリ層 (`stateFilter` の三項) でも未知値はサイレントに `all` 扱い。二重防御。
- **q (検索クエリ)**: `(sp.q ?? "").slice(0, 120)` を page で適用、`Q_MAX_LEN=120` をクエリ層でも再適用。
- **LIKE メタ文字**: `escapeLikePattern` で `\` `%` `_` を正しくエスケープ (`%` を生で渡せば全件マッチでパフォーマンス DoS になり得るので必須)。
- **page**: `clamp(Math.floor(Number(...) || 1), 1, 1000)` を page と query 両方で。NaN → 1。`Math.floor` で `1.5e10` 系も整数化される。
- **perPage**: page.tsx 側では固定 30、query 側では `clamp(..., 10, 100)`。クライアントから無限スクロール DoS 不可能。

### 懸念点 (-1)

**LOW: `ALLOWED_FILTERS` に `"snoozed"` があるが、クエリ層の `stateFilter` switch は未対応**

```ts
// page.tsx:15
const ALLOWED_FILTERS = new Set<ThreadFilter>(["all", "unread", "review", "meeting", "snoozed"]);
// inbox.ts:77-84
const stateFilter: LeadState[] =
  filter === "review" ? ["REPLIED"]
  : filter === "meeting" ? ["MEETING"]
  : filter === "unread" ? ["REPLIED", "MEETING"]
  : []; // ← "snoozed" もここに落ちる
```

セキュリティリスクは無いが「ホワイトリスト通過したのに無動作」は機能バグ。`snoozed` をホワイトリストから削除するか、`stateFilter` で明示分岐する。

**Nit (減点無し)**: `Number(sp.page) || 1` は `"0"` → `1` に丸まる (`Number("0")` は falsy)。仕様上問題なし。

---

## 4. XSS / 表示エスケープ — 19 / 20

### 安全な点
- `snippet()` 関数は `content.replace(/\s+/g, " ").trim().slice(0, max-1) + "…"` のみ。HTML サニタイズはしていない**が、必要無い**。
- React コンポーネント (`InboxThreadList`, `inbox-thread-list.tsx:171`) では `{thread.lastMessageSnippet ?? "..."}` の **テキストノード補間**で出力。React 18+ は自動で HTML エンティティエスケープを行うため、`<script>` や `<img onerror=...>` などは無害化される。
- `dangerouslySetInnerHTML` は受信箱関連ファイル全体で**未使用**。
- `<Link href={\`/inbox/${thread.leadId}\`}>` は `leadId` が DB 由来の UUID (`leadStateEnum` の型保証無いが、`schema.leads.id` は `uuid` 型) なので URL injection 不可。
- `incidentId` (`page.tsx:84`) はサーバ生成 (`INC-YYYY-HHHHHH` 形式) で `<code>` 内テキストとして出力 — 安全。
- `searchParams` 由来の `q` は filter-tabs.tsx で `<Input value={q}>` に渡されるが React の value 属性は自動エスケープ。

### 懸念点 (-1)

**LOW: 改行除去のみ — 制御文字 / RTL override / zero-width は素通り**

`snippet()` は `\s+` のみ正規化。U+202E (RIGHT-TO-LEFT OVERRIDE) や U+200B (zero-width space)、絵文字異常組み合わせなどはそのまま画面に出る。XSS にはならないが、悪意ある送信者が表示順を視覚的に反転させるなどの UI スプーフィングが理論上可能。
- 修正案: `content.replace(/[ --​-‏‪-‮]/g, "")` を `snippet` に追加。
- 厳密にはメッセージ受信側 (LinkedIn → DB 投入時) で正規化すべき責務だが、表示層でも multi-layer 防御として入れる価値あり。

---

## 5. コード匂い — 18 / 20

### 良い点
- `import "server-only"` でクエリ層がクライアントバンドルに混入しないことを担保。
- エラーは `try/catch` で囲み、`incidentId` を返して degraded UI に渡す。スタックトレース漏えい無し。`NODE_ENV !== "production"` チェックで `console.error` をガード。
- `Promise.all` で 3 クエリを並列発行 — 良好。
- 型 (`ThreadFilter`, `InboxThread`, `InboxResult`) が明確で、`source: "live" | "mock" | "degraded"` が UI 分岐の根拠になっている。
- UUID_RE が export されているが本ファイルでは未使用 — Phase2 (個別スレッド画面) で利用予定と推測。デッドコードではない。

### 懸念点 (-2)

**LOW: `db.execute(sql\`...\`)` の戻り値型を `as unknown as { rows?: Array<Record<string, unknown>> }` でキャスト**

```ts
// inbox.ts:166
const rawRows = (msgRows as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];
```

- drizzle の `execute()` は driver 依存で、postgres-js / node-postgres / Neon driver で戻り値が違うため止むを得ないが、`r.lead_id` / `r.sent_at` は型保証無し。
- `new Date(String(r.sent_at))` が `Invalid Date` を返すと、`sentAt.getTime()` は `NaN`、`now - NaN > SLA_MS` は `false` で **SLA 超過が誤判定**される可能性 (機能影響、軽い)。
- 修正案: Drizzle ORM 経由で `db.select().from(schema.messages)....` に書き換えれば型安全になる (パフォーマンス的にも window function を Drizzle で書ける)。または `z.object({ lead_id: z.string().uuid(), sent_at: z.coerce.date(), ... }).parse(r)` でランタイム検証。

**LOW: mock データに実名 (山田太郎 / 林翔太 等) と組織情報がハードコードされている**

セキュリティ的には架空人物だが、開発者間で「これがダミーかどうか」分かりづらい。`source: "mock"` バナーで救済されているのでギリ許容。Phase2 で `mock_*` プレフィックスや明示的にフィクション風の名前へ変更を推奨。

**Nit (減点無し)**: `lastDirection: lastMsg?.direction ?? null` だが、`direction` enum (`messageDirectionEnum`) が `outbound | inbound` 以外を返さない前提が暗黙。`(r.direction as "outbound" | "inbound") ?? "outbound"` の fallback は型としては安全だが、enum 違反時に黙って `outbound` 扱いされる。

---

## OWASP Top 10 (2021) 走査

| # | 項目 | 状態 |
|---|---|---|
| A01 Broken Access Control | leads は org スコープ ◎ / messages 直 SQL は transitively 安全だが defense-in-depth 不足 △ |
| A02 Cryptographic Failures | 機微データ無し (受信箱は表示のみ) ◎ |
| A03 Injection | drizzle prepared statements + `sql.join` parameterized + LIKE escape ◎ |
| A04 Insecure Design | RLS 未適用 (Phase2 で対応想定) △ |
| A05 Security Misconfiguration | `force-dynamic` + `force-no-store` 適切 ◎ |
| A06 Vulnerable Components | 本 PR で新規依存追加無し ◎ |
| A07 Auth Failures | Supabase auth.users.id 突合、ロール rank 健全 ◎ |
| A08 Data Integrity | 受信箱は read-only — N/A |
| A09 Logging Failures | NODE_ENV ガード、incidentId 採番済み ◎ (incident → audit_log 連動は別 PR 想定) |
| A10 SSRF | 該当箇所無し ◎ |

---

## HIGH / MEDIUM / LOW サマリ

### HIGH
- **無し** (現時点で実利用可能なクロステナント漏えい経路は存在しない)

### MEDIUM
1. **messages 直 SQL の org スコープ欠如 (defense-in-depth)** — `inbox.ts:149-164`
   - 現状は `leadIds` 経路が org 制約済みで transitively 安全だが、リファクタで容易に破綻。
   - 修正案: 内部結合 `inner join leads l on l.id = m.lead_id and l.org_id = $orgId` を追加、または `messages` テーブルに RLS を適用。

### LOW
1. **users JOIN に orgId 述語無し** — `inbox.ts:125`
   - `and(eq(users.id, campaigns.ownerUserId), eq(users.orgId, orgId))` を追加推奨。
2. **`"snoozed"` がホワイトリストに通るがクエリ層で未実装** — `page.tsx:15` / `inbox.ts:77-84`
   - 機能バグ寄り。ホワイトリストから削除 or 分岐追加。
3. **snippet() で制御文字 / RTL override が素通り** — `inbox.ts:230-234`
   - UI スプーフィング対策として `‪-‮` 等の除去を追加推奨。
4. **raw SQL の戻り値型キャストが緩い** — `inbox.ts:166-173`
   - Drizzle 標準クエリへの書き換え、または zod ランタイム検証で型ガード。
5. **未ログイン時に mock データを返す挙動** — `page.tsx:30` (本ファイル責務外)
   - 上位ミドルウェアの `/inbox` 認証ガード確認推奨。

---

## 90+ 判定

**総合 92 / 100 で PASS。**

- HIGH 無し、MEDIUM 1件 (defense-in-depth 不足、現状は実害なし)、LOW 5件 (改善余地)。
- 主要なテナント分離・入力検証・XSS・認可の各項目はいずれも 17 点以上で合格水準。
- MEDIUM 1件は Phase2 で RLS を適用するか、本 PR 内で `inner join leads` パッチを 1 行追加するだけで簡単に解消可能。次の commit までに対応するなら 95+ も視野。

**推奨アクション**:
1. (任意, 高 ROI) messages 直 SQL を `inner join leads` 化 → MEDIUM 解消 → +2 点
2. (Phase2 で必須) `messages` への RLS 適用
3. (任意) `snoozed` フィルタの実装方針を decide & cleanup

以上。
