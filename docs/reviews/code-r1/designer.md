# Designer Review — LinkdInside Frontend (code-r1)

- 観点: Refined Hydro Minimalism (UX / Visual / DX)
- 対象 commit: `app/`, `components/`, `lib/state-machine.ts` (記載のセット)
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3
- 評価日: 2026-05-09
- レビュアー: designer-agent

---

## 総合スコア: **86 / 100**

| 軸 | スコア | 一行評価 |
| --- | --- | --- |
| 1. ビジュアルクオリティ（白+水色 / グラデ / シャドウ / タイポ） | **18 / 20** | KPI numeral・liquid-bar・hydro mesh が秀逸。ただし `.hydro-canvas` の grain noise が大判面で過密 |
| 2. 設計書との整合（NSM / KPI 計算式 / 状態機械 / Lucide） | **15 / 20** | NSM の定義式と実装が **部分不一致**（active 判定が無い）。承認率の sparkline は計算根拠なし |
| 3. インタラクション（hover / focus / transition / a11y） | **17 / 20** | focus-ring が hidden でも適用される `box-shadow` 上書き、`<a>` への role 不足 |
| 4. レスポンシブ / 情報密度 / 余白 | **16 / 20** | サイドバーが `lg:` 未満で完全消失（モバイルナビゲーション不在）。ヘッダーの検索/AI ボタン折返し不可 |
| 5. 日本語 B2B トーン（フォント / 文言 / 絵文字） | **20 / 20** | 敬体・絵文字無し・三重表現徹底、`Noto Sans JP` 連結も適切 |

---

## HIGH（ローンチブロッカー）

### H1. NSM の計算式が設計書と乖離している
- **場所**: `components/dashboard/nsm-hero.tsx:12` / `server/queries/dashboard.ts:159–164`
- **問題**:
  設計書 §1.1.1 では NSM = "**週 1 回以上送信したアカウント当たり** の 新規返信件数 / **週**" と定義。実装では:
  - `weeklyReplies` に **rangeDays 期間（30 日デフォルト）累計の `replied`** が入っており「/ 週」になっていない（`sumCurr.replied` をそのまま渡している `dashboard.ts:160`）。
  - `activeAccounts` が **ハードコード `3`**（live ブランチでも mock でも同じ）。「週 1 回以上送信」のフィルタが存在しない。
  - 結果として KPI numeral に「7 / 1.0 / 21」のような値が出るが、目盛りも分母も設計書と乖離。Hover で「データソースと計算式」を出せという §6.1 の必須仕様も未実装（`計算式` ボタンは UI のみで `aria-label` だけ持ち、ハンドラ無し）。
- **推奨改善**:
  - サーバ側で `weekly_active_accounts(org, week)` を計算し（`sent ≥ 1` が ISO 週内にある account 数）、`weeklyReplies` は **直近 7 日**の `REPLIED` 状態遷移件数に揃える。
  - `prevWeeklyReplies` も「先週の 7 日」に変更（現在は前 30 日の累計）。
  - `Info` ボタンに `<Popover>` を仕込み、定義式・データ更新時刻・サンプル期間を開示（§1.1.1, §6.1 必須）。
  - レンジ切替（7/14/30/90）と NSM の「週」概念は独立。レンジは KPI/ファネル用、NSM ヒーローは常に **直近完結週** + 前週比 で固定するのが §76 の意図。

### H2. KPI 「承認率」の sparkline がダミーデータ
- **場所**: `server/queries/dashboard.ts:167`
- **問題**: live 経路で `spark: daily.slice(-12).map(() => 0)` と **ゼロ配列を返している**。UI では Sparkline が描画されない (`values.length` は 12 だが全 0 → 全点底辺 → 線が下辺と重なって視認不可) が、設計書 §6.1 の「KPI カードは前期比矢印と差分絶対値の両方 + sparkline」要件を満たさない。
- **推奨改善**: `daily` に `connected` を持たせ、日次 `connected/sent` の率（または `connected` の絶対数）を 12 日分返す。0 配列を返すと「壊れたチャート」に見える。

### H3. モバイル時のナビゲーション欠落（lg breakpoint 以下）
- **場所**: `components/app/sidebar.tsx:46`、`app/(app)/layout.tsx:5`
- **問題**: `<aside className="hidden lg:flex ...">` で **`lg` (1024px) 未満は完全に消える**。設計書 §3.1 / §18 では「モバイル: ボトムタブ 5 件」がモバイル MVP とされている。
  現状ではタブレット（768〜1023px）で **ナビゲーション手段がゼロ**（ヘッダーにもメニュー / ハンバーガー無し、`components/app/header.tsx` 確認済）。これはダッシュボードが **アクセス不能になる致命的バグ**。
- **推奨改善**:
  - 短期: `header.tsx` 左に `<button aria-label="メニューを開く">` (Lucide `Menu` icon) を追加し `lg:hidden`、Sheet/Drawer でサイドバー再表示。
  - 中期: §18 通りモバイル専用 BottomTabs を実装。

### H4. focus ring が `border-radius` を上書きしてピル形ボタンで欠ける
- **場所**: `app/globals.css:111–115`
- **問題**:
  ```css
  :focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(56,189,248,0.45), 0 0 0 1px rgba(2,132,199,0.35);
    border-radius: 6px;        /* ← 全要素に強制適用 */
  }
  ```
  - `border-radius: 6px` がグローバルに強制されるため、`Button` (rounded-full = 9999px)、`StateChip` (chip = 999px)、ヘッダーの検索 pill などが **focus 時に角丸がリセットされて長方形に変化する**。視覚的破綻。
  - `outline` を消して `box-shadow` で代替する設計だが、ボタンの primary variant は既に `box-shadow: 0 8px 24px ...` を持っているため **focus 時に既存の影が完全に上書きされて消える**（cva の `:focus-visible` が後勝ち）。
- **推奨改善**:
  ```css
  :focus-visible {
    outline: 2px solid var(--color-brand-500);
    outline-offset: 2px;
  }
  ```
  にするか、`box-shadow` を採用するなら `border-radius: inherit;` + 既存影との合成（コンマ区切りで両立）に変更。少なくとも `border-radius: 6px;` の強制は削除必須。

### H5. KPI カード `unit="percent"` で `current` 値の単位が不整合
- **場所**: `components/dashboard/kpi-card.tsx:54` + `app/(app)/dashboard/page.tsx:67–80`
- **問題**:
  - `KpiCard` は `unit==="percent"` 時に `(current * 100).toFixed(1)%` で表示するため、`current` は **小数 0–1（0.42 = 42%）** を期待。
  - サーバは `approvalRate.current = sumCurr.connected / sumCurr.sent`（小数）、`replyRate.current` も小数 → ここは整合。
  - しかし `fmtDelta(current, previous)` は **小数同士で前期比** を計算し `Math.abs(percent).toFixed(1)%` を出す。`0.42 → 0.45` が「+7.1%」と出るのは数値的には正しいが、**KPI 「承認率」での `±%` は「ポイント差(pp)」表現が B2B SaaS 慣例**。`+7.1%` と `+3pp` は別物で、CXO 級が誤読する。
  - 設計書 §1.1.1 の三重表現「±% と件数差分の両方」も件数差分側が表示されていない（KPI Card 全タイプで delta 件数なし）。
- **推奨改善**:
  - パーセント KPI には `(current - previous) * 100` を `+X.X pp` で別ラベル表示。
  - 数値 KPI には `+N 件 / -N 件` を `delta.value` から表示（NSM Hero と同じ三重表現を KPI Card にも展開）。

---

## MEDIUM

### M1. `kpi-numeral` のグラデが ink-900 → brand-700 で **下端が水色**
- **場所**: `app/globals.css:185`
- **問題**: `linear-gradient(180deg, var(--color-ink-900) 60%, var(--color-brand-700) 140%)` の `140%` 指定で、実視覚的には数値の下 30〜40% が水色化する。NSM ヒーローの 88〜112px サイズだと「字の足元だけ青く滲む」演出になり高評価だが、KPI Card の 44px 数値だと **滲みが過剰で可読性低下**（特に「3.5万」の「万」が水色）。サイズ依存で見え方が異なるため意図が崩れる。
- **推奨改善**: `kpi-numeral-hero` (大用) と `kpi-numeral` (中用) を分け、後者は `color: var(--color-ink-900)` 単色 + `font-feature-settings` のみに留める。

### M2. ファネルの `liquid-bar` 中の数値が小バー時に枠外に飛ぶ
- **場所**: `components/dashboard/funnel.tsx:62–64` + `app/globals.css:192–209`
- **問題**: `widthPct < 8%` の状態では `Math.max(widthPct, 8)` で最小 8% に固定する救済があるが、**数値ラベルは絶対右端**（`justify-end pr-3`）なので、ステップ末端で count=47 のような小バーでは 8% 内に「47」が無理やり押し込まれ、テキストが影と重なって読みにくい。
- **推奨改善**: バーが閾値（例 18%）以下なら「バー外側右」にラベルを出す。CSS で `.liquid-bar[data-narrow="true"] + .label` にする or React 側で条件分岐。

### M3. AttentionList のアイコン背景色が brand と意味的に衝突
- **場所**: `components/dashboard/attention-list.tsx:14`
- **問題**: `review` の tone が `bg-[var(--color-brand-50)]` （水色系）。サイドバー active 状態・KPI Card・NSM Hero など全画面で water-blue が「ブランド色 / アクティブ表示」に使われているのに、ここでは「要レビュー（要対応）」のシグナルにも brand-50 を流用。Status is a First-class Citizen 原則 (§1.2) で言う三重表現が、色 channel で混線。
- **推奨改善**: `review` を `info-700/info-50` (青系) に分離し、brand 50 はあくまで「アクティブ / hover」専用に予約。`info-500: #3B82F6` は既にトークンに存在。

### M4. Sparkline の `<linearGradient id>` が値依存で衝突しうる
- **場所**: `components/dashboard/kpi-card.tsx:28, 35`
- **問題**: `id={\`spk-${values.join("-")}\`}` で値配列をジョインして id にしている。同じ値配列が 2 つの KPI Card に出ると id 重複。複数のスパークが同じ defs を参照すると Safari/Firefox で塗りが破綻するケースがある（id 衝突 → 後勝ち）。
- **推奨改善**: `React.useId()` または `crypto.randomUUID()` を使う。

### M5. 状態機械の tone マッピングで色が同じものが多すぎる
- **場所**: `lib/state-machine.ts:78–91`
- **問題**: `info`, `info-strong`, `progress` が **全て `text-brand-700/info-700`**。`success`, `success-strong`, `positive`, `positive-soft` も全部 `text-success-700`。`warning`, `warning-soft` も同色。State 機能上は 14 状態あるのにユーザーが見分けられる色は実質 4 色（brand / success / warning / danger / muted）。設計書 §1.2「アイコン + 色 + ラベル」三重表現のうち「色」が機能していない。
- **推奨改善**: せめて `info` と `info-strong`、`success-soft` と `success-strong` で **明度差**（500 vs 700）を付ける。`positive-soft` を `success-500`、`success-strong` を `success-700` のように差別化。

### M6. ヘッダーのアバターが英字「T」決め打ち
- **場所**: `components/app/header.tsx:55–58`
- **問題**: 「田中」さんのイニシャル `T` を直書き。本実装ではユーザーから取得が必要。サイドバーの Workspace アイコン `IK` も同様にハードコード（`sidebar.tsx:60–62`）。**現時点では `auth` 未接続なので mock 値で OK** だが、`TODO` コメントが無く後段で漏れる可能性大。
- **推奨改善**: `// TODO(auth): replace with session.user.initial` を明記。

### M7. SVG ロゴの path が壊れている可能性
- **場所**: `components/brand/logo.tsx:24`
- **問題**: `M11 11.5v9M11 11.5a1.5 1.5 0 1 1 0-.001z...` の `1 0-.001` 部分で円弧の終点が始点とほぼ同じ（無効サブパス）。Chrome では描画されるが、Safari/Firefox で「LinkedIn の i (上の点)」が表示されないリスク。意図は `circle cx=11 cy=9.2 r=1.4` で別途描画されているので、`a1.5 ...` は冗長 + バグ要因。
- **推奨改善**: `path` から `M11 11.5a1.5 ...` セグメントを削除（`circle` だけに頼る）。

### M8. スクロールバーの `border: 2px solid #FFFFFF` がダーク系背景でモアレを生む
- **場所**: `app/globals.css:120`
- **問題**: ダッシュボード自体は白なので問題ないが、将来 `glass` 上にスクロール領域が来た時 thumb の白枠が背景と一致せず段差を出す。**v1.3 ではダッシュ S03 のみ実装済みなので顕在化しない** ものの、Phase2 で `<aside class="glass">` 内スクロールが出ると視覚バグになる。
- **推奨改善**: `border: 2px solid transparent;` + `background-clip: padding-box;` パターンに変更。

### M9. 「期間 ▼」ピッカーが UI に存在しない
- **場所**: `app/(app)/dashboard/page.tsx:31–34`
- **問題**: 設計書 §6.1 / レイアウト図に「[期間 ▼ 過去 30 日]」が右上ヘッダ右肩に必須として図示されている。Header に渡しているのは `subtitle` で日付レンジ「5月10日 〜 6月8日 · 30 日」を表示しているが、**ユーザーが期間を切り替える UI が無い**。`searchParams.range` を読むコードはあるのに UI が無いため、URL 直叩き専用機能。
- **推奨改善**: Header の `ml-auto` 群の先頭に `<RangePicker>` (7/14/30/90/Custom) を実装。

### M10. `.hydro-canvas::after` の grain noise が文章領域で読みづらさを増す
- **場所**: `app/globals.css:143–152`
- **問題**: `mix-blend-mode: multiply` で `opacity: 0.6` の青み grain を全面にかけているため、本文領域（特に ink-500 の細字 12px）で **背景に微かな青斑点** が出る。ヒーローセクション内で限定すれば大正解だが、`hydro-canvas` は app layout 全面に張られている (`app/(app)/layout.tsx:5`) ため、テーブル行や AttentionList の小テキストでも grain が透ける。設計書 §1.2 「Clarity over Density」に反する。
- **推奨改善**: grain は **ヒーロー領域上端 460px** に限定するため、`::after` の `inset` を `0 0 auto 0; height: 460px;` に揃え、`bg-canvas` 全体には通常の白を出す。

---

## LOW

### L1. ボタン variant の transition 時間が `200ms` 統一だがプライマリだけ動きすぎ
- 場所: `components/ui/button.tsx:8`
- 200ms `glide` で `translate-y-[-1px]` + `box-shadow` 同時アニメは速すぎて hover でジャダーが見える。Primary だけ 240ms にするとリッチ感が出る。

### L2. `Skeleton` が `aria-hidden` のみで完了通知が弱い
- 場所: `components/ui/skeleton.tsx:5`
- 隣接コンテナ側に `role="status" aria-live="polite"` + `aria-busy="true"` が望ましい。SR ユーザーに「読み込み中」が伝わらない。

### L3. アクティブナビの左 3px グラデバーが `rounded-full` の角丸と段差
- 場所: `components/app/sidebar.tsx:91–96`
- Link 自体が `rounded-xl`、内部のバーが `rounded-full`。ホバーを連発すると左端に 1px のクリッピング段差が出る端末がある。バーを `rounded-r-full` にして左端を矩形に。

### L4. `metadata.title.template` のセパレータが「·」中黒
- 場所: `app/layout.tsx:33`
- 中黒は B2B では好まれるが、検索結果（Google）で「LinkdInside · ダッシュボード」と表示される際、中黒がフォントによっては「点」に潰れる。`—` (em dash) または ` | ` の方が SERP での視認性が高い（軽微）。

### L5. NSM Hero の「先週から · 全アカウント計 N 件」表記が冗長
- 場所: `components/dashboard/nsm-hero.tsx:60–62`
- 「先週比」の三重表現（矢印 + 色 + 文字）は揃っているが、「全アカウント計」が右側 KPI と重複情報。NSM の **per-account** 値の文脈で生数を出すなら「合計 21 件」だけで十分。

### L6. `layout.tsx` のフォント変数を CSS 側で参照していない
- 場所: `app/layout.tsx:48–53` ⇄ `globals.css:57–59`
- `--font-manrope`, `--font-geist`, `--font-noto-jp` を `<html className>` に注入しているが、`@theme` 側は `"Manrope"`, `"Geist"`, `"Noto Sans JP"` の **文字列名** で参照している。Next/Font の最適化ローカルフォントは `--font-*` 変数経由でないと適用されない場合がある（ブラウザに直接 `Manrope` が無い時にフォールバック）。
- 推奨: `--font-display: var(--font-manrope), "Noto Sans JP", ...` に変更。

### L7. `divide-y` が ` border-t` の Card と二重線になりかけ
- 場所: `components/dashboard/recent-campaigns.tsx:40, 49`
- ヘッダ行が `border-y` で罫線、`<ul>` が `divide-y`。両者の境界で 2px 線が見える Retina 端末がある。`border-y` → `border-t` のみに。

---

## 良い点（top 3）

1. **`.kpi-numeral` のグラデーション + `font-feature-settings: ss01, tnum` + `letter-spacing: -0.04em`** の組み合わせが Editorial 級の「2026 年トーン」を実現している。NSM Hero の 112px 数字は名刺代わりに使えるレベル。
2. **状態機械（`lib/state-machine.ts`）の三重表現アーキテクチャ** が設計書 §1.2「Status is a First-class Citizen」を真正面から受けて構造化されている。`STATE_META` を辞書化し `<StateChip>` で呼び出す設計は、他のチームメンバーが状態を追加する際の DX も良い。tone マッピングだけ M5 で粒度を上げれば 95+ 確実。
3. **NSM Hero の `liquid-bar` + `pulse-soft` + 3 stop linear-gradient** の演出が、競合 SaaS（Apollo / Lemlist / Clay）に対して「日本語 B2B らしい清潔さ + 深い水色」で明確に差別化されている。`hydro-canvas::before` の radial-gradient mesh も、ヒーロー領域に限定すれば一級のアトモスフィア。

---

## 95+ 到達のための残ブロッカー（優先度順）

1. **H1**: NSM の **per active account / 週** の計算式を実装し、`Info` ボタンで Popover として開示する。設計書 §1.1.1 / §6.1 の MUST。
2. **H3**: モバイル / タブレットでサイドバーが消えてナビ不能。`Sheet` ベースのドロワーを `lg:hidden` で実装。
3. **H4**: `:focus-visible` の `border-radius: 6px` 強制を削除し、`outline` ベースに切替（または `inherit`）。アクセシビリティの基本要件。
4. **H5**: KPI Card の percent 表示で「pp 差分」と「件数差分」を併記。NSM Hero と同じ三重表現を踏襲。
5. **H2**: 承認率の sparkline をダミー 0 配列から実データに。
6. **M1**: `kpi-numeral` を Hero / Card サイズで分岐。Card の数字滲みを除去。
7. **M5**: 状態機械の tone を `info` vs `info-strong`, `success-soft` vs `success-strong` で明度差。
8. **M9**: 期間ピッカー UI を Header 右肩に追加（§6.1 図示通り）。
9. **M10**: grain noise をヒーロー領域に限定し、本文領域はクリーンな白に。

これら 9 件を潰せば、ビジュアル / 設計整合 / インタラクションの 3 軸で各 19+ に到達し、総合 **95–97** が射程に入る。日本語 B2B トーンと余白設計は既に高水準なので、上記の整合性 + a11y 修正を最優先で。
