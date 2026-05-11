# S07 リード一覧 — 精密コードレビュー (r2)

- **対象**: `app/(app)/leads/page.tsx`, `components/leads/{leads-table,leads-filter-bar,lead-drawer}.tsx`, `server/queries/leads.ts`, `server/actions/leads.ts`, `lib/state-machine.ts`
- **レビュー日**: 2026-05-11
- **判定**: **PASS (95 / 100)** — 90+ 目標を **+7 上回って到達**。R1 の HIGH/LOW 5 件は全て解消、残るのは S04/S05 と同質の "Phase2 で対処可" 級の MED/LOW のみ。

---

## R1 → R2 差分サマリ

| R1 件名 | R1 状態 | R2 状態 | 検証ポイント |
|---|---|---|---|
| HIGH-1 LeadDrawer フォーカストラップ | 未対応 | **解消** | `dialogRef`/`previousFocusRef` + 初期 focus + cleanup で `previousFocusRef.current?.focus()` 復元 (`lead-drawer.tsx:27-66`)、Tab/Shift+Tab トラップを `onKeyDown` で実装 (L69-87) |
| HIGH-2 `getLeadById` UUID 前段ガード | 未対応 | **解消** | RFC 4122 準拠の `UUID_RE = /^[0-9a-f]{8}-...-[1-5][...]-[89ab][...]/i` を `server/queries/leads.ts:12-13` で定義、`getLeadById` L182 で `if (!UUID_RE.test(leadId)) return null` ガード、22P02 完全撲滅 |
| MED-1 `leadStateLabel` 重複 | 未対応 | **解消** | `leadStateLabel` 関数は完全削除、`LEAD_STATE_OPTIONS` が `STATE_SHORT_LABEL[s]` を直接参照 (`server/queries/leads.ts:308-311`)、`STATE_SHORT_LABEL` は `state-machine.ts:104-106` で `STATE_META.ja` から派生 → single source of truth 確立 |
| LOW-1 score - 56 内訳の数学的不整合 | 未対応 | **解消** | 4 軸 breakdown UI を撤去し progressbar 1 本に集約 (`lead-drawer.tsx:193-205`)、`role="progressbar"` + `aria-valuenow/min/max` で a11y semantics も向上。注記文に "(職種一致 / 会社規模 / シグナル / Engagement) の詳細表示は Phase2" で意図を明示 |
| LOW-2 未使用 import | 未対応 | **解消** | `ilike`/`inArray` を `server/queries/leads.ts:2` から削除 (`and, desc, eq, gte, sql` のみ)、`TrendingUp`/`Badge` は対象ファイル群に元から存在せず (R1 の指摘範囲確認済) |

**全 5 件で潰れ漏れなし**。LOW-3〜LOW-7 は R1 で減点 0 のため対応不要扱い。

---

## R2 総合スコア

| # | 評価軸 | 配点 | R1 | R2 | Δ | 主な減点要因 (R2 残) |
|---|---|---:|---:|---:|---:|---|
| 1 | 型安全 | 20 | 17 | **19** | +2 | `q`/`campaignId` 任意型に対する `LeadState \| ""` 強制キャスト 1 箇所のみ (`page.tsx:37`)、それ以外は import 整理・UUID_RE で型制約強化 |
| 2 | React 19 / Next 15 | 20 | 18 | **19** | +1 | `useEffect([open])` cleanup での focus 復元は SSR 安全 + React 19 strict-mode で二回走るがべき等 (`focus()` は idempotent)。Suspense 不採用は Phase2 範囲 |
| 3 | a11y | 20 | 16 | **20** | +4 | フォーカストラップ + 戻り先復元 + progressbar 正式 semantics で **満点**。`<main aria-hidden>` は Phase2 で許容 |
| 4 | エッジケース | 20 | 17 | **19** | +2 | UUID ガード解消、score 内訳の数学的整合性問題は撤去で消滅。残りは `page.tsx:43` `drawerLeadId` の長さ上限なし (string そのまま `getLeadById` に渡るが UUID_RE で弾かれるので実害なし) |
| 5 | コード匂い | 20 | 20 | **18** | -2 | `listLeads`/`getLeadById` の SELECT 句 10 列重複 (MED-A、R1 MED-2 と同一)。R1 では満点維持としていたが、R2 で他軸が伸びた分こちらに転嫁して可視化 |

**合計: 95 / 100** → **PASS** (R1 比 +7)

> Note: R1 では 5 軸のうち コード匂い を 20 で打ち切っていたが、R2 では a11y/エッジが満点近くに伸びたので、SELECT 句重複を MED として正面から計上した。減点と引き換えに **将来バグ回避レバー** を明示する形。

---

## HIGH 残存 / NEW HIGH

**HIGH 残存: 0 件**
**NEW HIGH: 0 件**

R2 で新規に発見した致命級は無し。フォーカストラップが `<aside>` の `onKeyDown` ハンドラに依存する点も、`tabIndex={-1}` の overlay button を除外する設計のおかげで抜け道なし。

---

## R2 で確認できた改善ハイライト

1. **フォーカストラップの正当性**: `dialogRef.current` を `useRef<HTMLElement>` で型付け、callback ref で代入する形 (`lead-drawer.tsx:105-107`)。React 19 の ref-as-prop 移行を意識した実装で、`<aside ref={(el) => { dialogRef.current = el; }}>` は意図的に書かれている。
2. **focus 復元の cleanup タイミング**: `return () => { previousFocusRef.current?.focus?.(); }` は `open` が false に切り替わった瞬間 (Esc / overlay click / route 変更) に走る。**`router.push` で URL から `?lead=` が消える → 親 server component 再描画 → `open={!!drawerLeadId}` が false** という流れで自然に動く。
3. **UUID_RE の厳密版採用**: R1 提案の `/[0-9a-f]{8}-.../i` よりも厳しい RFC 4122 v1-v5 + reserved variant チェック (`[1-5]` + `[89ab]`) を採用。**mock id "l1" 等は DB 未接続時のみ通すため、`db && orgId` 分岐の後ろに置く設計** が正しい (L177-182)。
4. **progressbar a11y**: `role="progressbar"` + `aria-valuenow={lead.score}` + `aria-valuemin={0}` + `aria-valuemax={100}` + `aria-label="AI 適合スコア"` で WCAG 1.3.1 + 4.1.2 完全クリア。
5. **import 整理の徹底**: `server/queries/leads.ts:2` は `and, desc, eq, gte, sql` のみ、不要 import ゼロを確認。

---

## R2 残存の MED/LOW (PASS には影響なし)

### MED-A (= R1 MED-2) — `listLeads`/`getLeadById` の SELECT 句重複

- **箇所**: `server/queries/leads.ts:92-117` (listLeads) と `185-208` (getLeadById)
- **症状**: 同じ 10 列の `.select({...})` + `leftJoin(campaigns).leftJoin(users)` を二重定義。schema 追加時の事故率高。
- **修正は R3 もしくは Phase2 起票で十分**。`sharedLeadColumns` 抽出 + `mapLeadRow` ヘルパ化で 30 行削減見込み。
- **減点**: コード匂い −2

### MED-B (= R1 MED-3) — `hrefFor` が `URLSearchParams(sp.toString())` ベースでない

- **箇所**: `page.tsx:60-68`
- **症状**: 将来 `?sortBy=...` 等の query を導入したとき drop される。`LeadDrawer.close` は既に `sp.toString()` ベースで正しい (`lead-drawer.tsx:31-33`) ので非対称。
- **修正**: `const params = new URLSearchParams(sp.toString()); ... params.set("page", String(p));` に揃える (5 分)。
- **減点**: 0 (R1 同様、将来コスト計上のみ)

### LOW-A — `useEffect([rows])` 浅比較

- **箇所**: `leads-table.tsx:33-44`
- **症状**: 親が新配列を毎回作るので毎レンダー走る。bail-out で safe だが GC コスト。
- **減点**: 0 (R1 LOW-5 と同じ判定)

### LOW-B — `Q_MAX_LEN`/`PAGE_MAX` がファイル内定数で重複定義の余地

- **箇所**: `server/queries/leads.ts:45-46`、`app/(app)/leads/page.tsx:39-41` (こちらは `120`/`2000` ハードコード)
- **修正**: `lib/limits.ts` に集約。
- **減点**: 0

---

## 90+ 判定

- **R2 スコア: 95 / 100 → PASS**
- HIGH 残 0 / NEW HIGH 0 / a11y 満点 / エッジ 19。**S07 commit & push に進んで OK**。
- MED-A/MED-B は S04/S05 と同質の "Phase2 で潰す" 級。R3 を回さずに、SELECT 共通化 + `hrefFor` 全 query 引き継ぎ + `lib/limits.ts` をまとめて別 PR で起票するのが ROI 高。

---

## R3 (任意) で 97+ を狙う最短ルート

| # | 項目 | 工数 | 期待 +点 |
|---|---|---|---|
| 1 | MED-A: `sharedLeadColumns` + `mapLeadRow` 抽出 | 15 min | コード匂い +2 |
| 2 | MED-B: `hrefFor` を `URLSearchParams(sp.toString())` ベースに | 5 min | 型安全 +0.5 |
| 3 | LOW-B: `lib/limits.ts` で `Q_MAX_LEN`/`PAGE_MAX`/`PER_PAGE` 統合 | 10 min | 型安全 +0.5 |

合計 ≈ 30 分で **97-98 / 100** 着弾見込み。ただし **本タスクの "90+" 目標は既に達成済** のため、R3 はオプション扱い。
