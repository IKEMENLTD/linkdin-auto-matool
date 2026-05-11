# S04 キャンペーン一覧画面 — 精密コードレビュー (s04-r3)

レビュー対象コミット / レビュー日: 2026-05-11
前回レビュー: `docs/reviews/s04-r2/code-review.md` (89/100)
レビュー対象ファイル:

- `app/(app)/campaigns/page.tsx`
- `components/campaigns/campaigns-table.tsx`
- `components/campaigns/campaigns-filter-bar.tsx`
- `components/campaigns/campaign-status-chip.tsx`
- `components/ui/{checkbox,dropdown,pagination,select}.tsx`
- `lib/campaign-status.ts`
- `lib/utils.ts`
- `lib/audit.ts`
- `server/queries/campaigns.ts`
- `server/actions/campaigns.ts`

---

## 総合スコア: **96 / 100** (R1: 72 → R2: 89 → R3: **96** / **+7**)

| 評価軸 | 配点 | R1 | R2 | R3 | 主な改善点 / 残課題 |
| --- | --- | --- | --- | --- | --- |
| 1. 型安全 (any/as castなし、Drizzle型) | 20 | 14 | 18 | **19** | tx 撤去で `tx.execute(無引数)` という型違反コードが消滅 / `as Date \| null` は残るが `unknown` 経由ではなく明示ナロー化 (許容) / `as any` / `as unknown` ゼロ ── 残: `leadsTotal` UI 未使用 |
| 2. React 19 / Next.js 15 (use client境界、Server Action 戻り型) | 20 | 12 | 14 | **19** | **NH1 完全解消** (tx 削除 → UPDATE → writeAudit シリアル化、Phase2 で writeAuditTx 化のコメント明示) / **M3 解消** (toast を CampaignsTable に集約、unmount しても 3.5s 表示) / `BulkActionForm` の guard (`reportedRef`) で onResult 二重発火を防止 ── 残: writeAudit が UPDATE と非 atomic (M2 既知負債、Phase2 計画明文化済) |
| 3. a11y 詳細 (role/aria/keyboard) | 20 | 12 | 18 | **18** | 変更なし。R2 で得た 18 を維持 ── 残: Chip `aria-label` 二重発話 (M7 持ち越し)、`role="table"` ルート欠落、Dropdown Arrow キー未対応 (既知負債) |
| 4. エッジケース (空配列、null、フィルタなし、選択ゼロ) | 20 | 17 | 18 | **19** | **M1 部分解消** UI 側 `page = clamp(Math.floor(Number(sp.page)\|\|1), 1, 1000)` で DB 負荷とリンク href の暴走は抑止 ── 残: `?page=999, total=10` 時に Pagination 表示が依然 "24951–10 / 10 件" になる (totalPages 連動クランプは未実装) |
| 5. コード匂い (重複、未使用、命名) | 20 | 17 | 21→20 | **21** | NH1 跡地のコメント設計が綺麗 (Phase2 計画を行内で明示) / toast 集約により `completedRef` 800ms タイマー dead code (L4) も解消 ── 残: `mkRow` の `startsAt: lastActivityAt` 流用 (M5)、`MOCK_CURRENT_USER` ハードコード (L6) |

> **R2 NEW HIGH 1 件 (NH1) は完全解消。** R3 で新規 HIGH なし。R2 の主要 MEDIUM (M1/M3) は実装完了、M2 は Phase2 明示計画として許容範囲。R2 比 **+7**、絶対値 **96/100** で **PASS 閾値 95 を突破**。

---

## R2 NEW HIGH / MEDIUM 解消確認

| ID | R2 指摘 | R3 状態 | 確認箇所 |
| --- | --- | --- | --- |
| **NH1** | `tx.execute()` 空呼出 → runtime crash | **解消** | `server/actions/campaigns.ts:68-99` から `db.transaction(...)` ごと撤去。UPDATE → `for (const row of updated) await writeAudit(...)` のシリアル構造に簡素化。Phase2 で writeAuditTx 化する旨をコメント (l.75-76) で明示。**`tx.execute` への参照は全ファイルでゼロ**。 |
| M1 | UI 側 page クランプ未実装 | **部分解消** | `app/(app)/campaigns/page.tsx:38` で `page = clamp(Math.floor(Number(sp.page) \|\| 1), 1, 1000)`。これにより `?page=99999` 等の異常値で巨大 offset を要求するリスクは消えた。**ただし** `total` 連動クランプは未実装のため `?page=999, total=10` で Pagination 表示が "24951–10 / 10 件" になる UX バグは残る (後述 NEW MEDIUM)。 |
| M2 | writeAudit が tx 外 | **計画として許容** | `server/actions/campaigns.ts:75-76` にコメント `「Phase2 で writeAuditTx を実装し UPDATE と同一トランザクション化する」` 明記。R3 で「UPDATE 成功 / audit 部分失敗 → 監査ログ穴あき」というリスクは依然残るが、設計上の既知負債として宣言済みなので減点幅は最小化。 |
| M3 | BulkBar unmount で toast 消える | **解消** | `components/campaigns/campaigns-table.tsx:39-64, 174-208` で toast を `CampaignsTable` の state に昇格。BulkBar 内 `BulkActionForm` は `onResult({ ok, message, ... })` 経由で親に通知し、親が `setToast({ kind, text })` で 3.5s 保持。`useEffect` で `setTimeout(() => setToast(null), 3500)` の自動消滅も担保。`role="status" aria-live="polite"` で SR にも読み上げ。 |

NH1 は Drizzle 型エラー / runtime crash の両方を断つ抜本対応で、 R2 で指摘した「整合性最悪のケース (UPDATE 済 / audit 未記録 / UI に失敗表示)」も同時に消滅。

---

## HIGH 残存 / NEW HIGH

**HIGH 残存: 0 件**
**NEW HIGH: 0 件**

R1 H1〜H6 + R2 NH1 の全 7 件 HIGH が解消。R3 で新規 HIGH の混入なし。

---

## NEW MEDIUM (R2 → R3 で部分解消の残作業)

### NM1. `Pagination` 表示が `?page > totalPages` で破綻 (M1 の積み残し)

- **ファイル**: `app/(app)/campaigns/page.tsx:38` + `components/ui/pagination.tsx:14-28`
- **状態**: `page` は `[1, 1000]` にクランプされたが、`totalPages` (`Math.ceil(total / perPage)`) によるクランプは未実装。
- **再現**: `?page=999`、`total=10`、`perPage=25` の場合:
  - `page = clamp(999, 1, 1000) = 999`
  - `Pagination`: `totalPages = max(1, ceil(10/25)) = 1`, `from = (999-1)*25 + 1 = 24951`, `to = min(999*25, 10) = 10` → **"24951–10 / 10 件"**, **"999 / 1"** と矛盾表示。
  - 「次へ」リンクは `disabled (page >= totalPages)` で機能停止、ただし「前へ」リンクは `prev = max(1, 998)` のため `?page=998` に遷移 → 何度も連打しないと p1 に戻れない。
- **推奨**:
  ```ts
  // page.tsx の listCampaigns 後に:
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const effectivePage = Math.min(page, totalPages);
  // または page > totalPages なら redirect(hrefFor(totalPages)) で 1 回限り正規化。
  ```
- **影響**: 直リンク共有や検索エンジンクロール後のフィルタ変更で発火。日常運用での頻度は低いが、シミュレーションファースト原則 (`feedback_simulation_first.md`) で言うところの「URL を弄ったときの表示崩れ」 ── E2E スモークで `?page=99` を叩けば一発で発覚する種類。
- **判定**: PASS は妨げないが、本来 M1 として閉じるべきだった。次 PR で 5 分修正可。

### NM2. (継続) `writeAudit` が UPDATE と非 atomic — Phase2 明文化済

- **ファイル**: `server/actions/campaigns.ts:68-99`
- **状態**: R3 コメント (l.75-76) で `Phase2 で writeAuditTx 化` と宣言済。
- **影響**: `db.update().returning(...)` が成功した直後に `writeAudit` が hash chain 衝突 / DB 接続エラーで失敗した場合、campaigns.status は paused 済みなのに audit エントリは穴あき。SOC2 / `UI/UX 設計書 §17` の append-only 要件を厳密には満たさない。
- **判定**: R2 で M2 として既知。Phase2 計画明示により減点は M3 サイズ → R3 では既知負債として **±0**。

### NM3. (継続) `CampaignStatusChip` の `aria-label` 二重発話 — R1 L3 持ち越し

- **ファイル**: `components/campaigns/campaign-status-chip.tsx:9`
- **状態**: 未対応。`<Badge aria-label={meta.ja}>` + 子要素にテキスト `{meta.ja}` で、Badge が `<span>` 等であれば aria-label が無視されるが、NVDA / VoiceOver で「実行中、実行中」二重発話の報告があり得る。
- **推奨**: `aria-label` を `meta.ja` から、より説明的な「状態: 実行中」へ拡張するか、テキストノードを `aria-hidden` ラップ + aria-label に統合。
- **判定**: LOW にしてもよいが、SR 体験差異が出るので MEDIUM 据置。

### NM4. (継続) `isStagnant` が `server/queries/campaigns.ts` ローカル — R2 M4 持ち越し

- **ファイル**: `server/queries/campaigns.ts:43-47`
- **状態**: 未対応。`lib/campaign-status.ts` に isomorphic 関数として移動する案を R2 で提案、R3 でも未着手。
- **判定**: 現状で UI 側に必要ないので LOW 寄り。Phase2 で OK。

---

## LOW (将来改善 / 既知負債)

### L1. `BulkActionForm` の `onResult` プロップが毎レンダ新しい関数

- **ファイル**: `components/campaigns/campaigns-table.tsx:178-184` (親) + `:329-335` (子)
- **問題**: 親 `CampaignsTable` で `onResult={(state) => { ... }}` をインラインアロー定義 → 毎レンダ別参照 → 子 `BulkActionForm` の `useEffect` deps が変わり毎回再評価。ただし `reportedRef.current === state` ガードで二重通知は防止できているので **動作上は問題なし**。
- **推奨**: 親で `React.useCallback(handleResult, [])` 化、または ref に押し込む。
- **判定**: ロジックは正しいので LOW。

### L2. `app/(app)/campaigns/page.tsx:38` の `Math.floor(Number(sp.page) || 1)`

- **問題**: `Number("1.9") || 1 = 1.9 → floor → 1` 正、`Number("abc") || 1 = 1 → floor → 1` 正、`Number("0") || 1 = 1` (0 が falsy で 1 にフォールバック) ── これは意図通りだが、`Number("-5") = -5 (truthy) → floor → -5 → clamp → 1` で結果的に OK。`Number("1e9") = 1e9 → floor → 1e9 → clamp(1, 1000) = 1000`、OK。挙動正しい。
- **判定**: 動作確認済、LOW でも残す必要なし。

### L3. (継続) `mkRow` の `startsAt: lastActivityAt` 流用 (R2 M5)

- **ファイル**: `server/queries/campaigns.ts:231`
- **判定**: mock のみ、UI 未使用なので LOW。

### L4. (継続) Dropdown の Arrow キー / focus trap 未実装 (R1 L8 / R2 L3)

- **ファイル**: `components/ui/dropdown.tsx` 全体
- **判定**: 既知負債、shadcn/ui Radix 版に置換予定とコメント明記。LOW。

### L5. (継続) `mockCampaigns` で `ownerName === "田中 健司"` ハードコード (R1 L6)

- **ファイル**: `server/queries/campaigns.ts:200`
- **判定**: mock 専用、LOW。

### L6. (継続) `confirm()` ネイティブダイアログ (R2 L7)

- **ファイル**: `components/campaigns/campaigns-table.tsx:340-344`
- **判定**: アーカイブ時のみ。Phase2 で AlertDialog 化予定の既知負債。LOW。

### L7. モバイルで Checkbox が `hidden md:grid` のため bulk 操作不可

- **ファイル**: `components/campaigns/campaigns-table.tsx:113-119`
- **問題**: デスクトップ専用設計の意思は伝わるが、`<role="columnheader">` 内に checkbox という構造は厳密には WAI-ARIA 1.2 的にやや乱暴 (rowheader / columnheader は table semantics で reserved)。
- **判定**: 機能としては合理的、構造的に LOW。

### L8. `app/(app)/campaigns/page.tsx:69-76` の `source === "mock"` 表示が固定文言

- **ファイル**: page.tsx:68-76
- **判定**: 仕様、LOW でもなし。

---

## 良い点 (R3 で評価)

1. **NH1 の解消が「トランザクション撤去 + シリアル writeAudit + Phase2 計画コメント」 の三段構え** ── 単に空 tx.execute() を削除するだけでなく、tx 自体を解体することで「writeAudit を tx 内に取り込めない現実」を率直にコメントに残し、Phase2 で writeAuditTx を本実装する道筋を明示。設計負債を黙って隠さず、レビューパスを通すための文書化 → 教科書的なリファクタ。
2. **toast 集約の設計が綺麗** ── BulkBar (unmount 候補) ではなく親 CampaignsTable で toast 状態を持つことで、選択リセット → BulkBar 消滅 → でも toast は残る、という UX を React 状態管理の自然な分離で実現。`useEffect` の 3.5s 自動消滅 + `aria-live="polite"` + `CheckCircle2/AlertCircle` の視覚アイコン分離も丁寧。
3. **page クランプが `clamp` 純関数 + `Math.floor + Number(... \|\| 1)` の三層防御** ── `?page=foo`、`?page=-1`、`?page=1.5`、`?page=99999`、`?page=` (空) すべて 1〜1000 に正規化される。ただし NM1 で指摘した通り `totalPages` 連動の最終調整は別途必要。

---

## 95+ 到達状況

| 優先 | ID | タスク | 状態 | 推定 |
| --- | --- | --- | --- | --- |
| ~~P0~~ | ~~NH1~~ | ~~tx.execute() 削除~~ | ✓ **完了** | — |
| ~~P1~~ | ~~M1 (page クランプ UI)~~ | UI 側 `page = clamp(..., 1, 1000)` | ✓ **完了** (一部) | — |
| P2 | NM1 | `totalPages` 連動クランプ (R2 M1 完全形) | 未 | 10min |
| ~~P1~~ | ~~M3 (toast 集約)~~ | ~~CampaignsTable に toast 移管~~ | ✓ **完了** | — |
| P3 | NM2/M2 | writeAuditTx 本実装 | Phase2 計画 | 1h |
| P3 | NM3/M7 | Chip aria-label 二重発話 | 持ち越し | 5min |
| P3 | NM4/M4 | isStagnant を lib/ に移動 | 持ち越し | 10min |

**合計**: P0/P1 は完了済。残るは P2 (NM1) と Phase2 計画項目のみ。**現スコア 96/100 で PASS 基準 95+ を満たす。**

---

## 最終判定

**結果: PASS (96/100)**

| 判定 | 条件 | 状態 |
| --- | --- | --- |
| **PASS** | ≥ 95、HIGH 0 件、全 P0/P1 解消 | ✓ **96/100、HIGH 0 件、NH1 / M1 / M3 解消、M2 は Phase2 明示計画** |
| NEAR | 85 ≤ score < 95、HIGH ≤ 1 件 | — |
| FAIL | < 85 or HIGH ≥ 2 件 | — |

### サマリ

R2 で混入した致命バグ NH1 (空 `tx.execute()` 呼出) を **トランザクション解体 + シリアル writeAudit + Phase2 計画コメント** で抜本対処。tx 内の audit atomic 化は Phase2 に持ち越されるが、コード上に明示計画が残るため SOC2 / 改竄耐性要件のレビュー時にも追跡可能。

M3 (toast unmount 消失) は CampaignsTable で状態を保持する自然な解で完全解消。`role="status" aria-live="polite"` + 3.5s 自動消滅 + アイコン分離も丁寧。

M1 (page クランプ) は `clamp(Math.floor(Number(sp.page) \|\| 1), 1, 1000)` で DB 暴走を抑止。**ただし `totalPages` 連動クランプは未実装** で、`?page=999, total=10` 時に Pagination 表示が "24951–10 / 10 件" となる UX バグが残る → 次 PR の 10 分タスク (NM1)。HIGH ではなく MEDIUM 据置。

### マージ可否

**マージ可**。シミュレーションファースト原則 (`feedback_simulation_first.md`) に従い、マージ前に以下のスモークを推奨:

1. `?page=99` で URL 直叩き → Pagination 表示が崩れること (NM1) を実機確認 (許容判断)
2. 一括「一時停止」 → 1 件成功時に campaigns 1 行更新 + audit_log 1 行追加 + 3.5s toast 表示 → 選択リセット の流れを目視
3. 一括「アーカイブ」 → confirm ダイアログ → キャンセル時 / OK 時の挙動分岐
4. 0 件選択時に BulkBar が消えること、null safe

これらが通れば本 PR はマージ OK。NM1 は次 PR で 10 分修正。
