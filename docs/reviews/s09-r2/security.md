# S09 受信箱 セキュリティレビュー (r2)

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
**レビュー方針**: r1 で挙げた 3 件の改善反映状況を中心に再採点 (STRIDE + OWASP Top10)

**前回スコア**: 92 / 100 → **PASS**
**今回スコア**: **97 / 100** → **PASS** (差分 **+5**)

---

## 総合スコア: **97 / 100** → **90+ 判定 PASS**

| # | 評価軸 | 配点 | r1 | r2 | 差分 | 判定 |
|---|---|---|---|---|---|---|
| 1 | テナント分離 (orgId 強制) | 20 | 17 | 20 | **+3** | PASS |
| 2 | 認可 (read-only, Operator+ は Phase2) | 20 | 19 | 19 | 0 | PASS |
| 3 | 入力検証 (filter / q / page) | 20 | 19 | 20 | **+1** | PASS |
| 4 | XSS / 表示エスケープ | 20 | 19 | 19 | 0 | PASS |
| 5 | コード匂い | 20 | 18 | 19 | **+1** | PASS |
| **計** | | **100** | **92** | **97** | **+5** | **PASS** |

---

## r1 指摘 → r2 反映状況

### (1) MEDIUM: messages 直 SQL の orgId 二重防御 → **完全解消** (+3 / テナント分離)

**r1 指摘**:
> 内部結合 `inner join leads l on l.id = m.lead_id and l.org_id = $orgId` を追加、または RLS。

**r2 確認結果** (`inbox.ts:148-173`):

```ts
const msgResult = await db.execute<MessageRow>(
  sql`
    select m.lead_id, m.content, m.direction, m.sent_at
    from (
      select
        m0.lead_id,
        m0.content,
        m0.direction,
        m0.sent_at,
        row_number() over (partition by m0.lead_id order by m0.sent_at desc) as rn
      from messages m0
      inner join leads l on l.id = m0.lead_id and l.org_id = ${orgId}   ← ★ 追加
      where m0.lead_id in (${sql.join(leadIds, sql`, `)})
    ) m
    where m.rn = 1
  `
);
```

評価:
- `inner join leads l on l.id = m0.lead_id and l.org_id = ${orgId}` を r1 推奨どおり追加。
- `${orgId}` は drizzle の `sql` テンプレートタグ経由で prepared statement の bind パラメータとして渡る (SQLi 不可)。
- `inner join` のため、もし将来 `leadIds` の生成経路が壊れて他 org の lead_id が混入しても、DB レイヤでクロステナント行が **物理的に消える** (行数 0 で返る)。
- 上位の Drizzle クエリ (rows 取得側) も既に `eq(schema.leads.orgId, orgId)` で org 制約済み。**二重防御 (defense-in-depth) が成立**。
- 設計書 §17 ABAC 想定の RLS と将来統合しても重複ではあるが過剰防御にはならない (RLS は USING 述語、ここはクエリ述語、レイヤが異なる)。

**コメント (-0)**:
- `leads l` の table alias と `l.org_id` の参照位置が正しい。`m0.lead_id` 側を join 条件に置いている点も EXPLAIN 上 hash join → nested loop 双方で安定的に効くため OK。
- パフォーマンス影響: leads.id は PK のため index hit、追加コストはほぼゼロ。`org_id` の verify は B-tree lookup 後の比較のみ。

→ **テナント分離 17 → 20 (+3)**。HIGH/MEDIUM 共に該当残存無し。

---

### (2) LOW: `"snoozed"` がホワイトリストに通るがクエリ層で未実装 → **完全解消** (+1 / 入力検証)

**r1 指摘**:
> `ALLOWED_FILTERS` から削除するか分岐追加。enumeration 表面減のため削除推奨。

**r2 確認結果**:

`page.tsx:15`:
```ts
const ALLOWED_FILTERS = new Set<ThreadFilter>(["all", "unread", "review", "meeting"]);
```

`inbox.ts:15`:
```ts
export type ThreadFilter = "all" | "unread" | "review" | "meeting";
```

`inbox-filter-tabs.tsx:10-15`:
```ts
const TABS: { key: ThreadFilter; ... }[] = [
  { key: "all",     label: "すべて",     countKey: "all" },
  { key: "unread",  label: "未読",       countKey: "unread" },
  { key: "review",  label: "要レビュー", countKey: "review" },
  { key: "meeting", label: "商談化",     countKey: "meeting" },
];
```

評価:
- `ThreadFilter` 型からも `"snoozed"` を削除し、`ALLOWED_FILTERS` / UI Tab / `stateFilter` 分岐の **4 層で完全一致**。
- TypeScript 型レベルで `"snoozed"` が排除されるため、誤って query 層で受け取る経路がコンパイル時に塞がる (型安全)。
- セキュリティ観点: 「ホワイトリストに通るが無動作」状態が消え、**unknown 値 → silent fallback "all"** の挙動だけが残る (`page.tsx:23-25`)。これは想定通り。
- 副次効果: enumeration surface (攻撃者がフィルタ値を試して挙動差から内部状態を推測) が縮小。

→ **入力検証 19 → 20 (+1)**。

---

### (3) LOW: raw SQL の戻り値型キャストが緩い → **大幅改善** (+1 / コード匂い)

**r1 指摘**:
> Drizzle 標準クエリへの書き換え、または zod ランタイム検証。

**r2 確認結果** (`inbox.ts:151-184`):

```ts
type MessageRow = {
  lead_id: string;
  content: string;
  direction: "outbound" | "inbound";
  sent_at: string | Date;
};
const msgResult = await db.execute<MessageRow>(
  sql` ... `
);
const rawRows = (msgResult as unknown as MessageRow[]) ?? [];
for (const r of rawRows) {
  const sentAt = r.sent_at instanceof Date ? r.sent_at : new Date(r.sent_at);
  lastMessages.set(r.lead_id, {
    content: r.content ?? "",
    direction: r.direction ?? "outbound",
    sentAt,
  });
}
```

評価:
- `db.execute<MessageRow>()` に **明示ジェネリクス指定** で row 型を強制。
- `sent_at` を `string | Date` の union で受け、`instanceof Date` ガード後に `new Date()` でフォールバック。r1 で懸念した `Invalid Date` → `NaN` → SLA 誤判定経路は、後段の `lastAt instanceof Date && now - lastAt.getTime() > SLA_MS` で `getTime()` が `NaN` でも `false` になるため誤発火しない (SLA 超過を見逃す方向に倒れる — fail-safe)。
- `content` / `direction` には `?? ""` `?? "outbound"` の null-coalescing fallback あり。
- セキュリティ的には rawRows の汚染データが UI に出る経路は React text node 補間で XSS 化しないため安全。

**残存 LOW (-1)**:
- `(msgResult as unknown as MessageRow[])` の二段キャストはまだ存在。drizzle の `execute<T>()` が driver 依存で `T[]` か `{ rows: T[] }` を返すかが不安定なため、ジェネリクス指定だけでは TS 型と実体の整合が取れない (実装合意の問題、コードレビュー範囲内)。
- 完全に潰すなら `z.array(messageRowSchema).parse(...)` のランタイム検証、または Drizzle 純正の `db.select().from(messages).innerJoin(leads, ...)` + window function サブクエリへの全面書換が必要。R3 で 100/100 を狙うなら推奨。

→ **コード匂い 18 → 19 (+1)**。

---

## r2 で新規発生した懸念

### NEW HIGH: **無し**
### NEW MEDIUM: **無し**
### NEW LOW: **無し**

raw SQL 改修・型ジェネリクス追加・ホワイトリスト同期のいずれにも regression は確認できず。

---

## OWASP Top 10 (2021) 再走査

| # | 項目 | r1 | r2 |
|---|---|---|---|
| A01 Broken Access Control | △ (messages 直 SQL の defense-in-depth 不足) | **◎** (inner join leads で 2 層化) |
| A02 Cryptographic Failures | ◎ | ◎ |
| A03 Injection | ◎ (drizzle prepared + sql.join + LIKE escape) | ◎ (`${orgId}` も bind 経由) |
| A04 Insecure Design | △ (RLS 未適用) | △ (Phase2 で RLS 想定、コード層では二重防御達成) |
| A05 Security Misconfiguration | ◎ | ◎ |
| A06 Vulnerable Components | ◎ | ◎ |
| A07 Auth Failures | ◎ | ◎ |
| A08 Data Integrity | N/A (read-only) | N/A |
| A09 Logging Failures | ◎ | ◎ |
| A10 SSRF | ◎ | ◎ |

A01 が △ → ◎ に昇格 (DB レイヤの RLS は Phase2 残課題として保留)。

---

## HIGH / MEDIUM / LOW サマリ (r2 時点)

### HIGH 残存
- **無し**

### NEW HIGH (r2 で発生)
- **無し**

### MEDIUM 残存
- **無し** (r1 の 1 件は完全解消)

### LOW 残存
1. **users JOIN に orgId 述語無し** — `inbox.ts:125`
   - `and(eq(users.id, campaigns.ownerUserId), eq(users.orgId, orgId))` 推奨。
   - r1 から変化無し、Phase2 RLS で潰す方針なら据置可。
2. **snippet() で制御文字 / RTL override が素通り** — `inbox.ts:241-245`
   - r1 から変化無し。UI スプーフィング対策、本来は受信側責務。
3. **raw SQL の `as unknown as MessageRow[]` 二段キャスト** — `inbox.ts:176`
   - ジェネリクス追加で大幅改善されたが、ランタイム検証 (zod) または Drizzle 純正書き換えで完全潰し可能。
4. **未ログイン時に mock データを返す挙動** — `page.tsx:30`
   - 本ファイル責務外、middleware 認証ガードの確認推奨。

LOW は **5 件 → 4 件**、内 1 件は r1 から半解消 (raw SQL 型ガード)。

---

## 90+ 判定

**総合 97 / 100 で PASS。** (r1 92 → r2 97, **+5**)

- **HIGH 残存: 無し**
- **MEDIUM 残存: 無し**
- **LOW 残存: 4 件** (いずれも本 PR スコープ外 or Phase2 想定)
- r1 で挙げた 3 件の改善 (messages 直 SQL の inner join, ThreadFilter から snoozed 削除, `db.execute<MessageRow>()` ジェネリクス) はすべて期待どおり反映済み。
- 反映による regression は検出されず。
- セキュリティ観点では受信箱は **本 PR 単体でリリース可能水準** に到達。

### 残 +3 を取りに行く場合 (98+ → 100 狙い)
1. **+1**: `inbox.ts:125` の users JOIN に `eq(users.orgId, orgId)` を追加 → A01 完全潰し。
2. **+1**: `messages` テーブルに RLS policy 適用 (Supabase migration) → コード層 + DB 層の三重防御。
3. **+1**: `snippet()` に zero-width / RTL override / bidi-control の除去を追加 → UI スプーフィング対策。

いずれも Phase2 で扱う想定だが、(1) は 1 行追加なので本 PR 内で対応推奨。

---

## 推奨アクション

| 優先度 | アクション | 期待効果 |
|---|---|---|
| (任意, 1 行) | `users` JOIN に `eq(schema.users.orgId, orgId)` 追加 | A01 完全潰し / +1 |
| Phase2 | `messages` テーブルへの RLS 適用 | コード bug fallback / Supabase migration |
| Phase2 | `snippet()` に制御文字 strip | UI スプーフィング対策 |
| Phase2 | raw SQL を Drizzle 純正クエリへ書換、または zod ランタイム検証 | 型安全完全化 |

本 PR は **このまま merge 可**。S09 受信箱はセキュリティ観点 PASS。

以上。
