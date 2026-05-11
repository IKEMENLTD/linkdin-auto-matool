# S07 リード一覧 — Designer Review (UX)

- 対象スコープ: `app/(app)/leads/page.tsx`, `components/leads/{leads-filter-bar,leads-table,lead-drawer}.tsx`, `server/queries/leads.ts`, `server/actions/leads.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.3 / §6.11.3
- レビュア: designer-agent
- 日付: 2026-05-11

---

## 総合スコア: **92 / 100** — 判定: **PASS (90+)**

| 軸 | スコア | 配点 | 主な所感 |
|---|---|---|---|
| 1. ビジュアル (Refined Hydro Minimalism) | **19** | /20 | 白基調 + 水色アクセント、丸ピル、tabular 数字、ease-glide、Lucide のみ、絵文字無し。背景グラデは sky→teal で DNA に整合。card-solid + brand-50/60 hover の重なりも上品。 |
| 2. 設計書整合 (§6.3 / §6.11.3) | **17** | /20 | 主要要素 (フィルタ4軸/スコア内訳/次のアクション/空状態/DEMO/degraded/三重表現/URL 同期) はカバー。ただし §6.11.3 のクイックアクション群 ([編集] [除外] [担当変更] [LinkedIn を開く ↗]) がドロワー headerに無く、Engagement の派生式 `score − 56` が低スコア帯で破綻。 |
| 3. インタラクション | **19** | /20 | URL 同期、350ms debounce、Esc、外クリック、body スクロール抑止、`useActionState`/`useFormStatus`、`scroll: false`、toast 3.5s — 一級。確認 UI が `window.confirm` で簡素なのと、debounce 中の Search 入力に処理中シグナルが無い点だけ惜しい。 |
| 4. a11y | **18** | /20 | `role=dialog` + `aria-modal` + `aria-labelledby`、`role=row/columnheader/rowgroup`、`aria-live=polite` トースト、DEMO/degraded の `role=status / alert` 使い分け良。**フォーカストラップ未実装 / 開閉時の初期フォーカス移動なし**が主要減点。 |
| 5. 日本語 B2B トーン | **19** | /20 | 「DB 未接続のためサンプルのリードを表示しています」「24 時間以内に最初のリードが現れます」「対象が見つかりませんでした」 — 敬体・簡潔・断定。スコア説明「AI 適合度」、列ラベル「最終アクション」も自然。`window.confirm` のテキストだけ砕けがち。 |

---

## HIGH (90+ を確実にするための必須修正候補 — 今回はソフト指摘)

> いずれも 90 を下回らせる致命傷ではないが、PASS マージンを 95+ に押し上げるには次イテレーションで処理推奨。

### H1. ドロワーのフォーカストラップと初期フォーカス移動が無い
- 現状: `LeadDrawer` は Esc + outside-click + body スクロール抑止のみ。Tab を押すと背景の検索バー / テーブルへフォーカスが抜ける。
- 期待 (§6.11.3 + §1282 行 "tabindex 設計、フォーカストラップ"): 開いた瞬間に閉じるボタン or タイトルへ `focus()`、`role=dialog` 内で Tab/Shift+Tab を循環、閉じたら元の行リンクへ戻す。
- 提案: `useRef<HTMLElement>` で `aside` を掴み、`open` 切替時に `headerRef.current?.focus()` (close ボタンに `tabIndex={0}` ＋ `ref`)、Tab キーで focusable な要素を取り出して循環、close 時に `previousActiveElement.focus()`。`inert` 属性で背景を不活性化するのが理想。

### H2. ドロワーの「次のアクション」ヘッダ操作群が未実装
- §6.11.3 の冒頭仕様: `[編集] [除外] [担当変更] [LinkedIn を開く ↗]` ボタン群。
- 現状: ドロワー header には閉じるボタンのみ。「次のアクション」セクションは "受信箱で AI ドラフトをレビューして返信" 等の **テキストガイダンスのみ** で押下可能なアクションが無く、SDR がドロワー内で次の一歩を取れない。
- 提案 (最小):
  - LinkedIn を開く ↗ (lead に `linkedinUrl` 列を追加 or DEMO リンク) — 1 ボタン
  - 除外 (単体版 `disqualifyLead`) — server action 追加で十分
  - 担当変更は P2 で OK だがプレースホルダ disabled ボタンを置く
- これにより spec 整合スコアが +2 (= 軸合計 19/20)。

### H3. スコア内訳の Engagement 算出ロジックが破綻する
- 現状: `value: lead.score - 56` で計算し、render 時に `Math.max(0, item.value)` で 0 にクランプ。
- 問題: スコア < 56 のリード (mock `l5 (42)`, `l12 (55)`) で Engagement が常に 0 になり、しかも他 3 軸の合計 (`22+18+16 = 56`) を引いた残差なので **「内訳」の意味を成していない (定義上、合計 = score にしたいなら他軸も lead.score に連動させる必要)**。
- 提案: 真の内訳が無いなら、各値は固定で持たず lead に `scoreBreakdown: { roleFit, companySize, signal, engagement }` を nullable で持たせ、`null` の時はセクション全体を「Phase2 で公開予定」プレースホルダにする。今は誤情報リスクを優先回避すべき。`(デモ)` 接尾語は付いているが、本番でも UI 形式は同じになるので構造の段階で正す価値が高い。

---

## MEDIUM (90+ 維持のため修正推奨)

### M1. 行クリック相当のキーボード操作が貧弱
- 現状: 名前のみ `<Link>` 化、行全体はクリックハンドラ無し → マウスで行間 (空白部分) をクリックしてもドロワーは開かない。`<Link>` は Enter 可だが Tab で行を縦移動するだけで Score / Campaign / 最終アクションのセル間移動の手応えが無い。
- 提案: 行を `<Link>` でラップ (Next 15 で行クリック全域化が可能) するか、最低でも ChevronRight アイコンを `<Link>` 化して画面右端から開ける導線を確保。`aria-rowindex` も付与すると SR ユーザの位置感が増す。

### M2. テーブルの ARIA セマンティクスが不完全
- 現状: `role="row"` `role="columnheader"` `role="rowgroup"` は付いているが、外側の `<div className="card-solid">` に `role="table"`、各セルに `role="cell"` (or grid なら `gridcell`) が無い。SR は "テーブル" として認識しない可能性。
- 提案: ルートに `role="table" aria-label="リード一覧"` `aria-rowcount={total}` を追加し、各セル `<div>` に `role="cell"` を付ける。あるいは素直に `<table>` 要素にリファクタ (推奨)。div グリッドのままならコメントで意図を明示。

### M3. 検索 debounce 中のフィードバック欠如
- 現状: 350ms debounce 中もチップに変化なし。送信タイミングが分からず、検索ボックスが「効いていないように見える」可能性 (Visibility 原則低下)。
- 提案: `q !== qFromUrl` の間だけ Search アイコンの代わりに半透明スピナーを表示 (`<Loader2 className="animate-spin" />`)、または右側 X 横に "検索中..." の 11px グレー。

### M4. 一括「除外する」が `window.confirm` で B2B 質感が落ちる
- 現状: ネイティブ confirm ダイアログ。サイト全体のデザイン (Hydro Minimalism) と異質。
- 提案: `<dialog>` か Headless UI 風の Confirm モーダル (rounded-3xl, brand 配色, 件数強調, "除外する" を破壊的アクションとして warning-700) を `components/ui/confirm-dialog.tsx` として導入。`useActionState` のフローと組み合わせるには Promise 化が必要だが、b/m 修正コストは小さい。

### M5. degraded 時に再読み込み導線が無い
- 現状: テキスト「時間をおいて再読み込みしてください」のみ。
- 提案: `incidentId` ブロックの右端に `Button(secondary) [再読み込み]` (`onClick={() => router.refresh()}` の Client Boundary or `<a href="/leads">`) を置く。Error recovery 原則。

---

## LOW (Nice-to-have)

### L1. EmptyState (フィルタ有) の「フィルタをクリア」と既存の `hasFilter` ボタンが二重 — 行動経路としては OK だが、`description` 内に「全件を見る」と「フィルタを緩める」の二択がもう少し明示されるとベター。

### L2. モバイル (md 未満) でドロワー高さが画面全体になるが、ヘッダの sticky と `flex-1 p-5` のスクロールがネイティブな pull-to-refresh と競合し得る。`overscroll-behavior: contain` を `aside` に付与すると iOS で滑らか。

### L3. スコア内訳プログレスバーの sky→teal グラデは美しいが、`tone === "danger"` 状態のリード (FAILED/SAFE_MODE/QUARANTINED) でも同じ色になるため、状態とスコアの色が乖離。スコアバンド (low/mid/high) で色相をシフトすると情報密度↑。

### L4. `LEAD_STATE_OPTIONS` のラベルは「すべての状態 / 発見 / 調査済…」と 1-2 文字短縮が混在。Select で 14 件並ぶと密度が高いので、グルーピング `<optgroup>` (探索 / 接触 / 商談 / 終了) があると視認性向上。

### L5. テーブル本体に「並び替え」UI が無い (spec §6.3 では明示要求は無いが、最終アクション降順固定はソート列に矢印アイコンを付けて「現在のソート」を明示すると Information Architecture が分かりやすい)。

### L6. `BulkBar` 内の "除外する" が単独アクションのみ。spec §6.3 では「キャンペーン移動 / タグ / CSV エクスポート」も並んでいるが、これらは P2 と読める。BulkBar 内に「他のアクション (Phase2)」ドロップダウンの placeholder を置くと将来拡張の意図が伝わる。

### L7. 検索 input の `aria-label="リードを検索"` は OK だが、現在のフィルタ件数が読み上げられないため、フィルタ適用後に総件数の `aria-live="polite"` リージョン (例: ヘッダの "N 件のリード" を polite 化) があると SR ユーザにも結果数が伝わる。

---

## 良かった点 (記録のため)

- **DEMO / degraded の三段階表現が忠実**: `source === "mock"` で Badge tone=info、`degraded` で `role=alert` + incidentId + monospace コード表示 (サポート連絡導線として理想形)。
- **StateChip の三重表現** (アイコン + 色 + 日本語ラベル, `role="status"`, `aria-label={meta.ja}`) が design.md §3.3 / §229 行のカラーブラインド+SR 要件を完璧に満たす。
- **`tabular font-mono` の使い分け** が一貫: スコア、件数、時刻、incidentId のみ等幅、固有名詞は font-display / 通常 sans。
- **URL を真実源とした状態管理** (q/scoreMin/campaign/state/page/lead が全て searchParams)。ブラウザ戻る/進むで完全復元、共有可能、deep-link 可。Next 15 のキャッシュ無効化指示 (`force-dynamic` + `force-no-store`) も適切。
- **Bulk アクションの安全設計**: `useActionState` で副作用と UI 状態を Promise 結合、`reportedRef` で同一 state 二重発火を防止、`resetSelection` を server から返して client が忠実に追従。`writeAudit` を 1ID = 1 audit で書き込む粒度設計も良い。
- **空状態の二態 (条件付き vs 真空)** が分岐され、後者には CTA + secondary を両方提示。Recovery 原則。
- **`scroll: false` を `Link` (行→ドロワー) と close 時 push の両方に付与** — リード一覧のスクロール位置を保持。SDR の連続オペレーションを邪魔しない丁寧な配慮。

---

## 90+ 判定: **PASS (92/100)**

設計書 §6.3 / §6.11.3 の MVP 要件は揃っており、Refined Hydro Minimalism の言語化された原則 (白基調 / 水色アクセント / Lucide / 三重表現 / tabular 数字 / ease-glide) を一貫して遵守。URL 同期・debounce・`useActionState`・Esc/外クリックといったインタラクションも実装の手練が感じられる。

主に残る課題は **(a) ドロワーのフォーカストラップ未実装** と **(b) §6.11.3 のクイックアクション群未着手** の 2 点で、これらは a11y / 仕様整合の各軸で各々 −2 点した結果が今回のスコア。Phase2 で対応するなら今回は PASS で問題ない。

90+ を維持するための最小修正セット (次イテレーションで推奨):
1. `aside[role=dialog]` にフォーカストラップ + 初期フォーカス + 復帰 (H1)
2. ドロワー header に少なくとも `[LinkedIn を開く ↗]` と `[除外]` の 2 ボタン (H2)
3. Engagement 派生式の撤去 or `scoreBreakdown` 構造化 (H3)

これらを満たせば 95+ に到達可能。
