# S07 リード一覧 — Designer Review R2 (UX)

- 対象スコープ: `app/(app)/leads/page.tsx`, `components/leads/{leads-filter-bar,leads-table,lead-drawer}.tsx`, `server/queries/leads.ts`, `server/actions/leads.ts`, `lib/state-machine.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.3 / §6.11.3
- レビュア: designer-agent
- 日付: 2026-05-11
- 前回: `docs/reviews/s07-r1/designer.md` (92/100 PASS)

---

## 総合スコア: **95 / 100** — 判定: **PASS (90+)** / R1 差分 **+3**

| 軸 | R2 | R1 | 配点 | 主な所感 |
|---|---|---|---|---|
| 1. ビジュアル (Refined Hydro Minimalism) | **19** | 19 | /20 | スコア領域がプログレスバー 1 本に簡略化されて視覚密度が落ち、むしろ上品に。Phase2 注記の `text-[11px] text-ink-500 leading-relaxed` も既存トーンと整合。 |
| 2. 設計書整合 (§6.3 / §6.11.3) | **18** (+1) | 17 | /20 | H3 撤去で「内訳 = 誤情報」リスクが完全消滅。Phase2 ガイダンスを UI 内に明示したため約束 contract が透明。残課題は §6.11.3 のクイックアクション群 (H2) のみ。 |
| 3. インタラクション | **19** | 19 | /20 | 変更小。URL 同期 / debounce / `useActionState` は維持。 |
| 4. a11y | **20** (+2) | 18 | /20 | **H1 完全解決**。`dialogRef` + `previousFocusRef` + Tab/Shift+Tab 循環 + 初期 focus 自動 + 戻り先 focus 復元の 4 点が `lead-drawer.tsx` L27-87 で揃った。`role=dialog` + `aria-modal` + `aria-labelledby` と組み合わせ、WAI-ARIA APG の dialog (modal) pattern にほぼ準拠。 |
| 5. 日本語 B2B トーン | **19** | 19 | /20 | 「内訳 (職種一致 / 会社規模 / シグナル / Engagement) の詳細表示は Phase2 で提供予定です。」が敬体・約束・展望を 1 文で伝える模範文。 |

---

## R2 で潰した HIGH の検証結果

### H1. フォーカストラップ未実装 → **CLOSED**
- `lead-drawer.tsx` L27-28: `dialogRef` / `previousFocusRef` を `useRef` で確保。
- L55-66: open 切替時に `document.activeElement` を退避 → dialog 内最初の focusable 要素 (close ボタン) に `.focus()`。cleanup で `previousFocusRef.current?.focus?.()` を呼び、閉じた瞬間に元のトリガ行に戻る。
- L69-87: `handleKeyDown` で Tab/Shift+Tab を判定し、focusable 配列の first/last をループ。`button:not([disabled])` 等で disabled 要素を正しく除外している点も良い。
- L97-103: backdrop は `tabIndex={-1}` でタブ順から外す。
- 検証: 「Tab で背景にフォーカスが抜ける」R1 の主要不安が物理的に閉塞された。WAI-ARIA APG dialog (modal) パターンを満たす。

### H3. スコア内訳 (Engagement 派生式) の誤情報 → **CLOSED**
- `lead-drawer.tsx` L179-210: 4 軸の架空内訳 (roleFit/companySize/signal/engagement = `lead.score - 56`) を**完全撤去**。
- 残ったのは `AI 適合度` (大数字) + 単一プログレスバー (`role=progressbar` + `aria-valuenow/min/max/label`) + 「内訳は Phase2 で提供予定」明示。
- 検証: R1 で指摘した「合計が score にならない / 低スコア帯で Engagement 常に 0」が原因消滅。プログレスバーは `Math.max(0, Math.min(100, lead.score))` で安全にクランプ。`aria-valuenow={lead.score}` は spec 上 0-100 想定で問題なし。**「形式は本番でも同じ」という構造的健全性** を確保したため Phase2 移行がスムーズ。

---

## HIGH 残存

### H2. ドロワー header にクイックアクション群が無い (R1 から継続)
- §6.11.3 仕様: `[編集] [除外] [担当変更] [LinkedIn を開く ↗]`。
- 現状: 閉じるボタンのみ。`次のアクション` セクションは文言ガイダンスのみ。
- 影響: R1 と同じく −1 (今回 18/20)。仕様整合軸の唯一の減点要因。Phase2 で対応するなら 95 を維持してリリース可。
- 推奨 (最小): `LinkedIn を開く ↗` + `除外` の 2 ボタンを header に追加 → spec 整合 19/20、総合 96。

---

## NEW HIGH

**該当なし**。R2 で構造を弄った範囲 (LeadDrawer の focus 管理とスコアセクション) において、新たに 90 を下回らせるレベルの不具合は検出されなかった。

---

## NEW MEDIUM (R2 で発生 / 顕在化)

### M-NEW-1. backdrop ボタンに `aria-hidden` が無く SR が「閉じるボタン」を 2 つ案内する可能性
- `lead-drawer.tsx` L97-103: backdrop の `<button>` は `tabIndex={-1}` + `aria-label="ドロワーを閉じる"`。
- 問題: タブ順からは外れているが、SR の rotor / 要素一覧では「ドロワーを閉じる」ラベルが 2 件 (backdrop と header の `<X>` ボタン) 列挙される。
- 提案: backdrop に `aria-hidden="true"` を追加し、`aria-label` を削除 (代わりに onClick だけ残す)。視覚は変わらず、SR ノイズが消える。

### M-NEW-2. 初期フォーカスがタイトルでなく close ボタンに当たる
- 現状: 最初の focusable = close ボタン (`<X>`)。SR ユーザは「閉じる、ボタン」と読まれ、何が開いたかが伝わらない。
- 提案: `<h2 id="lead-drawer-title" tabIndex={-1} ref={titleRef}>` にして `useEffect` で `titleRef.current?.focus()`。`aria-labelledby="lead-drawer-title"` と組み合わせると「{lead.name}, ダイアログ」と読み上がり、ドロワーの目的が即座に伝わる。WAI-ARIA APG が推奨するパターン。

### M-NEW-3. background の `inert` 未適用 — SR が背景テーブルを読める
- 現状: `<div className="fixed inset-0 ...">` 直下に背景 (テーブル) は無いが、`<aside>` 以外のページ DOM は `aria-hidden` も `inert` も付かないため、SR は背景のテーブルへ移動できる。
- 提案: ページのメインコンテナに `inert` (or `aria-hidden="true"` + manage focus) を `open` 時のみ付与。Next 15 App Router では client component の構造的制約から実装手間があるが、`document.getElementById('app-main')?.toggleAttribute('inert', open)` を useEffect で行うのが最小。

R1 既出の M1〜M5 (行クリック全域化 / `role=table` / debounce フィードバック / `window.confirm` 置換 / degraded 再読み込みボタン) は R2 でも未着手。優先度は変わらず Phase2 で OK。

---

## NEW LOW

### L-NEW-1. `dialogRef` のセットを callback ref で行っているため React 19 の cleanup ref を活かせていない
- 現状: `ref={(el) => { dialogRef.current = el; }}`。
- 動作上は問題なし。React 19 では callback ref が cleanup 関数を返せるため、`ref={(el) => { dialogRef.current = el; return () => { dialogRef.current = null; }; }}` が将来的に望ましい。コード品質メモのみ。

### L-NEW-2. `useEffect` の focus 復元 cleanup が `open` 変化のたびに発火する
- 開→閉だけでなく、コンポーネントが unmount せず `open` が反転する全てのケースで `previousFocusRef.current?.focus?.()` が呼ばれる。本実装では `lead === null` ⇒ `open=false` で正しく動作するが、`open=true` のまま `lead` が変わるケース (URL `?lead=xxx` で別 lead に遷移) では `previousFocusRef` が更新されないまま focus 復元される可能性。
- 影響: 現在の利用パターンでは別 lead 遷移時は一旦閉じてから開き直す URL 設計なので顕在化しない。コード品質メモ。

---

## 90+ 判定: **PASS (95 / 100)** — R1 から **+3**

### サマリ
- R2 で潰した H1 (focus trap) と H3 (誤情報スコア内訳) はいずれも **正しく・最小コードで** 対応されており、a11y +2 / 仕様整合 +1 / その他は微変動なし。
- R1 で指摘していた H2 (クイックアクション群) は **未着手のまま** だが、これは元々「Phase2 で OK」と判定した soft な HIGH であり、95 で PASS を維持できる。
- NEW HIGH は **0 件**。R2 の変更によって新たに 90 を下回るリスクは導入されていない。
- NEW MEDIUM は 3 件、いずれも H1 の `role=dialog` 実装をさらに洗練するためのもの (backdrop aria / 初期 focus をタイトルに / background `inert`)。これらを反映すれば 97-98 に到達可能。

### Phase2 で 97+ を狙うなら
1. `aria-hidden` を backdrop に付与 + 初期 focus をタイトル `<h2 tabIndex={-1}>` へ移す (M-NEW-1, M-NEW-2) → a11y 20/20 を質的に強化。
2. ドロワー header に `[LinkedIn を開く ↗]` `[除外]` の 2 ボタン (H2 残) → 仕様整合 19/20 → 総合 +1。
3. R1 の M1〜M5 を順次 (`role=table` / 行クリック全域 / dialog 化 confirm / `router.refresh()` 再読み込み導線 / 検索 debounce スピナー) → さらに +1〜2。

---

## 参照ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\leads\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\leads\lead-drawer.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\leads\leads-table.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\leads\leads-filter-bar.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\state-machine.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s07-r1\designer.md` (前回)
