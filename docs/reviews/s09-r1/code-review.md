# S09 受信箱 コードレビュー (r1)

レビュー対象:
- `server/queries/inbox.ts`
- `components/inbox/inbox-filter-tabs.tsx`
- `components/inbox/inbox-thread-list.tsx`
- `app/(app)/inbox/page.tsx`

---

## スコアサマリ

| 評価軸 | 配点 | 取得 | 備考 |
| --- | ---: | ---: | --- |
| 1. 型安全 (any/as cast、raw SQL 型) | 20 | 15 | `as unknown as` 1 箇所 + 型ガード薄い |
| 2. React 19 / Next.js 15 (use client 境界) | 20 | 18 | 境界は適切。debounce effect が SSR-CSR 初回に余分 push 走る軽い懸念 |
| 3. a11y (role/aria, listitem, contrast) | 20 | 14 | tablist に tabpanel が無い / li に role 無し / `tracking 0.18em uppercase` の小さい灰文字でコントラスト不足懸念 |
| 4. エッジケース (空配列, null, mock 状態) | 20 | 14 | mock の `CONNECTED` 混入で live と乖離、`snoozed` UI 未対応、`snippetText null` のとき `lastMessageAt: null` で SLA 判定すり抜ける |
| 5. コード匂い (重複、未使用、命名) | 20 | 17 | sorted の二重 filter / grid-cols 二重宣言 / `requiresReview` と `state==='REPLIED'` の重複 |

**総合スコア: 78 / 100**
**判定: FAIL (90+ 未達)**

> 90+ に乗せるには HIGH 4 件 (型キャスト、`snoozed` 不整合、mock CONNECTED、a11y tab) を全て解消し、MEDIUM の sorted 二重filter / grid-cols 二重宣言を整理する必要あり。

---

## HIGH (リリース前に必ず修正)

### H1. `ThreadFilter = "snoozed"` が UI / SQL に存在しない (整合性破綻)

- 場所:
  - `server/queries/inbox.ts:15` で `ThreadFilter` に `"snoozed"` を含めている
  - `app/(app)/inbox/page.tsx:15` `ALLOWED_FILTERS` も `"snoozed"` を許可
  - 一方 `listInboxThreads` の `stateFilter` 三項では `snoozed` 分岐が無く、結果 `all` と同じ結果が返る
  - `components/inbox/inbox-filter-tabs.tsx:10-15` `TABS` にも `snoozed` 無し
- 影響: ユーザが `?filter=snoozed` でアクセスすると、タブはどれもアクティブにならない (`current="snoozed"` だが該当 tab 無し → `aria-selected` が全 false) なのに件数は all と同じものが返り、SLA セクションも変わらない。URL を共有された時に静かに壊れる種類のバグ。
- 修正案 (どちらか):
  - (a) v1 では実装しないなら `ThreadFilter` から `"snoozed"` を削除 + `ALLOWED_FILTERS` からも削除 (推奨)
  - (b) 実装するなら `leads.snoozedUntil` 列 + `TABS` に追加 + `stateFilter` に分岐追加

### H2. `(msgRows as unknown as { rows?: ... }).rows` の型キャスト

- 場所: `server/queries/inbox.ts:166`
- 問題:
  - drizzle の `db.execute()` の戻り型はドライバ依存 (`postgres` vs `node-postgres` で別物) で、`{ rows: ... }` 形があるかも分からない。`as unknown as { rows?: ... }` は型システムを完全に黙らせており、コメントも 1 行のみ
  - drizzle 公式パターンは `db.select().from(...)` か、`sql<RowType>` でカラム単位の型を明示すること
- 推奨修正:
  ```ts
  // option A: drizzle subquery で型を保ったまま rn = 1 を取る
  const latestMsg = db
    .select({
      leadId: schema.messages.leadId,
      content: schema.messages.content,
      direction: schema.messages.direction,
      sentAt: schema.messages.sentAt,
      rn: sql<number>`row_number() over (partition by ${schema.messages.leadId} order by ${schema.messages.sentAt} desc)`.as('rn'),
    })
    .from(schema.messages)
    .where(inArray(schema.messages.leadId, leadIds))
    .as('latest');
  const msgRows = await db.select({...}).from(latestMsg).where(eq(latestMsg.rn, 1));
  ```
- option B: `db.execute(sql<{ lead_id: string; content: string; direction: 'outbound'|'inbound'; sent_at: string }>...)` で row 型を渡し、`as unknown as` を排除する
- 最低限の妥協: ヘルパ `function extractRows<T>(r: unknown): T[]` を用意し、`as unknown as` を 1 箇所に集約 + ランタイム `Array.isArray` チェックを加える

### H3. Mock が `CONNECTED` を含み live SQL と乖離 (`thread l3 = CONNECTED as LeadState`)

- 場所: `server/queries/inbox.ts:356`
  ```ts
  thread("l3", "鈴木 一郎", "CTO", "Gamma Studio", "CONNECTED" as LeadState, ...)
  ```
- 問題:
  - live クエリは `state IN ('MESSAGED','REPLIED','MEETING','COMPLETED','FAILED')` で `CONNECTED` を除外
  - mock では `mockInbox` がそのまま 8 件返すので `CONNECTED` も入る → DEMO 環境と本番でレコード数・並び・カウントが乖離
  - `as LeadState` のキャストが正当な値であることを隠している
- 推奨修正:
  - `MOCK_THREADS` から `CONNECTED` レコードを削除する (live と同じドメインに揃える)、または
  - mock 側にも `MESSAGED/REPLIED/MEETING/COMPLETED/FAILED` フィルタを適用する
  - `as LeadState` キャストの代わりに、`LeadState` リテラル直書きで型推論させる (`as LeadState` は不要)

### H4. tablist だけあって tabpanel が無い (WAI-ARIA tab pattern 不完全)

- 場所: `components/inbox/inbox-filter-tabs.tsx:54`
- 問題:
  - `role="tablist"` + `role="tab"` を付けているが、対応する `role="tabpanel"` (= `InboxThreadList` を包む要素) と `aria-controls` / `id` 紐付けが無い
  - 結果: スクリーンリーダで「タブ操作」と認識されるが、`Down/Right` 矢印キー (キーボード操作) が動かない (`tabIndex` 制御も無し)
  - 設計書 NN/g WCAG 2.1 4.1.2 に抵触
- 修正案 (簡易):
  - 完全な tab pattern を実装しないなら **role を外して通常のフィルタボタン (`<button>` + `aria-pressed`) に変える** のが最小コスト & 誤解が無い
  - 実装するなら:
    - 各 `<button role="tab" id={`tab-${key}`} aria-controls={`panel-${key}`} tabIndex={active ? 0 : -1} />`
    - 矢印キーハンドラ (`onKeyDown` で left/right)
    - `<section role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`} />` で `InboxThreadList` を包む
- 既存実装は「中途半端な aria」で false-promise になっているので、フィルタボタンへの格下げを推奨

---

## MEDIUM (近日中に修正)

### M1. `sorted` の二重 filter

- 場所: `components/inbox/inbox-thread-list.tsx:26-34`
  ```ts
  const sorted = [...threads].sort(...);
  const slaBreachedItems = sorted.filter((t) => t.slaBreached);
  const normalItems = sorted.filter((t) => !t.slaBreached);
  ```
- 問題: 同じ配列を 2 回走査 + メモリに 2 本のコピー。30 件想定なら無視可だが、`useMemo` も無しで Server Component のレンダ毎に必ず走る。
- 修正:
  ```ts
  const sorted = [...threads].sort(cmp);
  const slaBreachedItems: InboxThread[] = [];
  const normalItems: InboxThread[] = [];
  for (const t of sorted) (t.slaBreached ? slaBreachedItems : normalItems).push(t);
  ```
  もしくは `Array.prototype.reduce` で 1 パス。可読性 vs パフォーマンスのトレードオフ。

### M2. `ThreadRow` の grid-cols が `grid-cols-[...] md:grid-cols-[...]` 完全に同じ値で重複

- 場所: `components/inbox/inbox-thread-list.tsx:118`
  ```tsx
  className="grid grid-cols-[1.5fr_120px_minmax(180px,2.4fr)_120px_24px] md:grid-cols-[1.5fr_120px_minmax(180px,2.4fr)_120px_24px] gap-3 items-center ..."
  ```
- 問題:
  - 同一値 → `md:` 側完全に冗長 (Tailwind は base 値が全 breakpoint に適用される)
  - もし「モバイルでは縦に積みたい」が本来の意図なら、現状は **どの幅でも 5 列固定** で、`<div className="hidden md:flex">` で 2 列消しているだけなので、`grid-cols-[5]` のままモバイルでも 2 列空のグリッドが残る (空のセルが gap 取る)
- 修正:
  - 単純削除なら `className="grid grid-cols-[1.5fr_minmax(180px,2.4fr)_24px] md:grid-cols-[1.5fr_120px_minmax(180px,2.4fr)_120px_24px] ..."` のように **モバイル用には 3 列だけ** にする (`hidden md:flex` のカラムを grid から外す)
  - または「全幅で 5 列のまま」が意図なら md: 側を削除し base のみ残す

### M3. `snippetText: null` の thread は `lastMessageAt: null` になり SLA 判定すり抜ける

- 場所: `server/queries/inbox.ts:425-429` (mock の `thread()`)
  ```ts
  lastMessageAt: snippetText ? lastAt : null,
  ...
  slaBreached, // ago(hoursAgo) ベースで判定済み
  ```
- 問題: `snippetText=null` (= まだメッセージ無し) の場合でも `slaBreached` 自体は `hoursAgo` ベースで計算する。よって mock では「`lastMessageAt: null` だけど `slaBreached: true`」レコードが理論上発生可能で、UI 側 `inbox-thread-list.tsx:174` の `lastMessageAt ? fmtRelative(...) : "—"` と組み合わさり「`—` の隣に SLA 超過 ⚠」という不自然な表示が出る
- 修正: `thread()` 内で `if (!snippetText) slaBreached = false;` で正規化する。または live 側でも同様の整合を取る (live は `lastMsg` 無いケースは `requiresReview` も false なので問題小さい)

### M4. `requiresReview` と `state === "REPLIED"` の二重表現

- 場所: `server/queries/inbox.ts:33, 200, 429` と `inbox-thread-list.tsx:133`
- 問題: `requiresReview = isReplied` は派生プロパティで、`state` から常に導出可能。後で「`REPLIED` だけど対応済み」の概念を入れた瞬間に同期漏れの温床になる。
- 推奨: 名前を `needsReply` に変更し、将来 `is_reviewed` 列で `state === 'REPLIED' && !is_reviewed` にする予定があるならそうする。それまでは UI 側で `thread.state === "REPLIED" && !thread.slaBreached` でいい。

### M5. `searchParams` 操作で `Date.now()` 依存無しだが、debounce タイマー leak リスク

- 場所: `inbox-filter-tabs.tsx:40-50`
- 細部:
  - `q` が一度 set されると `useEffect` が走り 350ms 後に `router.push`。`q` を急速に変えると古い `setTimeout` は `return () => clearTimeout(h)` でクリアされる ✓ ok。
  - ただし **`qFromUrl !== q` で発火する形なので、ユーザがクエリを変えた直後に URL が反映されて `qFromUrl === q` になった瞬間、もう一度 effect が走り「`q === qFromUrl` で return」する**。問題は無いが、`router.push` 後の `qFromUrl` 同期で `useEffect([q, qFromUrl, sp, router])` が全変数変化のたびに走るので、より厳密には:
    ```ts
    React.useEffect(() => {
      if (q === qFromUrl) return;
      const h = setTimeout(() => { ... }, 350);
      return () => clearTimeout(h);
    }, [q]); // sp, router, qFromUrl を依存から外す (router/sp はリファレンス変更で false trigger を引き起こす)
    ```
- Next.js 15 / React 19 では `useSearchParams()` の戻りはレンダ毎に新リファレンスになるので、依存に入れると過剰再実行を呼ぶ。

### M6. a11y - `<ul>` 内 `<li>` の role 設計

- 場所: `inbox-thread-list.tsx:99-108`
- 現状: 通常の `<ul><li>` リスト。row 内に 5 列の構造データ (名前/状態/最新メッセージ/キャンペーン/→) が含まれているが、`role="row"` や columnheader は使っていない。
- 判断:
  - 「**table 風**」に書く必要は無い。LinkedIn / Gmail 受信箱も実装は `<ul><li><a>` で、各行は単一ナビゲーション要素として VoiceOver に渡される
  - ただし現状 `<li>` 直下の `<Link>` (= `<a>`) しか無く、内部に `<h2>` ヘッダ・SLA バッジなど読み上げ順が情報密度高い。`aria-label` を `<Link>` に付けて「山田太郎 · REPLIED · 3 時間前 · 価格と他社比較について…」のように `linkLabel` を組み立てると体験が良くなる
- 修正方針: `<Link aria-label={buildA11yLabel(thread)}>` を追加 (現状の視覚表現はそのまま)。table 化は不要。

### M7. `tracking-[0.18em] uppercase` 小灰文字のコントラスト

- 場所: `inbox-thread-list.tsx:84` (`text-ink-500` + 11px + uppercase)
- 問題: `--color-ink-500` の正確な値次第だが、`uppercase` + `tracking 0.18em` + `font-size 11px` は WCAG 1.4.3 で **AA 4.5:1 を割る可能性が高い** (経験的に ink-500 ≒ #6b7280 系なら白背景 4.4:1 で僅か不足)。
- 推奨: `text-ink-600` 以上に上げる、もしくは `font-weight 700` 維持 + `font-size 12px` 化で large text 扱い (AA は 3:1 で OK)。

---

## LOW (改善余地)

### L1. `MOCK_THREADS` の重複ロジック

- `mockInbox` 内のカウント計算と live 側のカウント計算が同じロジックで 2 箇所書かれている。`computeCounts(threads: InboxThread[])` ヘルパに抽出可能。

### L2. `snippet()` の `…` トリム時の境界

- 場所: `server/queries/inbox.ts:230-234`
- マルチバイト・サロゲートペア・絵文字を 1 文字単位でカウントしているため、絵文字を半端に切る可能性。Intl.Segmenter 化は過剰だが、`Array.from(trimmed).slice(0, max-1).join("")` で safer。

### L3. UUID_RE がエクスポートされているが受信箱内で未使用

- 場所: `server/queries/inbox.ts:236`
- 他ファイルから import されているなら良いが、grep 確認推奨。ここで定義する必然性も薄い (`lib/validation.ts` 等の方が適切)。

### L4. `escapeLikePattern` を Q に対して適用しているが、ILIKE のロケール挙動 (大文字小文字) は ICU 依存

- ja_JP collation で `カナ`/`半角カナ`/`全角英字` の同一視は保証されない。検索体験向上のため `lower(...)` & `lower(safeQ)` で正規化する余地あり。

### L5. `score` をクエリで select しているが UI 上 mock data のフィールドにあるだけで `ThreadRow` 内で未表示

- 1.5fr / 120px / minmax / 120px / 24px の 4 列めはキャンペーン名 + owner で、`score` は表示されない。意図か不要かは設計次第。

### L6. `inbox-filter-tabs.tsx:54` の `tabular font-mono text-[10px]` バッジ:

`text-[10px] + font-bold + uppercase` は前述コントラスト同様 small text 扱いになりやすい。`active` 時は brand-500 背景 + white 文字なのでブランド色のコントラスト保証が必要。

---

## 評価軸別 詳細

### 1. 型安全 (15 / 20)

- `any` は不使用 ✓
- `as unknown as { rows?: ... }` 1 箇所 → H2 で -4
- mock の `"CONNECTED" as LeadState` 1 箇所 → 不要な assertion (-1)
- `db.execute()` 戻りの型を完全に喪失 (H2 と同根)

### 2. React 19 / Next.js 15 (18 / 20)

- `use client` 境界: `inbox-filter-tabs.tsx` のみクライアント化、`inbox-thread-list.tsx` はサーバ ✓
- `searchParams: Promise<...>` を `await` ✓ (Next.js 15 規約)
- `export const dynamic = "force-dynamic"; fetchCache = "force-no-store";` 適切 ✓
- M5 (debounce 依存配列) で -2

### 3. a11y (14 / 20)

- tablist + tab 構造未完成 (-3, H4)
- li 内 link の aria-label 無し (-1, M6)
- contrast 懸念 (-2, M7 / L6)

### 4. エッジケース (14 / 20)

- 空配列 → `EmptyState` ✓
- null lastMessageAt → `—` 表示 ✓ ただし mock で `lastMessageAt=null` + `slaBreached=true` の組合せ可能性 (-1, M3)
- mock CONNECTED 混入で live と乖離 (-3, H3)
- snoozed UI 不整合 (-2, H1)

### 5. コード匂い (17 / 20)

- sorted 二重 filter (-1, M1)
- grid-cols 二重宣言 (-1, M2)
- `requiresReview` / `isReplied` 二重表現 (-1, M4)

---

## 90+ 到達のための最小修正セット

1. **H1**: `ThreadFilter` から `snoozed` 除去 (or 実装)
2. **H2**: `db.execute` の戻り型ガード関数を導入、`as unknown as` 撲滅
3. **H3**: `MOCK_THREADS` から `"CONNECTED"` 削除、`as LeadState` キャスト削除
4. **H4**: `role="tablist"` を撤去し `<button aria-pressed>` 方式に格下げ (実装コスト最小)
5. **M1**: sorted 単一パス分割
6. **M2**: grid-cols の `md:` 側削除 or モバイルレイアウト分岐の整理
7. **M5**: debounce effect の依存配列を `[q]` に狭める

上記 7 件を反映すれば、各軸 +1〜+3 で **総合 92〜94 程度** に到達見込み。

---

## 判定

**FAIL** (78 / 100, 目標 90+ に対し -12)

次回 r2 で上記 HIGH 4 件 + MEDIUM 3 件 (M1/M2/M5) を反映 → 再レビュー推奨。

---

## 参考ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\inbox.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\inbox-filter-tabs.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\inbox-thread-list.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\inbox\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\state-machine.ts` (LeadState ドメイン)
