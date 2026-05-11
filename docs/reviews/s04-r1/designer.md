# S04 キャンペーン一覧 — Designer (UX) Review r1

- 対象: S04 `/campaigns` Phase1 実装
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.11.1
- デザイン基準: Refined Hydro Minimalism (白 + 水色 sky/cyan、Manrope/Geist/Noto Sans JP、Lucide SVG、shadow-popover、border-radius 2xl)
- レビュー観点: ビジュアル / 設計書整合 / インタラクション / a11y・レスポンシブ / 日本語 B2B トーン

---

## 総合スコア: 82 / 100

| 軸 | 配点 | スコア | コメント |
|---|---:|---:|---|
| 1. ビジュアル整合 (デザイントークン / 白+水色 / Manrope / シャドウ) | 20 | 18 | トークン使用は徹底。`font-display` (Manrope) と `tabular font-mono` (Geist Mono) の使い分け良好。CVR を `--color-brand-700` でアクセントしている設計は好感。`hairline` の利用も最小限で清潔。微減点: フィルタバー Pill が `border-[var(--color-ink-200)]` のみで「水色アクセント」がフォーカス時しか出ない (静的状態が灰色に見えがち)。 |
| 2. 設計書 §6.11.1 整合 (フィルタ・テーブル列・一括・空状態・停滞バッジ) | 20 | 15 | フィルタ・状態 chip・行ホバー・一括バー・空状態・「停滞」バッジは実装済み。**未実装**: (a) 並び替え (状態 → 最終アクション降順) のヘッダー UI、(b) 「タグ・期間」フィルタ、(c) 担当アカウント (= LinkedIn アカウント) 列、(d) 「リード」 (= leadsTotal) 列、(e) 「開始」列。 |
| 3. インタラクション (ホバー / フォーカス / Dropdown / Checkbox / debounce / URL 同期) | 20 | 16 | debounce 350ms と URL 同期は機能している。Dropdown は外クリック・Esc 対応あり。Checkbox は `mixed` 状態を ARIA 適切実装。減点: 一括アクションが `alert()` / `confirm()` プレースホルダ、Dropdown 内クイックアクションも `close()` のみで本物の Server Action 未接続 (= サーバー側 `bulkPauseCampaigns` 等が UI から呼ばれない)。 |
| 4. a11y / レスポンシブ (キーボード / aria / モバイル / フォーカストラップ) | 20 | 15 | role/grid/row/aria-label の付与は丁寧。**モバイル致命**: テーブルが `md:` 以下でほぼ全列 hidden、行内に「絶対配置の詳細リンク」が `hidden md:hidden` で常時非表示 → モバイルでは行クリックも詳細遷移もできず "名前だけのリスト" になる。Bulk バーも sm でレイアウト崩れの可能性。Dropdown trigger が `<span role="button">` で `<button>` ではなく、内部に `<button>` を入れているケースで Bulk のフォーカス制御も未実装。 |
| 5. 日本語 B2B トーン (敬体 / 絵文字なし / 文言) | 20 | 18 | 敬体・体言止めの混在は適切、絵文字なし、Manager 権限案内も丁寧。減点: 「ビューの保存は Phase2 で実装予定です」「デモ環境のため実際の更新は行いません」を `alert()` で出している点。設計書 §29 の文言ガイドラインに沿うなら Toast または disabled+tooltip が筋。 |

---

## HIGH（リリース前修正必須）

### H-1: モバイルで行詳細に遷移できない
- **ファイル**: `components/campaigns/campaigns-table.tsx:162-168`
- **問題**:
  ```tsx
  <Link
    href={`/campaigns/${row.id}`}
    aria-label={...}
    className="absolute inset-0 hidden md:hidden"  // 常時非表示
  >
  ```
  `hidden md:hidden` で全ブレークポイントで非表示になっており、モバイル時に行から S06 詳細へ遷移する手段が消失する。さらに親 `<li>` に `relative` 指定がないため、絶対配置で覆う設計自体が機能していない。
- **影響**: モバイル/タブレットの Operator が S06 へ到達不能 → §6.11.1 「行クリック → S06 詳細」破綻、設計書 §18 モバイル要件未達。
- **推奨**:
  - `<li>` に `relative`、リンクは `block md:hidden` (モバイル時は行全体タップ可能なカード化)
  - md+ では名前の `<Link>` でナビゲートする現行方式を維持
  - もしくは行全体を `<Link>` 化し、Checkbox / Dropdown trigger 側で `e.stopPropagation()` する

### H-2: 一括アクションが Server Action に接続されていない
- **ファイル**: `components/campaigns/campaigns-table.tsx:236-243`、`server/actions/campaigns.ts:29-117`
- **問題**: Bulk バーのボタンが `alert()` のみで終了し、せっかく整備した `bulkPauseCampaigns` / `bulkArchiveCampaigns` が呼ばれない。さらに `server/actions/campaigns.ts:64,108` で監査ログ `action` を `"campaign.launched"` に固定しており、`purpose` 文字列でしか pause/archive を区別できず監査困難。
- **影響**: §6.11.1 「選択時 [一括: 一時停止 / アーカイブ]」未達。監査整合性 (§19/§17) にも反する。
- **推奨**:
  - `useTransition` + `formAction` / `startTransition` で Server Action 呼び出し
  - 監査 `action` は `campaign.bulk_paused` / `campaign.bulk_archived` 等 enum を新設
  - 結果は Toast (成功/部分失敗/失敗) で返し、`alert/confirm` を廃止
  - 楽観 UI または `router.refresh()` で再フェッチ

### H-3: 行ホバー時のクイックアクション (一時停止/複製/編集申請/アーカイブ) が機能しない
- **ファイル**: `components/campaigns/campaigns-table.tsx:141-156`
- **問題**: Dropdown 内 `DropdownItem` の `onSelect` がすべて `() => close()` のみ。設計書 §6.11.1 「クイックアクション (ホバー): 一時停止 / 複製 / アーカイブ / 編集申請」が空動作。
- **影響**: Manager が個別キャンペーンを停止/複製できない (= 緊急停止経路が一括のみになり、操作粒度が落ちる)。
- **推奨**: 各アクションを Server Action 化 (`pauseCampaign(id)`, `duplicateCampaign(id)`, `requestEdit(id)`, `archiveCampaign(id)`) し、`status` に応じて項目を出し分け (e.g. `completed` 行で「一時停止」を出さない)。

### H-4: 検索の URL 同期に競合がある
- **ファイル**: `components/campaigns/campaigns-filter-bar.tsx:48-55`
- **問題**: `useEffect` 依存に `q` しか入っていないため、外部 (= 保存ビュー押下や戻る/進む) で `?q=` が変わっても `state q` が同期されない。逆に他フィルタ変更時に `q` が古い state のままで上書きされうる。
- **影響**: 「自分の実行中」など保存ビュー押下後に検索ボックスの表示と URL が乖離。ブラウザの戻るで状態不整合。
- **推奨**:
  ```tsx
  const urlQ = sp.get("q") ?? "";
  React.useEffect(() => { setQ(urlQ); }, [urlQ]);  // URL→state
  React.useEffect(() => {
    const t = setTimeout(() => { if (q !== urlQ) apply({ q }); }, 350);
    return () => clearTimeout(t);
  }, [q, urlQ]);
  ```
  または `useDeferredValue` + `useTransition` 構成へ。

---

## MEDIUM（95+到達のために対応推奨）

### M-1: 設計書記載の列・並び替え UI が欠落
- **ファイル**: `components/campaigns/campaigns-table.tsx:51-69`
- **問題**: §6.11.1 ASCII 図にある「開始 / 担当アカウント (= LinkedIn account) / リード」列、および「並び替え: 状態 → 最終アクション降順」のソートヘッダーが無い。`担当 / 最終` を 1 カラムに圧縮しているが、「担当 (= ユーザー)」と「担当 LinkedIn アカウント」は別物。
- **推奨**: 最低でも以下を追加 (狭い列でよい)
  - 「リード総数」 (`leadsTotal`) を sent/replied の前に
  - ヘッダー `名前 / 状態 / リード / 送信 / 返信 / CVR / 最終` で各列の右端に▼アイコン (Phase1 では sort=name|last_activity だけでも可)
  - 「担当 LinkedIn アカウント」は Phase1 で省略する旨を §6.11.1 とアラインさせて DESIGN diff を別 issue 化

### M-2: 「停滞」バッジが `<Link>` 内にあり tooltip がネイティブ title 依存
- **ファイル**: `components/campaigns/campaigns-table.tsx:93-101`
- **問題**: `title="実行中ですが直近 24h アクションがありません"` のみ。`title` 属性はキーボードフォーカスで表示されず、モバイルでも見えない。バッジ自体も `<Link>` 子要素なのでホバー対象が分かりにくい。
- **推奨**: 設計書 §11.2 / §13 に沿って Tooltip コンポーネント化 (キーボード focus 表示 / モバイル longpress 対応) し、バッジを `<button type="button">` または `<span tabIndex={0}>` で分離する。配色は警告 (`warning-50/700`) でよいが `aria-label` を明示 (`aria-label="停滞: 24時間以上アクションがありません"`)。

### M-3: Dropdown trigger が `<button>` ではなく `<span role="button">`
- **ファイル**: `components/ui/dropdown.tsx:39-54`
- **問題**: trigger が `<span tabIndex={0} role="button">`。内部に `<button>` を入れるケース (Filter bar L116-124、Table row L130-137) があり「button in button」のネスト警告 / クリック判定の二重伝播 / Safari の VoiceOver で trigger ロールが二重に読み上げられる。
- **推奨**: Dropdown trigger をネイティブ `<button>` ベース、または「trigger を `React.cloneElement` で受け取りプロパティ注入」のパターンに変更。フォーカスリングも `focus-visible:outline-[var(--color-brand-500)]` 等で統一。

### M-4: Dropdown の Focus Trap / Arrow Key Navigation 未実装
- **ファイル**: `components/ui/dropdown.tsx`
- **問題**: 開いた瞬間に最初の `menuitem` へ focus しない、↑↓ で項目移動できない、Tab で外に抜けても閉じない。設計書 §13 (WCAG 2.2 AA) の「メニューは矢印キーで操作可能」要件未達。コメントにも "本格的なメニューは shadcn/ui の Radix 版に置換予定" とあり認識済み。
- **推奨**: Phase1 では最低限以下を実装。Phase2 で Radix UI Menu / Headless UI へ置換。
  - `open` 時に `firstItemRef.current?.focus()`
  - `onKeyDown` で ArrowDown/Up/Home/End/Tab を処理
  - 閉じたあと trigger に focus 戻し

### M-5: モバイル時にメトリクス (送信/返信/CVR/最終) が完全に消える
- **ファイル**: `components/campaigns/campaigns-table.tsx:103-125`
- **問題**: モバイルでは Name + Status chip + Owner 名のみ表示で、CVR・送信・最終アクションが全部 `hidden md:block`。Operator がモバイルで状態確認できない。
- **推奨**: モバイル用に 2 行目を残す
  ```
  [Name] [停滞?]
  [Status chip] · 送信 132 · CVR 7.8% · 2時間前
  ```
  もしくはモバイル時はカード型 (情報密度を上げる)。

### M-6: ヘッダーサブタイトルで「状態」コードがそのまま表示
- **ファイル**: `app/(app)/campaigns/page.tsx:63`
- **問題**: `subtitle={`${total} 件のキャンペーン${status ? ` · 状態: ${status}` : ""}`}` で `status` (生の `running` / `safe_mode` 等英字 enum) を表示。日本語 B2B トーンに反する。
- **推奨**: `CAMPAIGN_STATUS_META[status].ja` を使う:
  ```ts
  status ? ` · 状態: ${CAMPAIGN_STATUS_META[status].ja}` : ""
  ```

### M-7: `<input type="hidden" name="total" value={total} />` が `<form>` 外に存在
- **ファイル**: `components/campaigns/campaigns-table.tsx:183`
- **問題**: form の外にある hidden input は意味を持たず、HTML 的にも妥当でない (DOM 上は許容されるが a11y ツリーにノイズ)。
- **推奨**: 不要なら削除。デバッグ用途なら `data-total={total}` を `card-solid` div に付ける。

### M-8: 保存ビュー Dropdown のメニュー位置と幅
- **ファイル**: `components/campaigns/campaigns-filter-bar.tsx:114-150`
- **問題**: `align="end"` で右端揃えだが、フィルタバーが `flex-wrap` なので、狭い画面 (sm) でボタンが左端に来ると、ドロップダウンが画面外にはみ出る。`min-w-[200px]` に対し viewport 360px だと右端から 200px を超えると見切れる。
- **推奨**: `align` をビューポート幅で自動切替、または Floating UI / Popper でコリジョン回避。Phase1 簡易策として `right-0 left-auto sm:left-auto` + `max-w-[calc(100vw-32px)]`。

### M-9: モック判定が「DB 未接続」と表示されるが本番 DB 接続失敗との区別不能
- **ファイル**: `app/(app)/campaigns/page.tsx:67-75`、`server/queries/campaigns.ts:44-47`
- **問題**: `getDb()` が null なら問答無用で `mockCampaigns` 経路へ。本番で接続不能のときも「DEMO サンプル表示」になる可能性。
- **推奨**: `source: "live" | "mock" | "db_unavailable"` の三値化、エラー時は警告 Toast/Banner (`tone="danger"`) を分けて出す。Phase1 でも `process.env.NODE_ENV === "production"` の場合は明示的に 500 を返した方が安全。

### M-10: BulkBar が固定配置で table 下端と重なる / FocusTrap なし
- **ファイル**: `components/campaigns/campaigns-table.tsx:200-221`
- **問題**: `fixed inset-x-0 bottom-6` で常に画面下に貼り付くが、選択中に Tab を押してもバー内ボタンへ自然に flow しない。`role="region"` のみで `aria-live` が無く、選択件数の変化がスクリーンリーダーに伝わらない。
- **推奨**:
  - `<div role="region" aria-label="一括アクション" aria-live="polite">` で件数変化を読み上げ
  - 出現時に `BulkBar` 内最初のボタンへ focus、`Esc` で `onCancel` 呼び出し
  - 下端に `pb-24 md:pb-32` 相当の余白をテーブル直下に確保 (Pagination が隠れないように)

---

## LOW（任意）

- **L-1**: `components/campaigns/campaigns-filter-bar.tsx:75` で Input が `rounded-full` だが `components/ui/input.tsx` のデフォルトは `rounded-xl`。フィルタ専用のため上書きは妥当だが、Select も `rounded-full` なので、コンポーネント API として `shape="pill"` をプロパティ化すると将来の整合が楽。
- **L-2**: `components/ui/select.tsx` は `appearance-none` + 自前 ChevronDown だが、`<select>` の選択肢自体は OS ネイティブ描画。光沢のある macOS Safari の青ハイライトが UI と乖離する。Phase2 で `Listbox` (Headless UI) 置換を検討。
- **L-3**: `app/(app)/campaigns/page.tsx:97` 空状態の「フィルタをクリア」リンクは Server Component から渡しているが、フィルタバーの「フィルタをクリア」テキストリンク (L106-110) と装飾が不揃い (片方は Button、片方はテキスト)。設計書 §29 文言として「フィルタをクリア」で揃えるのは良いが、ビジュアルは一貫させたい。
- **L-4**: `campaign-status-chip.tsx` で `running` のみ `pulse-soft` アニメーション。`safe_mode` (危険) の方が視認性必要なため、`safe_mode` にも軽い脈動 (赤系) を入れた方が「異常検知」体験に合う。
- **L-5**: `lib/campaign-status.ts:24` `safe_mode` の `tone: "danger"` (赤) は妥当だが、設計書 §6.11.1 では SafeMode は「アカウント保護中」の意味合いが強く、運用上は warning 寄り。Brand カラーガイドと突き合わせて再確認。
- **L-6**: `server/queries/campaigns.ts:114` で `anomaly` 判定が `r.status === "running" && (!a?.lastAt || ...)` だが、`startsAt` が未来 (= まだ開始していない running) は除外したい。`running` で `startsAt > now` の場合は anomaly=false に。
- **L-7**: `server/actions/campaigns.ts:64,108` 監査ログの `action` が両方 `"campaign.launched"`。enum 拡張が必要 (`bulk_paused` / `bulk_archived`)。
- **L-8**: 「DEMO」バッジが `role="status"` で `aria-live` 暗黙 polite。良い実装だが、`tabIndex={-1}` でフォーカス不可になっており、スクリーンリーダーで読み上げ後にユーザーが詳細を確認しに行く動線が無い。リンク化を検討。
- **L-9**: `components/ui/pagination.tsx:36` で「`{page} / {totalPages}` ページ」テキストが `<span>` 化されているが、`aria-current="page"` のページ番号入力 (1 ボックスでもよい) があると 100 ページ超えで離れたページに飛びにくい。

---

## 良い点 3 つ

1. **デザイントークン徹底**: `--color-brand-500/600/700`, `--color-ink-50/100/200`, `--shadow-popover`, `--radius-2xl`, `.tabular font-mono`, `.card-solid` を一貫して使用。Tailwind arbitrary 値で `[var(--...)]` を `[color:var(--color-ink-700)]` のように **CSS プロパティとして指定** するパターンが安全で、ダーク化やテーマ切替の将来拡張に強い。
2. **mock/live フォールバックの設計**: `listCampaigns` が `getDb() || !orgId` で `mockCampaigns` に落ちる構造により、DB 未接続環境でも UI 全体が破綻せず動作確認できる。`source: "live" | "mock"` を返り値で運ぶことでクライアントも明示的に "DEMO" バナーを出せる。
3. **空状態の出し分け**: 「フィルタ適用中で 0 件」 vs 「初回利用 0 件」を `q || status || owner` で分岐し、CTA を「フィルタをクリア」と「キャンペーンを作成」で出し分けている。設計書 §6.11.1 の「最初のキャンペーンを 5 ステップで作れます」を文言ごと忠実に再現しており、§12 空状態方針に合致。

---

## 95+ 到達のための残ブロッカー（優先順）

1. **H-1 モバイル詳細遷移の回復** — 設計書 §18 違反、ユーザー到達不能のため最優先
2. **H-2 一括アクションの Server Action 接続 + 監査 action enum 分離** — Phase1 完了条件
3. **H-3 行クイックアクションの実装** — 設計書 §6.11.1 明記の機能
4. **H-4 検索 URL ↔ state 双方向同期の修正** — UX 一貫性
5. **M-1 列構成と並び替えヘッダ** (担当アカウント列・並び替え状態→最終アクション降順) — 設計書整合
6. **M-4 Dropdown の矢印キー/フォーカストラップ** — WCAG 2.2 AA、§13 整合
7. **M-5 モバイルでメトリクス表示の最低限維持** — モバイル運用要件
8. **M-6 サブタイトルの日本語化** — 日本語 B2B トーン違反

上記をすべて解決すれば、ビジュアル 19 / 整合 19 / インタラクション 19 / a11y 19 / トーン 19 = **95** ライン到達想定。M-2/M-3/M-8/M-9/M-10 のうち 2 件追加で **97+** が見える。
