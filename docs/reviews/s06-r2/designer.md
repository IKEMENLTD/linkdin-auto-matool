# S06 キャンペーン詳細 — Designer Review (r2)

**対象**: `/campaigns/[id]` 一式 (page + 5 components + query + action) — R2 修正版
**設計書**: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.11.2
**評価日**: 2026-05-11
**Reviewer**: designer-agent
**前回**: `docs/reviews/s06-r1/designer.md` (91 / 100 PASS)

---

## 総合スコア: **96 / 100** — **PASS (90+)** (R1 比 **+5**)

| 軸 | 配点 | R1 | **R2** | 差分 | 判定 |
|---|---|---|---|---|---|
| 1. ビジュアル (デザイントークン整合) | 20 | 19 | **19** | ±0 | 強 |
| 2. 設計書整合 (タブ/KPI/ファネル/注意/Phase2) | 20 | 17 | **18** | +1 | 強 (daily 空 → Phase2 placeholder で明示化) |
| 3. インタラクション (URL同期/確認/useActionState) | 20 | 18 | **20** | +2 | 満点 (revalidatePath 修正で即時反映) |
| 4. a11y (tab ARIA / h1 / フォーカス) | 20 | 17 | **19** | +2 | 強 (h1 重複解消・tabpanel ID 整合) |
| 5. 日本語 B2B トーン | 20 | 20 | **20** | ±0 | 満点 |

→ **PASS** (90+5=96)。HIGH ブロッカー **0 件**、NEW HIGH **0 件**。残るのは設計書未充足の MEDIUM 2 件 (R1 から繰り越し: 停止日 / リードフィルタ) と LOW 群のみ。

---

## R2 で潰した項目 (検証結果)

### ✓ HIGH-1: `<h1>` 重複解消

- `components/app/header.tsx` L11 `as?: "h1" | "p" = "h1"` prop 追加 → `const TitleTag = as;` で動的タグ。
- `app/(app)/campaigns/[id]/page.tsx` L91 `<Header title="キャンペーン詳細" subtitle={detail.name} as="p" />` で 詳細ページのみ `<p>` 化。
- `components/campaigns/detail/detail-header.tsx` L88 `<h1>` を**唯一の h1** として保持。
- **エラー状態 (L61)** は `as` 省略 = デフォルト `h1` のまま。この経路では `DetailHeader` をレンダしないので h1 は 1 個 ✓。整合性 OK。
- 他ページ (`/campaigns/new` 等) は `as` 省略のままで h1 維持 → 影響なし ✓。

**評価**: 設計として「ページ内に別の h1 がある場合は p に格下げ」というコメントが Header コンポーネント JSDoc に明記されており、誤用予防の docs としても良い。**完全解決**。

### ✓ MEDIUM: `aria-labelledby` 参照先 ID 不在解消 + tabIndex 追加

- `components/campaigns/detail/detail-tabs.tsx`:
  - L30 `id={`tablabel-${t.key}`}` 追加 → page.tsx L114 `aria-labelledby={`tablabel-${tab}`}` の参照先成立 ✓。
  - L33 `aria-controls={`tab-${t.key}`}` 追加 → tab → panel の双方向 ARIA 関係完成 ✓。
  - L34 `tabIndex={active ? 0 : -1}` 追加 → 非アクティブタブは Tab 移動でスキップ、Roving Tabindex の**半分**を実装 ✓。

**評価**: 設計書 §11 / WAI-ARIA Authoring Practice の Tab パターンに、`tabIndex` 0/-1 の対は必須要件。これが入っただけで SR と キーボードユーザの体験が大幅改善。**残課題は `onKeyDown` での Arrow ハンドリング**だが、これは LOW として残存 (下記)。

### ✓ MEDIUM: `revalidatePath` 漏れ解消

- `server/actions/campaigns.ts` L177 `singleCampaignAction` 末尾で `revalidatePath(`/campaigns/${parsed.data.id}`);` を実行。
- 内部 `bulkPauseCampaigns` / `bulkResumeCampaigns` / `bulkArchiveCampaigns` がそれぞれ呼ぶ `bulkSetStatus` も `revalidatePath("/campaigns")` を呼ぶので **一覧 + 詳細の両方が無効化**される ✓。
- コメント L176 「詳細画面の状態 chip を即時更新」も意図が明確。

**評価**: Pause → 即時 chip 更新の **「リロードしないと反映されない」UX バグが消えた**。Server Action × Next.js cache 境界の最適配置。**完全解決**。

### ✓ MEDIUM: `TabOverview` daily=0 placeholder 切替

- `components/campaigns/detail/tab-overview.tsx`:
  - L11 `const hasDaily = detail.daily.some(...)` で空判定 (sent/replied/meeting 合計 0 をすべて満たすケースを除外)。
  - L54 `hasDaily ? <ActivityChart/> : <Card>...集計準備中 · Phase2...</Card>` の三項分岐。
  - 空時カード内に LineChart アイコン + 「キャンペーン別の日次集計はまだ準備中です」+「Phase2 で messages.sentAt を集計してチャートを表示します」とサポート文。
- **設計書 §6.11.2** 「日次活動量」要件は **「Phase2 で対応する」と UI 上で明示**する形で **意図的未実装** として扱う運用に移行。

**評価**: R1 で「live 側で daily 全部 0 → ActivityChart が真っ平らに描画されて壊れて見える」リスクを指摘していたが、**Phase2 Badge + EmptyState 風プレースホルダ**で完璧にハンドリング。ダッシュボードへ誘導する文面 (「それまではダッシュボードの全体活動量を参照してください」) もエンタープライズ B2B の運用 SOP として丁寧。**完全解決**、R1 で 2 番目に懸念だった項目が解消されたため +1。

---

## 新たに確認した点 (NEW 観察)

### 強み (NEW)

- **Header の `as` prop は型安全**: `"h1" | "p"` で literal union。`as="div"` のような任意タグ汚染を防いでいる。一方で必要十分。
- **`tabIndex` パターンが正しい**: アクティブのみ 0、非アクティブは -1。`<Link>` ベース実装でも roving tabindex は正しく動く (Tab で出入りは 1 回ずつ、Arrow は未実装)。
- **エラー状態のみグローバル `Header` を h1 として温存**: `DetailHeader` が出ない経路では h1 が消えないよう設計されており、構造的 h1 が常に 1 個確保されている。SR 視点で非常に丁寧。
- **`reportedRef` の二重通知ガード** (`detail-header.tsx` L152-158): `useActionState` の state 参照が同じなら toast を再発火しないが、別参照 (新しい結果) なら必ず発火する。React 19 の `useActionState` を多重に握る詳細パターンの実装としてかなり成熟している。
- **Phase2 badge の文言統一**: 「集計準備中 · Phase2」「AI 採用ログ / 編集差分 (Phase2)」「編集 (Phase2)」とラベル末尾に Phase2 を一貫配置。これは将来 grep で「Phase2 残務」を機械抽出できるテックデット可視化策として優秀。

### 残課題 (R1 から繰り越し)

| ID | レベル | 内容 | 状態 |
|---|---|---|---|
| R1-M5 | MEDIUM | TabSettings に「停止日」Row 欠落 | **残存** (R2 で未対応) |
| R1-M6 | MEDIUM | TabLeads に `?leadState=` 状態フィルタ未実装 | **残存** (R2 で未対応, S07 リンクで代替動線あり) |
| R1-M7 | MEDIUM | `buildAttention` live 側で warmup/failed 生成なし | **残存** (Phase2 で実装予定の TODO コメントを `campaign-detail.ts` L126 に既存) |
| R1-M3 | MEDIUM | タブ Arrow キー横移動 | **半解決** (tabIndex 追加で半歩前進、`onKeyDown` 残) |
| R1-L8〜13 | LOW | hex 直書き / `confirm()` → Dialog / role=alert+aria-live=polite / aria-busy / TabLeads table 化 / breadcrumb nav | 全て残存 (Phase2 推奨) |

### 重要: 残った MEDIUM は **設計書整合のスコープ問題**であり、a11y / インタラクション / 構造的バグ系の HIGH/MEDIUM は **R2 で完全クリア**。

---

## HIGH 残存 / NEW HIGH

### HIGH 残存: **0 件** ✓
- R1 HIGH-1 (h1 重複) → 解消

### NEW HIGH: **0 件** ✓
- R2 で導入された prop / id / revalidatePath / placeholder のいずれにも構造的破綻なし。

### NEW MEDIUM: **0 件**
- 既存の機能を壊した変更なし。

### NEW LOW (R2 で気づいた範囲): **2 件**

1. **L-NEW1**: `tabIndex={active ? 0 : -1}` 単体では Arrow キー横移動が機能しない。Tab キーで一度フォーカスを得たあと **その内側で Arrow を捕まえる onKeyDown ハンドラ**が WAI-ARIA Authoring Practice の Tab パターンの完成形。`<Link>` で実現するなら `useRouter().push()` + `e.preventDefault()`。R1 で M3 として指摘済みのため重複だが、半解決を確認できたので NEW としては「次の一歩」を明示。
2. **L-NEW2**: `Header` の `as="p"` は構造的に正しいが、見出しに見える視覚スタイルは保たれている (`text-[15px] font-semibold tracking-tight`)。ARIA role 的には p なので **SR は見出しとして扱わない** = 視覚と構造の意図的乖離。設計判断としては正しい (詳細ページの本見出しは `DetailHeader` 側) が、もし将来「グローバル Header にも構造を持たせたい」となった場合は `role="presentation"` を明示するか、`as="span"` の方が CSS 引き継ぎがクリーン。現状は許容。

---

## 各軸詳細スコア (R1 → R2)

### 1. ビジュアル: 19 → **19** (±0)
hex 直書き (#FECACA 等) は R1 と同じ。本ファイル群では未着手。設計トークン整合は維持。

### 2. 設計書整合: 17 → **18** (+1)
- daily=0 ケースの Phase2 placeholder で「日次活動量未実装」が UI 上明示化 → 設計書要件と運用整合 +1。
- 残: 停止日 / リードフィルタ / buildAttention live (3 件) は維持。

### 3. インタラクション: 18 → **20** (+2 満点)
- `revalidatePath('/campaigns/${id}')` 追加で詳細画面の状態 chip 即時反映 +1。
- toast の `reportedRef` ガードが二重通知を防ぐ堅さ +1。
- confirm() → Dialog 移行は LOW で減点せず。

### 4. a11y: 17 → **19** (+2)
- h1 重複解消 +1。
- aria-labelledby 参照先 ID 不在解消 + aria-controls / tabIndex 追加 +1。
- 残: Arrow キー横移動の onKeyDown 未実装 (−1)。

### 5. 日本語 B2B トーン: 20 → **20** (±0 満点)
- 「集計準備中 · Phase2」「キャンペーン別の日次集計はまだ準備中です」「Phase2 で messages.sentAt を集計してチャートを表示します。それまではダッシュボードの全体活動量を参照してください」 — エンタープライズ B2B の運用 SOP 提案として完璧。
- 「設計書 §16.4」「設計書 §5.6.1」と章番号参照を残しているため、運用ハンドオフが容易。

---

## 90+ 判定: **PASS** (96 / 100)

| 指標 | 結果 |
|---|---|
| 総合スコア | **96 / 100** |
| HIGH 残存 | **0** |
| NEW HIGH | **0** |
| 軸別スコア最低値 | **18 / 20** (設計書整合) |
| R1 比改善 | **+5** (91 → 96) |

**判定: PASS (90+)** — merge 可。

### マージ前必修正: **なし** ✓
### マージ後 Phase2 で対応推奨 (R1 繰り越し):
- M5: TabSettings に「停止日」(pausedAt) Row 追加
- M6: TabLeads に `?leadState=` フィルタ実装 or S07 誘導の明文化
- M7: `buildAttention` live 側に warmup/failed 生成ロジック追加
- M3 残: タブの Arrow キー横移動 (`onKeyDown` ハンドラ)
- L8-13: hex 変数化 / Dialog 統一 / aria-live 整理 / aria-busy / TabLeads table 化 / breadcrumb nav 化

---

## まとめ

R2 で R1 の HIGH 1 件 + 構造的 MEDIUM 3 件 (aria-labelledby / revalidatePath / daily placeholder) が完全解決。**a11y とインタラクション軸が満点近くまで上昇**し、総合 91 → 96 に到達。残課題はすべて「設計書 §6.11.2 の機能追加 (停止日 / フィルタ / live attention)」と「Phase2 マイクロ改善 (Dialog 統一 / Arrow nav / hex 変数化)」で、いずれも MVP merge を阻害しない。

実装品質はリポジトリ全体でもトップクラスを維持。**問題なく PASS**。
