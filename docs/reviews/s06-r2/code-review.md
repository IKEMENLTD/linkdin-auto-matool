# S06 キャンペーン詳細 — 精密コードレビュー (r2)

- **対象**: `app/(app)/campaigns/[id]/page.tsx` + `components/campaigns/detail/*` (5 ファイル) + `components/app/header.tsx` + `server/actions/campaigns.ts` (`singleCampaignAction`) + `server/queries/campaign-detail.ts`
- **基準日**: 2026-05-11
- **レビュアー**: code-review-agent (collaborative mode, r2)
- **判定**: **APPROVED (PASS)** — 総合 **92 / 100** (90+ 達成)

---

## 総合スコア: **92 / 100** (R1: 84 → +8)

| # | 軸 | 配点 | R1 | R2 | 主因 (R2 時点) |
| --- | --- | --- | --- | --- | --- |
| 1 | 型安全 | 20 | 16 | 17 (+1) | `productDocs.message/delivery` の `as MessageStep` / `as Delivery` キャストが残る (M2 未対応)。HitlState ハードコードは 2 箇所残 (M3 未対応)。`STRICT_UUID_RE` 厳密化は +1。 |
| 2 | React 19 / Next.js 15 | 20 | 16 | 19 (+3) | `useActionState` 通知ガードを `state.message` チェック + `reportedRef` 参照ガードに改修 (H2 解消)。`singleCampaignAction` に `revalidatePath` 詳細ページ追加 (LOW 解消)。`new FormData()` 経由再構築は残るが副作用なし (M1 未対応)。 |
| 3 | a11y | 20 | 13 | 19 (+6) | `<Link role="tab" id="tablabel-${key}" aria-controls="tab-${key}" tabIndex>` 完全装着で WAI-ARIA Tabs Pattern 双方向参照成立 (H1 解消)。編集 Phase2 リンクが `<button disabled>` 化、フォーカス不可 (M6 解消)。`Header` の `as="p"` で h1 重複解消。**残: APG 厳密準拠で要求される矢印キーナビは未実装** (-1)。 |
| 4 | エッジケース | 20 | 17 | 18 (+1) | `STRICT_UUID_RE` (RFC4122 v1-5 厳密) + `MOCK_PREFIXES` を `NODE_ENV !== production` 限定にした (H3 解消)。`hasDaily` 判定で空 daily 時の placeholder カード追加 (L2 解消)。`status === "completed"` で右側コンテナが空になる UX 課題は M4 未対応 (-1)。`tab` 不正値で `redirect` ではなく fallback は M5 未対応 (-1)。 |
| 5 | コード匂い | 20 | 18 | 19 (+1) | UUID_RE が `STRICT_UUID_RE` 厳密化で「c で始まる文字列を全て許可」の脆さが解消。HITL ラベル分岐 (`hitlState === "FULL_AUTO" ? …`) は detail-header / tab-settings に依然重複 (M3)。`Intl.DateTimeFormat` インスタンス化は detail-header / tab-settings に 3 箇所 (L1)。 |

> **90+ 判定: PASS (92 / 100)**

---

## R1 → R2 差分サマリ

| R1 指摘 | 対応 | 確認 |
| --- | --- | --- |
| H1 a11y tablist (`id` / `aria-controls` / `tabIndex` 欠落) | DetailTabs に `id="tablabel-${key}"` + `aria-controls="tab-${key}"` + `tabIndex={active ? 0 : -1}` 装着 | **OK** — `detail-tabs.tsx:30-34` 確認、`page.tsx:114` の `aria-labelledby="tablabel-${tab}"` と双方向接続成立 |
| H2 useActionState 通知漏れ (参照等値ガード) | `if (!state.message) return; if (reportedRef.current === state) return;` の二段ガードに改修 | **OK** — `detail-header.tsx:151-158` 確認、`state.message` 存在チェックで `INITIAL_BULK_STATE` (message なし) を弾き、参照ガードで同一 state 二重通知防止 |
| H3 UUID_RE 緩い | `STRICT_UUID_RE` (RFC4122 v1-5: 13文字目が 1-5、17文字目が 8-9/a-b) で厳密化、`MOCK_PREFIXES` を `process.env.NODE_ENV !== "production"` で gate | **OK** — `page.tsx:19-50` 確認、本番環境で `c<script>...` が DB クエリまで到達しない |
| M6 編集 Phase2 リンク (フォーカス取得可) | `<Link href="#" aria-disabled>` → `<button type="button" disabled aria-disabled>` に変更 | **OK** — `tab-settings.tsx:34-43` 確認、ネイティブ `disabled` でフォーカスから自動的に外れる |
| h1 二重 (Header と DetailHeader) | `Header` に `as?: "h1" | "p"` 追加、詳細ページで `as="p"` | **OK** — `header.tsx:8-19` + `page.tsx:91` 確認、ページ内 `h1` は `detail-header.tsx:88` の 1 個のみ |
| LOW revalidatePath 詳細ページ | `singleCampaignAction` 末尾で `revalidatePath('/campaigns/${id}')` | **OK** — `actions/campaigns.ts:177` 確認、status chip / 操作ボタンが即時更新 |
| L2 daily フラット時 placeholder | `hasDaily` 判定でカード表示分岐 | **OK** — `tab-overview.tsx:11,54-81` 確認 (今回 R1 で指摘していないが追加対応されている) |

---

## HIGH (残存 0 件 / 新規 0 件)

### HIGH 残存: なし

R1 で指摘した H1 / H2 / H3 は全て解消済み。

### NEW HIGH: なし

R2 のレビューを通じて新たに浮上した HIGH レベルの問題は検出されなかった。

---

## MEDIUM (未対応 4 件 / 新規 0 件)

> 以下は **APPROVED の障害にならない** が、Phase2 までに片付けることを推奨。

### M1 (継続). `singleCampaignAction` が `new FormData()` で `bulk*Campaigns` に転送

- `server/actions/campaigns.ts:164-174`
- 内部実装関数 `bulkSetStatusImpl(ids: string[], ...)` を抽出すれば二重 zod 検証 + `_prev: undefined` 固定を回避できる。実害なし。

### M2 (継続). `productDocs` の `as` キャスト 2 箇所

- `tab-messages.tsx:22`, `tab-settings.tsx:18-19`
- `lib/wizard-schema.ts` に該当 Zod スキーマがあれば `safeParse` 化が望ましい。型安全 -2pt の主因。

### M3 (継続). HITL ラベル分岐の重複

- `detail-header.tsx:95`, `tab-settings.tsx:53-58`
- `HITL_LABEL: Record<HitlState, string>` を共通 export することで `type HitlState` のハードコード (`campaign-detail.ts:13`, `detail-header.tsx:30` でも文字列共用体重複) もまとめて撤廃可能。

### M4 (継続). `status === "completed"` で右側アクションコンテナが空

- `detail-header.tsx:53-83`
- 「複製」リンク (Phase2 でも可) または `<div>` 自体の条件レンダリングが望ましい。

### M5 (継続). `tab` 不正値で `notFound()` / `redirect` ではなく `overview` fallback

- `page.tsx:52`
- SEO 観点では `redirect(`/campaigns/${id}`)` の方が canonical 統一に資する。

---

## LOW (未対応 4 件)

- **L1**: `Intl.DateTimeFormat` がリクエスト毎にインスタンス化 (`detail-header.tsx:100`, `tab-settings.tsx:64,77`)
- **L3**: `funnel` の `[state, ja]` ラベル配列が `campaign-detail.ts` の live / mock で重複
- **L4**: `tab-messages.tsx:110` の `text.length` が UTF-16 code unit カウント (絵文字を 2 と数える)
- **L5**: `ActionSubmit` に `aria-busy={pending}` 不在 (`detail-header.tsx:188`)

---

## 90+ 判定: **PASS** (92 / 100)

| 判定 | 説明 |
| --- | --- |
| **PASS** | 総合 92/100。R1 で指摘した HIGH 3 件 (H1 a11y tablist / H2 useActionState 通知 / H3 UUID_RE 緩い) は全て期待通り解消。MEDIUM 6 件中 1 件 (M6) を解消。h1 二重と revalidatePath も追加対応。**現状で PR 開始可能**。 |
| NEAR | — |
| FAIL | — |

### マージ可否

- **マージ可** (R2 で 90+ ライン到達)。
- 残存 MEDIUM (M1〜M5) は **Phase2 / 別 PR で順次対応** を推奨。特に M3 (HITL ラベル共通化) は他画面 (一覧 chip 等) と合わせて 1 PR でまとめると効率良い。

---

## ポジティブ評価 (R2 で新たに確認)

- **`STRICT_UUID_RE` の厳密化**: RFC4122 v1-5 まで含めた標準的な書き方で、`zod.string().uuid()` (drizzle 内) と整合性が取れている。
- **`reportedRef` 参照ガード**: `state.message` の存在チェックを先に置いたことで、`INITIAL_BULK_STATE` (`{ok:false, affected:0}`) の初期描画では通知が発火せず、Server Action から返る新規オブジェクトのみが通知される正しい挙動になった。
- **`Header` の `as` prop**: 既存 `Header` を呼び出す他ページ (`/campaigns` 一覧 / `/dashboard` 等) のデフォルト `"h1"` を破壊せず、詳細ページのみ `"p"` に落とす後方互換設計。
- **`tab-overview` の `hasDaily` 判定**: 元 LOW (L2) を任意で先回り対応。live 環境で `buildEmptyDaily()` が常に 0 を返す現状を UI で正しく「集計準備中」と表現。
- **`<button type="button" disabled>` への置換**: `aria-disabled` 単体ではなくネイティブ `disabled` を併用 — フォーカス管理 / Enter キー誤発火 / `pointer-events` 重複設定の 3 リスクを 1 タグで解消。

---

## 関連ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\campaigns\[id]\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-tabs.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\detail-header.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-overview.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-messages.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\campaigns\detail\tab-settings.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\app\header.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\campaigns.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\campaign-detail.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s06-r1\code-review.md`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s06-r2\code-review.md` (本ファイル)
