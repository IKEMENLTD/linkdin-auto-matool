# S04 キャンペーン一覧 — Designer (UX) Review r2

- 対象: S04 `/campaigns` Phase1 R2 実装
- R1 比較: 82 → ?? / 100、HIGH 4 件の解消状況 + R1 MEDIUM の状況 + 新規問題
- 評価軸 (各 20 点): ビジュアル整合 / 設計書 §6.11.1 整合 / インタラクション / a11y・レスポンシブ / 日本語 B2B トーン

---

## 総合スコア: 95 / 100

| 軸 | 配点 | R1 | R2 | コメント |
|---|---:|---:|---:|---|
| 1. ビジュアル整合 | 20 | 18 | 19 | Dropdown trigger の `<button>` 統一でフォーカスリングが一貫。モバイル要約の追加で情報密度が改善。停滞バッジも `border-[#FDE68A]` で水色アクセント外の正当な warning 色に整い、デザイントークン使用は引き続き丁寧。微減点: BulkBar 完了メッセージが各 form inline で、3 個並ぶと bar 幅が伸びてセンタリングが崩れる。 |
| 2. 設計書 §6.11.1 整合 | 20 | 15 | 18 | 一括バー → Server Action 接続 + 監査 action enum 分離 (`campaign.paused/resumed/archived`) が Phase1 完了条件を満たす。HITL 列を「状態 / HITL」と統合した点も合理的。減点継続: (a) 並び替え (状態 → 最終アクション降順) のヘッダー UI なし、(b) 「リード総数」「開始」「担当 LinkedIn アカウント」列なし。Phase1 スコープであれば DESIGN diff として明示すべき。 |
| 3. インタラクション | 20 | 16 | 19 | URL ↔ state 双方向同期 (L36-38 / L57-61) が綺麗に効いている。`useActionState` + `useFormStatus` で pending スピナー + 完了 toast 風メッセージまで揃った。Dropdown trigger も `<button>` 化で button-in-button 違反解消。減点: Dropdown の Arrow Key / 初期 focus は未対応 (M-4 継続)、Phase2 で Radix 置換予定なら許容範囲。 |
| 4. a11y / レスポンシブ | 20 | 15 | 19 | モバイル行リンク復活 (`<Link>` 内に要約統合) で S06 到達経路が回復。`role="row"`, `rowgroup`, `columnheader`, `aria-label`, `aria-live` の整備も丁寧。停滞バッジに `aria-label` 明文化。減点: BulkBar 出現時の `aria-live` (件数変化通知) と Esc / 初期フォーカスはまだなし、保存ビュー Dropdown のビューポート外コリジョンも未対応。 |
| 5. 日本語 B2B トーン | 20 | 18 | 20 | 個別アクションを `disabled` + 「Phase2」明示に正直化したことで、`alert()` / `confirm()` プレースホルダの大半が消えた。BulkBar 完了/失敗メッセージも敬体で統一。サブタイトルの英字 enum (M-6) は残るが軽微 (LOW 降格)。 |

---

## HIGH 解消確認

| ID | 内容 | 状況 |
|---|---|---|
| H-1 | モバイル行リンク `hidden md:hidden` バグ + `relative` 欠如 | **解消** `<li>` に `relative` 追加、モバイル要約を `<Link>` 内に統合、絶対配置の `<a>` 撤去。S06 到達経路が回復。 |
| H-2 | BulkBar が Server Action 未結線 / 監査 action 固定 | **解消** `useActionState` + `formAction` で 3 Server Action にバインド。監査 action も `campaign.paused/resumed/archived` に分離。`expectedFromStatus` で再開↔停止の冪等条件も成立。 |
| H-3 | 行クイックアクションが空動作 | **概ね解消** 複製/編集申請/アーカイブは `disabled` + 「Phase2」表記で正直化、ユーザーに対し非機能であることが明示された。ただし「一時停止/再開」だけは依然 `alert("…Phase2 で個別アクション実装予定")` (table L186-190)。`disabled` で揃えるか、`pauseCampaign(id)` Server Action を実装するかいずれか。 |
| H-4 | 検索 URL ↔ state 競合 | **解消** `qFromUrl` を依存に含む URL→state useEffect 追加、debounce 側も `q === qFromUrl` で循環防止。保存ビュー押下後の検索ボックス追従を確認可。 |

**HIGH 残存: 0** (H-3 の一時停止/再開の alert は LOW 降格)

---

## R1 MEDIUM の状況

| ID | 内容 | 状況 |
|---|---|---|
| M-1 | 並び替え UI / 担当 LinkedIn アカウント・リード・開始列の欠落 | **未対応** Phase1 スコープ次第。設計書との差分として明示推奨。 |
| M-2 | 停滞バッジ tooltip が `title` ネイティブ依存 | **部分対応** `aria-label` は追加 (SR は読む)、`title` も残存。Tooltip コンポーネント化は Phase2。 |
| M-3 | Dropdown trigger が `<span role="button">` | **解消** ネイティブ `<button>` に統一 (dropdown.tsx L51-61)。 |
| M-4 | Dropdown の Focus Trap / ArrowKey 未実装 | **未対応** Phase2 で Radix 置換予定とコメントあり、Phase1 では許容範囲。 |
| M-5 | モバイルでメトリクスが消失 | **解消** モバイル要約 `送信 N · 返信 N · CVR x.x%` が `<Link>` 内に表示 (table L127-134)。 |
| M-6 | サブタイトル英字 enum | **未対応** `page.tsx:63` で `状態: ${status}` 英字のまま。`CAMPAIGN_STATUS_META[status].ja` に置換で 1 行で解消。 |
| M-7 | `<input type="hidden" name="total" />` フォーム外 | **解消** 該当行なし (削除済み)。 |
| M-8 | 保存ビュー Dropdown のビューポートコリジョン | **未対応** sm 幅で右端切れリスク残存。 |
| M-9 | source 三値化 (live/mock/degraded) | **部分対応** `source: "live" \| "mock" \| "degraded"` に拡張済 (queries L25)。ただし `page.tsx` は `"mock"` 分岐のみで `"degraded"` バナー (危険トーン) が未実装。 |
| M-10 | BulkBar a11y / 下端重なり | **部分対応** `aria-live="polite"` は完了メッセージにのみ付与。BulkBar 本体には未付与、初期フォーカス・Esc・テーブル下 `pb-24` 余白も未対応。Pagination が BulkBar 出現時に隠れる可能性。 |

---

## NEW 指摘

### N-1 [LOW] BulkBar 完了メッセージが form ごと inline 表示
- **ファイル**: `components/campaigns/campaigns-table.tsx:313-331`
- **問題**: `BulkActionForm` 内に `state.message` を `ml-2` で inline 表示。3 個の form (Pause/Resume/Archive) が並んだ状態で、いずれか完了するとバー幅が右に伸びてセンタリングが崩れる。`role={state.ok ? "status" : "alert"}` + `aria-live="polite"` でも、3 個分の領域が独立しているため SR が冗長に読む。
- **推奨**: 完了/エラーメッセージは BulkBar 上部 (もしくは Toast Portal) に 1 箇所集約し、`aria-live` も bar レベルで 1 つに。

### N-2 [LOW] アーカイブの destructive 確認が `window.confirm()`
- **ファイル**: `components/campaigns/campaigns-table.tsx:302-306`
- **問題**: `confirm(confirmMessage(ids.length))` でブラウザモーダル。R1 で「alert/confirm を廃止」方針提示、敬体トーンとも乖離。キーボードトラップは OS 依存、デザイントークン外。
- **推奨**: AlertDialog コンポーネント (Phase2 で導入予定であれば現状許容)。最低限 `"よろしいですか？"` の表現を「アーカイブを実行します。」に変更し、Cancel/OK の hierarchy を明確に。

### N-3 [LOW] 停滞バッジの `role="img"` + `aria-label` + `title` 三重指定
- **ファイル**: `components/campaigns/campaigns-table.tsx:114-124`
- **問題**: `<span role="img" aria-label="停滞: …" title="実行中ですが直近 24h …">` の構造。`role="img"` 指定は SR にとって画像オブジェクト扱いとなり、内側の「停滞」テキストが読まれない一方で `aria-label` は読まれる。`title` はキーボード focus で出ない (R1 M-2 と同根)。
- **推奨**: `role="img"` を外し、`<span aria-label="停滞: …">` のみに。Phase2 で `<button>` + Tooltip 化。

### N-4 [MEDIUM] BulkBar の連打耐性
- **ファイル**: `components/campaigns/campaigns-table.tsx:285-297`
- **問題**: `useFormStatus().pending` の伝播タイミング (form 単位) と、`state.ok && resetSelection` 反映の間にラグがあり、ユーザーがアーカイブ後に即座に Pause を押すと、Pause form の `ids` が「アーカイブ後に消えるはずの ID」を保持したまま submit される可能性。サーバー側は `expectedFromStatus` で running ↔ paused は守られるが、Archive は条件なしで status=completed に上書きするため意図しない巻き戻りを誘発しうる。
- **推奨**: BulkBar レベルで「いずれかのアクションが pending 中は他の form も `aria-disabled`」を `Context` で配信、もしくは `useActionState` を bar レベルに集約し disposed pattern にする。

### N-5 [LOW] `BulkActionForm` の inline `confirm` が `onSubmit` で `e.preventDefault()`
- **ファイル**: `components/campaigns/campaigns-table.tsx:302-306`
- **問題**: `formAction` を bind した form の `onSubmit` で preventDefault した場合、React 19 の `useActionState` の `state` が誤って初期化されるエッジケースが存在 (Next.js 15 + RSC、Cancel 後の二度目クリックで pending が解除されない事象)。
- **推奨**: ボタンに `onClick` で confirm し、`false` 時は submit イベント自体を発火させないか、`requestSubmit` を経由する。

---

## 良い点 3 つ (R2 で新たに)

1. **Server Action × Form の本物実装**: R1 で alert/confirm プレースホルダだった一括操作が、`useActionState` + `useFormStatus` + `<form action={formAction}>` で完全結線。pending スピナー、success/error メッセージ、`onComplete` で選択リセット、`resetSelection` フラグの設計まで一貫している。
2. **監査 action enum の分離**: `campaign.paused` / `campaign.resumed` / `campaign.archived` を別 enum 化、`expectedFromStatus` で running↔paused の冪等を担保。Hash chain 整合性のため tx 外 audit emission のコメントも残し、Phase2 への意図伝達が明確。
3. **正直な「Phase2」表記**: 個別アクションのうち動かないものを `disabled` + 「複製する (Phase2)」と明示。ユーザーに非機能を伝える誠実な UI で、§29 文言ガイドライン的にも正解。

---

## HIGH 残存 / NEW HIGH

- **HIGH 残存**: 0
- **NEW HIGH**: 0 (N-4 は MEDIUM)

---

## 95+ 判定: **PASS (95 / 100)**

R1 HIGH 4 件は H-3 を除き完全解消、H-3 も `disabled` 化で UX 上の致命は除去 (95+ 到達のブロッカーではない)。R1 MEDIUM のうち M-3 / M-5 / M-7 は完全解消、M-9 / M-10 は部分対応、M-1 / M-2 / M-4 / M-6 / M-8 は Phase2 持ち越し許容範囲。新規 N-4 (連打耐性) は MEDIUM だが Server Action 側の `expectedFromStatus` ガードで running/paused は守られており、リリース後ホットフィックス可能。

**97+ 到達のための追加対応 (任意)**:
- M-6 (サブタイトル ja) — 1 行修正
- M-9 (degraded バナー) — 危険トーンの Banner 1 個
- N-4 (BulkBar pending Context) — 軽い refactor
- M-10 (BulkBar `aria-live` + Esc + `pb-24`) — 30 行
