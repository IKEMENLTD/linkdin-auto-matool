# Designer Review — LinkdInside Frontend (code-r2)

- 観点: Refined Hydro Minimalism (UX / Visual / DX)
- 対象 commit: `app/`, `components/`, `lib/`, `server/queries/dashboard.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3
- R1 スコア: **86 / 100** → R2 スコア: **96 / 100**（**+10**）
- 評価日: 2026-05-10
- レビュアー: designer-agent

---

## 総合スコア: **96 / 100**（R1 比 **+10**）

| 軸 | R1 | R2 | 差分 | 一行評価 |
| --- | --- | --- | --- | --- |
| 1. ビジュアルクオリティ | 18 | 19 | +1 | NSM Hero の Definition popover が 2026 年エディトリアル基調を保ったまま情報密度を維持。`.kpi-numeral` のサイズ別分岐は未着手（M1 残） |
| 2. 設計書整合（NSM / KPI / Lucide） | 15 | 19 | +4 | NSM = REPLIED(直近7日) / 直近7日 active accounts に**改修済**、計算式トグルが定義文+更新時刻を開示、active accounts は live クエリ化。承認率 sparkline も `connected` 12日分実データ |
| 3. インタラクション / a11y | 17 | 19 | +2 | `:focus-visible` を outline 方式に切替・全 ChipやButton で角丸維持、MobileSidebar に `role="dialog"`+`aria-modal`+Escape ハンドラ完備、KPI/AttentionList/RecentCampaigns/NSM Hero 全て `next/link` |
| 4. レスポンシブ / 情報密度 | 16 | 19 | +3 | Header に Menu トグル、Drawer は overlay+body scroll lock+トランジション、md/sm 階段崩しも美しい。期間ピッカー UI（M9）のみ未着手 |
| 5. 日本語 B2B トーン | 20 | 20 | 0 | 計算式 popover の語彙（"件 / 週", "バッチ集計 06:00 JST"）まで品位保持 |

---

## R1 HIGH の解消状況

| ID | R1 指摘 | R2 状態 | 残課題 |
| --- | --- | --- | --- |
| **H1** | NSM の "/週" 不整合 + activeAccounts ハードコード + 計算式 Popover 未実装 | **解消** | — |
| **H2** | 承認率 sparkline がゼロ配列 | **解消** | — |
| **H3** | モバイル/タブレットでナビ消失 | **解消** | BottomTabs (§18) は引続き Phase2 |
| **H4** | `:focus-visible` の `border-radius: 6px` 強制 | **解消** | — |
| **H5** | KPI percent の前期比が `%` で pp 表記でない / 件数差分なし | **解消** | — |

**HIGH 残存: 0 件 / NEW HIGH: 0 件**

### 各 HIGH の検証メモ

- **H1**: `server/queries/dashboard.ts:67–70, 109–137` で NSM 専用窓 `nsmFrom = subDays(to, 7)` と prev 7 日窓を分離、`linkedinAccounts.status='active'` の COUNT を `activeAccountsRow` で取得。`mockSnapshot()` も `last7 / prev7` の slice に切替済（374–375）。`components/dashboard/nsm-hero.tsx:83–122` で Popover トグルを実装し、`aria-expanded` / `aria-controls` / 閉じるボタン (`aria-label="閉じる"`) まで完備。定義文 `NSM = REPLIED(直近7日) / 週内に1回以上送信したアカウント数` + 更新時刻 `バッチ集計 06:00 JST` を開示しており §1.1.1 / §6.1 を満たす。
- **H2**: `server/queries/dashboard.ts:215, 311` で `dailyConnected` を 12 日分 spark に渡している。mock も同 394 行で `connected` ベース。
- **H3**: `components/app/sidebar.tsx:188–248` の `MobileSidebar` が overlay + sheet + 200ms ease-glide。`components/app/header.tsx:14–21` に `Menu` トグル（`lg:hidden`、`aria-label="メニューを開く"`）。`Escape` で `onClose`、`document.body.style.overflow = "hidden"` の cleanup も適切。
- **H4**: `app/globals.css:111–120` で `outline: 2px solid rgba(56,189,248,0.85)` + `outline-offset: 2px` + `box-shadow: 0 0 0 4px rgba(56,189,248,0.20)` のハロー併用。`border-radius` 強制を撤廃し、Button や StateChip の角丸が focus 時も保持される。a/button/[role=button] への offset 追加(119)も丁寧。
- **H5**: `components/dashboard/kpi-card.tsx:48–82` で percent は `(current - previous) * 100` を `+X.X pp` 表示、count/currency 系は `+X.X% · +N` の三重表現。`previous === 0 && current === 0 → "0%"`、`previous === 0 && current > 0 → "新規"` のエッジケース分岐も入っている。

---

## NEW HIGH

なし。

---

## MEDIUM（残課題）

### M1【R1 残】 `kpi-numeral` のサイズ別分岐が未実装
- **場所**: `app/globals.css:183–194` / `components/dashboard/kpi-card.tsx:96` / `nsm-hero.tsx:60`
- **問題**: グローバル `.kpi-numeral` が単一定義のままで、Hero (88〜112px) と Card (44px) の両方に適用されている。`linear-gradient(... 60%, brand-700 140%)` は 100px 級では足元のみ青く滲む粋な演出だが、44px で適用すると "万" の字が水色に滲んで可読性が落ちる（特に低 DPI モニタ）。
- **推奨改善**:
  ```css
  .kpi-numeral { /* hero: 既存のグラデ維持 */ }
  .kpi-numeral-md {
    font-family: var(--font-display);
    font-feature-settings: "ss01", "tnum";
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 0.96;
    color: var(--color-ink-900);
  }
  ```
  KPI Card 側で `kpi-numeral-md` に切替、または props で variant を切替。

### M2 期間ピッカー UI が依然として未実装
- **場所**: `app/(app)/dashboard/page.tsx:30–33` / `components/app/header.tsx:34–48`
- **問題**: R1 M9 として指摘済。`searchParams.range` を読むコードは生きているが Header に切替 UI が無く、URL 直叩き専用機能のまま。設計書 §6.1 では「[期間 ▼ 過去 30 日]」が Header 右肩に図示されている。
- **推奨改善**: Header の `<div className="ml-auto flex items-center gap-2">` 先頭に `<RangePicker value={days} options={[7,14,30,90]} />` を実装。

### M3 AttentionList の `review` トーンが brand と意味的に衝突
- **場所**: `components/dashboard/attention-list.tsx:22`
- **問題**: R1 M3 と同じく `text-[var(--color-brand-700)] bg-[var(--color-brand-50)]` で "要対応" を表現している。NSM Hero / Sidebar active / KPI 全てで brand 50/700 が「ブランド・アクティブ」として機能しているのに、ここでは「要レビュー（=要注意）」のシグナルにも同色を使っているため意味の channel が混線。`info` トーン (`#3B82F6`) は既に存在するため移すだけで解決する。
- **推奨改善**: `review: "text-[var(--color-info-700)] bg-[var(--color-info-50)] border-[#BFDBFE]"` へ。brand-50 は「アクティブ / hover」専用に予約。

### M4 ヘッダーの `T` / Sidebar の `IK` が依然ハードコード
- **場所**: `components/app/header.tsx:76` / `components/app/sidebar.tsx:60–64`
- **問題**: R1 M6 と同じ。`auth` 未接続のため当面 mock で OK だが、`// TODO(auth): replace with session.user.initial` コメントが無いため漏れリスクあり。

### M5 状態機械 tone マッピングの色解像度
- **場所**: `lib/state-machine.ts`
- **問題**: R1 M5 のまま。`info` vs `info-strong`, `success-soft` vs `success-strong` が同色のため、14 状態を 4 色で塗っている。色 channel の三重表現が機能不全。Phase2 でユーザーが状態を見分ける場面が増える前に対処したい。

### M6 `.hydro-canvas::after` grain noise の全面適用
- **場所**: `app/globals.css:148–157`
- **問題**: R1 M10 のまま。`mix-blend-mode: multiply` の青み grain が `<div class="hydro-canvas">` 全面（layout 全体）に張られている。ヒーローの白に近い領域では程よいアトモスフィアを生むが、Card 内のテーブル行など細字 12px 領域で透けると微かな読みづらさ。
- **推奨改善**: `inset: 0 0 auto 0; height: 460px;` でヒーロー帯のみに限定。

---

## LOW

### L1 NSM Hero の "計算式" ボタンが trend 行と同じ y にあり押し誤りリスク
- 場所: `components/dashboard/nsm-hero.tsx:83–92`
- 矢印 + `+13.4%` テキスト + "全アカウント計 21 件 · アクティブ 3 アカウント" + "計算式" がすべて同列・横スクロール幅で並ぶ。スマホ 360px では折り返して 3 行になる挙動は良いが、計算式ボタンの周辺ヒット領域が狭い（`<button>` 直下のテキストのみ）。
- 推奨: `min-height: 32px` + `px-2` で押下面積を確保。

### L2 計算式 Popover の `role="region"` だけで `aria-labelledby` が無い
- 場所: `components/dashboard/nsm-hero.tsx:96–122`
- region には accessible name 必須（WAI-ARIA）。`aria-labelledby="nsm-formula-title"` を `Definition` ラベル `<span>` に向ければ完結。現状でも SR で読まれるが、アンカーが弱い。

### L3 KPI Card の `gradId` が label ベース
- 場所: `components/dashboard/kpi-card.tsx:84`
- `spk-${label.replace(/\s+/g, "-")}`。label が日本語のためコリジョンは事実上発生しないが、`React.useId()` を使うのが React 18 以降の推奨。R1 M4 のリスクは事実上低減しているので LOW へ降格。

### L4 MobileSidebar の focus trap 無し
- 場所: `components/app/sidebar.tsx:222–245`
- `aria-modal="true"` を立てているが、Tab で背後の要素にフォーカスが抜ける。SR ユーザー / キーボードユーザー向けの厳密な dialog 挙動には focus trap が必要。`react-focus-lock` か小さな自前トラップで補完。

### L5 NSM Hero の "/{target} 目標" の単位ラベル
- 場所: `nsm-hero.tsx:62`
- 数字 `8` の後ろに `目標` だけだと「目標値 8」なのか「目標到達率 8」なのか文脈で読ませている。`/ 8 件・週` のように単位を入れた方が誤読しない。

### L6 `kpi-numeral` のグラデ最適化
- 場所: `app/globals.css:190`
- `linear-gradient(180deg, var(--color-ink-900) 60%, var(--color-brand-700) 140%)` の `140%` 指定。Safari 16 系で `>100%` の color-stop が解釈ぶれするケースが過去にあるため `100%` 内で `82%` 起点にする方が堅い。

### L7 `recent-campaigns.tsx` の二重線
- 場所: 40, 49 行目（R1 L7 のまま）
- ヘッダ `border-y` と `<ul>` の `divide-y` で接合点が 2px 線になる Retina バグ。実害は微小だが `border-y` を `border-t` に。

### L8 `metadata.title.template` のセパレータ「·」（R1 L4 残）

### L9 「全アカウント計 N 件」の冗長表現（R1 L5 残）

### L10 `Skeleton` の `aria-busy` 連動（R1 L2 残）

---

## 良い点（R2 で増えた）

1. **NSM Hero の definition popover** が秀逸。`code` タグで `NSM = REPLIED(直近7日) / 週内に1回以上送信したアカウント数` と数式表記、更新時刻 `バッチ集計 06:00 JST` の表記、閉じるボタンの hover 背景 `var(--color-ink-100)` まで段差が無い。R1 で指摘した §6.1 「データソースと計算式の開示」が**機能としても見た目としても**一級。
2. **MobileSidebar の transition 設計**。`200ms ease-[var(--ease-glide)]` で `-translate-x-full` ↔ `translate-x-0`、overlay 側は `transition-opacity` で別レイヤー。Escape ハンドラと body scroll lock の cleanup までセット。「アクセシビリティ + UX」を妥協していない。
3. **focus ring の outline 方式への切替**。`outline-offset: 3px` の追い込みで Button (`rounded-full`) や StateChip (`chip` = 999px) の輪郭に沿った焦点表示が崩れない。R1 の角丸潰れ問題が完全解消。

---

## 95+ 判定

**95+ 達成: YES (96/100)**

R1 で指摘した 5 件の HIGH（H1–H5）はすべて構造的に解消されており、特に H1 (NSM 計算式整合) と H3 (モバイルナビ) は設計書 §1.1.1 / §3.1 / §6.1 / §18 への適合が定性的にも検証可能。

97+ への残ブロッカーは以下の 3 件（順序通りに潰せば +1〜+2 上振れ）:

1. **M1**: `kpi-numeral` を Hero / Card で分岐し、Card の数字滲みを除去（ビジュアル軸 19→20）
2. **M2**: 期間ピッカー UI を Header に追加（情報密度軸 19→20）
3. **M3**: AttentionList の `review` を info トーンに分離（設計書整合 19→20）

これらは全て LOW 寄りの MEDIUM で、ローンチブロッカーではない。Phase2 / 次スプリントで吸収可能。
