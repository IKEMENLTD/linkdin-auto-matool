# S04 キャンペーン一覧画面 — 精密コードレビュー (s04-r1)

レビュー対象コミット / レビュー日: 2026-05-11
レビュー対象ファイル:

- `app/(app)/campaigns/page.tsx`
- `components/campaigns/campaigns-table.tsx`
- `components/campaigns/campaigns-filter-bar.tsx`
- `components/campaigns/campaign-status-chip.tsx`
- `components/ui/{checkbox,dropdown,pagination,empty-state,input,select}.tsx`
- `lib/campaign-status.ts`
- `server/queries/campaigns.ts`
- `server/actions/campaigns.ts`

---

## 総合スコア: **72 / 100**

| 評価軸 | 配点 | スコア | 主な減点 |
| --- | --- | --- | --- |
| 1. 型安全 (any/as castなし、Drizzle型) | 20 | 14 | `as unknown as string` キャスト1件、`searchParams.status` のキャストパターン、未使用フィールド `leadsTotal/hitlState/startsAt` の露出 |
| 2. React 19 / Next.js 15 (use client境界、Server Action 戻り型) | 20 | 12 | bulk actions が画面に**全く配線されていない**(alert() のみ)、dead な `<input type="hidden" name="total">`、`exhaustive-deps` disable |
| 3. a11y 詳細 (role/aria/keyboard) | 20 | 12 | Dropdown が **nested interactive 違反** (`role="button"` の中に `<button>`)、`role="rowgroup"` が `role="table"` を欠く、モバイルで詳細遷移リンクが**完全非表示**、columnheader 欠落 |
| 4. エッジケース (空配列、null、フィルタなし、選択ゼロ) | 20 | 17 | `?page=99999` のクランプ無し、保存ビュー選択時に検索ボックスのローカル state が同期されない、Select placeholder 二重選択可能 |
| 5. コード匂い (重複、未使用、命名) | 20 | 17 | anomaly 判定の三重定義、`audit action: "campaign.launched"` の流用、`hidden md:hidden`、`leadsTotal` 未使用 |

> 95+ に到達するには **HIGH 全件解消 + MEDIUM の半数以上対応** が必須。

---

## HIGH (必修正 / PR ブロッカー)

### H1. Bulk Action が Server Action に配線されていない (機能未完成)
- **ファイル**: `components/campaigns/campaigns-table.tsx:236-243`, `server/actions/campaigns.ts` 全体
- **問題**: `BulkButton` の `onClick` が `alert("デモ環境のため実際の更新は行いません")` を呼ぶだけ。 `server/actions/campaigns.ts` に実装された `bulkPauseCampaigns` / `bulkArchiveCampaigns` (Zod 検証・権限チェック・writeAudit・revalidatePath 完備) が **どこからも import されていない**。 S04 の機能要件「一括操作」が UI 上で動かない。
- **推奨**:
  ```tsx
  import { bulkPauseCampaigns, bulkArchiveCampaigns } from "@/server/actions/campaigns";
  // ...
  <form action={async (fd) => {
    const r = await bulkPauseCampaigns(fd);
    if (!r.ok) toast.error(r.message);
    else onCancel();
  }}>
    {ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
    <button type="submit">一時停止</button>
  </form>
  ```
  もしくは `useActionState` (React 19) で `pending` / `error` ハンドリングを追加する。

### H2. `<input type="hidden" name="total" value={total} />` が完全な dead code
- **ファイル**: `components/campaigns/campaigns-table.tsx:183`
- **問題**: 当該 input は **`<form>` の外** にあり、Server Action へ送信されない。 `total` は prop で受け取り済みで、コンポーネント内のどこからも参照されない。 H1 の不完全な Server Action 配線の名残りと推測される。
- **推奨**: 削除する。Bulk Action の form 化が完了したら、`total` ではなく `ids[]` を hidden input に展開する。

### H3. Dropdown が nested interactive 違反 (a11y 重大)
- **ファイル**: `components/ui/dropdown.tsx:39-54`
- **問題**: トリガ要素を `<span role="button" tabIndex={0}>` で包んでいるが、`trigger` prop に渡されるのは `campaigns-table.tsx:130-136` および `campaigns-filter-bar.tsx:117-123` の `<button type="button">`。 結果として **`role="button"` の中に `<button>`** がネスト → WCAG 4.1.2 / HTML 仕様の "interactive content must not contain interactive content" 違反。 スクリーンリーダで二重に "ボタン" と読み上げられ、フォーカス時のキー操作も二重に発火する (Enter で span/button 両方の handler が走る可能性)。
- **推奨**: トリガを「button を受け取る」契約に変えるか、`React.cloneElement` で `aria-haspopup` / `aria-expanded` / `onClick` を子の `<button>` に直接付ける:
  ```tsx
  return (
    <div ref={ref} className="relative inline-block">
      {React.cloneElement(trigger as React.ReactElement, {
        "aria-haspopup": "menu",
        "aria-expanded": open,
        onClick: () => setOpen((v) => !v),
      })}
      {open && (...)}
    </div>
  );
  ```

### H4. モバイルで行詳細リンクが永久に非表示 (機能欠落)
- **ファイル**: `components/campaigns/campaigns-table.tsx:162-168`
- **問題**: `className="absolute inset-0 hidden md:hidden"` — `hidden` (display:none) と `md:hidden` (md以上で display:none) が論理積で **常に非表示**。 さらに親 `<li>` に `position: relative` 指定が無く、もし表示されたとしても `absolute inset-0` は **直近の `relative` 祖先 (=viewport)** を覆ってしまう設計バグ。 モバイルでは行クリックで詳細へ遷移する手段が無く (チェックボックスも `md:grid` で hidden)、ユーザは詳細画面にアクセスできない。
- **推奨**:
  ```tsx
  // li を relative にし、モバイル時のみフルカバーリンクを出す。
  <li className="relative group ...">
    {/* 名前 Link はそのまま */}
    <Link
      href={`/campaigns/${row.id}`}
      aria-label={`${row.name} の詳細`}
      className="md:hidden absolute inset-0"
    />
  </li>
  ```
  もしくはモバイル用の `<Link>` ラッパで `<li>` 全体を包む。

### H5. 監査ログの `action` 値が意味と乖離
- **ファイル**: `server/actions/campaigns.ts:62, 108`
- **問題**: `bulkPauseCampaigns` / `bulkArchiveCampaigns` のどちらも `action: "campaign.launched"` を書き込んでいる。 audit log は append-only で改ざん耐性 (lib/audit.ts) のため、**後から修正できない誤ったアクション値が累積する**。コンプライアンス / SOC 監査時に致命的。
- **推奨**: `lib/audit.ts:6-19` の `AuditAction` union に `"campaign.paused"` / `"campaign.archived"` を追加し、それぞれを使う。 既存 enum は **超過しても DB 型に影響しない (TS 型のみ)** ので非破壊。

### H6. `new Date(a.lastAt as unknown as string)` の不要な二重キャスト
- **ファイル**: `server/queries/campaigns.ts:102`
- **問題**: `sql<Date | null>` で型付け済み、Drizzle + node-postgres は timestamp を `Date` で返す。 `a.lastAt` は既に `Date | null` なのに `as unknown as string` で string にキャストして `new Date()` に渡している。 これは:
  1. CLAUDE.md / コーディング規約の「any/as cast 禁止」違反
  2. `null` チェック後でも runtime には不要 (`a.lastAt` で十分)
- **推奨**:
  ```ts
  lastAt: a.lastAt ?? null,  // すでに Date | null
  ```

---

## MEDIUM (修正推奨)

### M1. `anomaly` 判定が **三重定義** (single source of truth 違反)
- **ファイル**:
  - `server/queries/campaigns.ts:114` (live: `r.status === "running" && (!a?.lastAt || now - a.lastAt.getTime() > DAY)`)
  - `server/queries/campaigns.ts:196` (mock の `mkRow`: `anomaly || (status === "running" && lastActivityAt !== null && Date.now() - new Date(lastActivityAt).getTime() > DAY)`)
  - `server/queries/campaigns.ts:183` (`mkRow` シグネチャ第10引数: 明示渡し)
- **問題**: live と mock で **真理値が異なる**: live は `lastActivityAt === null` でも anomaly=true、mock は `lastActivityAt !== null` を AND 条件にしているため `null` は anomaly=false。 mock の `c4` (`lastActivityAt: null, status: "draft"`) は問題ないが、もし `running` で `null` の行を追加するとライブ実装と挙動が乖離する。
- **推奨**: `lib/campaign-status.ts` に純関数を抽出:
  ```ts
  export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
  export function isCampaignStale(status: CampaignStatus, lastActivityAt: string | null, now = Date.now()): boolean {
    if (status !== "running") return false;
    if (!lastActivityAt) return true;
    return now - new Date(lastActivityAt).getTime() > STALE_THRESHOLD_MS;
  }
  ```
  live/mock 両方から呼び出す。`mkRow` の `anomaly` 引数は削除。

### M2. `role="rowgroup"` / `role="row"` が `role="table"` 無しで孤立
- **ファイル**: `components/campaigns/campaigns-table.tsx:51, 71, 77`
- **問題**: ARIA grid roles は **必ず table/grid をルートに持つ** ことが要件 (WAI-ARIA 1.2)。 現在 outermost `<div className="card-solid">` には role が無く、ヘッダ行の各セルも `role="columnheader"` 無しの裸 `<div>`。 スクリーンリーダはこの構造を「グリッド」として解釈できず、結果として ARIA を付けない方が読み上げ品質が上がる状態。
- **推奨**:
  ```tsx
  <div role="table" aria-label="キャンペーン一覧" aria-rowcount={total}>
    <div role="row">
      <div role="columnheader">...</div>
    </div>
    <ul role="rowgroup">
      <li role="row" aria-rowindex={idx + 2}>
        <div role="gridcell">...</div>
      </li>
    </ul>
  </div>
  ```
  もしくは ARIA を全て外して semantic `<table>` に書き直す方が安全。

### M3. `?page=99999` などレンジ外を server 側でクランプしていない
- **ファイル**: `app/(app)/campaigns/page.tsx:37`
- **問題**: `Math.max(1, Number(sp.page) || 1)` は下限のみ。 `total=10, perPage=25` で `?page=999` を渡すと `Pagination` は `from=24951, to=10, "24951–10 / 10 件"` と表示する。 また `db.offset((page-1)*perPage)` で大きな offset を投げる → DB に無駄な負荷。
- **推奨**:
  ```ts
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const effectivePage = Math.min(totalPages, Math.max(1, Number(sp.page) || 1));
  ```
  ただし `total` を取得するには SQL を発行する必要があるため、クエリ後に redirect する設計 (`page > totalPages` なら最終ページへ 302) が綺麗。

### M4. 保存ビュー選択時に検索ボックス state が同期されない
- **ファイル**: `components/campaigns/campaigns-filter-bar.tsx:32, 48-55`
- **問題**: `const [q, setQ] = React.useState(sp.get("q") ?? "")` は初回マウント時のみ初期化。 「実行中のみ」ビューを選ぶと URL から `q` が消えるが、ローカル state `q` は残る → debounce effect が `apply({ q: q || "" })` を 350ms 後に発火し、**先ほど消した検索ワードが復活する**。
- **推奨**: `sp.get("q")` の変化を監視して同期:
  ```ts
  React.useEffect(() => {
    const url = sp.get("q") ?? "";
    setQ(url);
  }, [sp]);
  ```
  またはこの state を `useSearchParams` 一本に統一する (debounce は別途 ref で管理)。

### M5. `<input type="hidden" name="total">` がもし将来 form に取り込まれた場合の改ざんリスク
- **ファイル**: `components/campaigns/campaigns-table.tsx:183`
- **問題**: H2 で削除推奨だが、もし「total を server に渡すため」の意図があったなら、**クライアント由来の total を信頼する** こと自体が脆弱性。 件数は server query で再計算すべき。
- **推奨**: 削除一択。Bulk Action の payload は `ids[]` のみで十分。

### M6. `mkRow` 内 `leadsTotal: Math.round(sent * 1.4)` の魔数 / 未使用フィールド
- **ファイル**: `server/queries/campaigns.ts:191, lib/queries 型`
- **問題**: `CampaignListItem.leadsTotal` は型に存在するが、`campaigns-table.tsx` のどこからも参照されない。 mock では `sent * 1.4` という根拠不明な係数で生成、live では aggregate `total` を使用するため、UI が表示し始めた時に **mock のダミー値で UX QA が騙される** 可能性。
- **推奨**: 型から削除するか、テーブルに「総リード数」列を追加して表示する。同様に `hitlState` / `startsAt` も未使用 (`hitlState` は SAVED_VIEW の `hitl=REVIEW_REQUIRED` フィルタで言及されるのみ)。

### M7. Checkbox button が `...rest` のスプレッドで内部 `onClick` を上書きされ得る
- **ファイル**: `components/ui/checkbox.tsx:19-36`
- **問題**: JSX のプロパティ順序は **後勝ち** で、`onClick={(e) => ...}` の後に `{...rest}` が来ているため、呼出側が誤って `onClick` を渡すと内部のトグルロジックが無効化される。 現状の呼出箇所 (`campaigns-table.tsx:56-60, 81-85`) では渡していないので実害無し、ただし API 契約として危険。
- **推奨**: `...rest` を先にスプレッドし、内部 handler を後に書く:
  ```tsx
  <button {...rest} ref={ref} type="button" role="checkbox" onClick={...}>
  ```
  または `Omit<..., "onClick">` で型レベルで禁止する。

### M8. `ilike` の wildcard エスケープ漏れ
- **ファイル**: `server/queries/campaigns.ts:52`
- **問題**: `ilike(schema.campaigns.name, '%${q.trim()}%')` — Drizzle のパラメタライズで SQL injection は防げるが、ユーザが `_` や `%` を入力すると **意図せず wildcard マッチ** になる。 「a_b」と入力した場合「a任意1文字b」にヒットする。
- **推奨**:
  ```ts
  const escaped = q.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  ilike(schema.campaigns.name, `%${escaped}%`)
  ```

---

## LOW (将来改善 / nitpick)

### L1. `hrefFor(p)` が `page=1` を省く設計の一貫性
- **ファイル**: `app/(app)/campaigns/page.tsx:50-57`
- **コメント**: 「`page=1` を canonical URL とみなし param を省く」 設計は正しい (SEO / 共有時の URL 短縮)。`Pagination` 側でも prev=Math.max(1, page-1) なので page=2 から「前へ」を押すと `/campaigns` に戻る ── これは意図通り。 ただし `apply({})` で他のフィルタ変更時にも `page` を `delete` しているので、フィルタ変更 → 1 ページ目復帰の挙動と合っており一貫性 OK。 **このセクションは "問題なし" と判定**。`hrefFor` を逆に「常に page を出す」設計に変えるべきではない。

### L2. `Select` の placeholder option が再選択可能
- **ファイル**: `components/ui/select.tsx:33-37`
- **問題**: `disabled={value !== ""}` で「値が選択済みなら placeholder を disabled」── しかし初期 `value === ""` のときは disabled にならないため、ユーザが他のオプション選択 → 再度 placeholder にカーソル戻し → "" 値が select される。 これは "クリアしたい" ユースケースには合うが、placeholder 文字列を **値として送信** することになる。 現状は label="すべての状態" を使っているので副作用なし、ただし将来 placeholder と「全件」を分けたい場合に困る。

### L3. `CampaignStatusChip` の `aria-label={meta.ja}` 重複
- **ファイル**: `components/campaigns/campaign-status-chip.tsx:9-14`
- **問題**: `<Badge aria-label="実行中">` の中に `{meta.ja}` テキストノードがあるため、スクリーンリーダで「実行中、実行中」と二重発話される (aria-label が visible text を上書き)。
- **推奨**: `aria-label` を外し、Icon に `aria-hidden` (済) のみ。または逆に visible text を `<span aria-hidden>` で隠して aria-label に詳細 (`実行中、自動配信中`) を入れる。

### L4. `as const` の冗長
- **ファイル**: `app/(app)/campaigns/page.tsx:34`
- **問題**: `("" as const)` は既にリテラル `""` として推論される。`as const` 不要。
- **推奨**: 三項演算子の else 側を素のリテラル `""` にする。

### L5. `useEffect` の `eslint-disable react-hooks/exhaustive-deps`
- **ファイル**: `components/campaigns/campaigns-filter-bar.tsx:54`
- **コメント**: `sp` と `apply` を deps に含めると debounce が毎レンダリングで rearm する問題があるため意図的に外している、と読める。 ただし M4 で指摘した同期問題が発生する。 `apply` を `useCallback` 化し、`sp.get("q")` を ref に保持するなどで disable せずに書ける。

### L6. `mockCampaigns` の owner フィルタが `ownerName === "田中 健司"` ハードコード
- **ファイル**: `server/queries/campaigns.ts:162`
- **問題**: live では `ownerUserId === session.userId` だが mock では「田中 健司」固定。 demo 環境としては許容範囲だが、コメントで明示するか `MOCK_CURRENT_USER` 定数を切り出すと意図が伝わる。

### L7. `<a>` 要素 (Link) 内の AlertTriangle 警告バッジが accessible name に混入
- **ファイル**: `components/campaigns/campaigns-table.tsx:93-101`
- **問題**: `Link` の accessible name は子孫テキスト合算なので「Series B SaaS · VPoE 開拓 停滞」と読み上げられる。 ユーザは "停滞" がリンクのラベルなのかバッジなのか混乱する。
- **推奨**: 警告 `<span>` に `role="img" aria-label="停滞中"` を付け、内部の `"停滞"` テキストは `aria-hidden`。 もしくはバッジを `<Link>` の **外** に出す。

### L8. `Dropdown` の focus trap が未実装
- **ファイル**: `components/ui/dropdown.tsx` 全体 (コメントに「基本対応」とある)
- **問題**: メニュー open 中に Tab で外に出られる。ArrowDown/Up での項目移動も未実装。 コメントで shadcn 置換予定と明記されているので **既知の負債**。

---

## 良い点 (3 つ)

1. **Server Query の Drizzle 合成が綺麗** — `server/queries/campaigns.ts:49-54` で `conditions: SQL[]` を push してから `and(...conditions)` する pattern は、条件分岐を残さず型安全 & SQL injection 耐性を確保している。 `Promise.all([rows, totalRow])` の並列化、`inArray` で集計 IN 句、左ジョインで owner 名取得まで **教科書的に正しい**。
2. **DB 未接続時の graceful fallback** — `getDb()` / `orgId` の null チェックで mock 経路に切替える設計が、page.tsx → query → UI に **`source: "live" | "mock"`** を伝搬し、DEMO バッジ表示 (`page.tsx:67-75`) で UX 側に明示している。 開発体験 / デモ環境運用がスムーズ。
3. **Server Action のセキュリティ多層防御** — `server/actions/campaigns.ts` で Zod 検証 (uuid + size limit) → `requireManagerSession()` (auth+role) → `orgId` スコープ条件 → `writeAudit` (改ざん耐性ログ) → `revalidatePath` まで **5 段** で固めている。 UI 配線さえ繋げばそのまま本番運用に耐える。 H1/H5 を直せば S04 のセキュリティ要件は満たす。

---

## 95+ 到達のための残ブロッカー

| 優先 | ID | タスク | 推定 |
| --- | --- | --- | --- |
| P0 | H1 | Bulk Action を `<form action={bulkPauseCampaigns}>` で配線、`useActionState` で toast 表示 | 1.5h |
| P0 | H2 | dead な hidden input `total` を削除 | 5min |
| P0 | H3 | Dropdown trigger を `cloneElement` で書き換え、`<span role=button>` を除去 | 30min |
| P0 | H4 | モバイル行カバーリンクを実装 (`li.relative` + `md:hidden absolute inset-0`)、`hidden md:hidden` の typo 修正 | 20min |
| P0 | H5 | `AuditAction` union に `campaign.paused` / `campaign.archived` 追加、Actions 側を切替 | 15min |
| P0 | H6 | `new Date(a.lastAt as unknown as string)` を撤去 | 5min |
| P1 | M1 | `isCampaignStale()` 純関数を `lib/campaign-status.ts` に抽出、live/mock 両方から呼出 | 30min |
| P1 | M2 | `role="table"` をルートに付与、ヘッダ `<div>` を `role="columnheader"` に、`aria-rowcount/index` 整備 | 45min |
| P1 | M3 | page クランプ: total 取得後に `page > totalPages` なら最終ページへ redirect | 20min |
| P1 | M4 | filter-bar の `q` state を URL と同期 (useEffect で `sp.get("q")` watch) | 15min |
| P2 | M7,M8,L3,L7 | a11y / 型契約の磨き上げ | 1h |

**合計**: P0 (HIGH 全件) **約 3h** で 85+/100、P1 完了で **95+/100** 到達見込み。

機能要件 (S04 = キャンペーン一覧 + 一括操作 + フィルタ + ページネーション) のうち、**フィルタ/ページネーション/一覧表示は live/mock 共に動作**。 ただし **「一括操作」は UI クリックで Server Action に到達しない** ため、S04 として "完成" を宣言できる状態ではない。 これは「シミュレーションファースト検証」の観点 (memory: `feedback_simulation_first.md`) で言うところの「レビュー高得点 ≠ 実装完成」の典型例 ── 必ず実機で「行をチェック → 一時停止ボタンクリック → DB の status が paused になる → audit log に書込まれる」までを通すこと。
