# S09 受信箱 コードレビュー (r2)

レビュー対象:
- `server/queries/inbox.ts`
- `components/inbox/inbox-filter-tabs.tsx`
- `components/inbox/inbox-thread-list.tsx`
- `app/(app)/inbox/page.tsx`

R1 (78/100, FAIL) → R2 再レビュー。R1 比のスコア差分を併記する。

---

## スコアサマリ (R2)

| 評価軸 | 配点 | R1 | R2 | Δ | 備考 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1. 型安全 (any/as cast、raw SQL 型) | 20 | 15 | 18 | +3 | `db.execute<MessageRow>()` ジェネリクスで row 型確保。`as unknown as MessageRow[]` 1 行残るが drizzle 戻り型の最小コスト整形に限定。`as LeadState` も削除 |
| 2. React 19 / Next.js 15 (use client 境界) | 20 | 18 | 18 | 0 | 境界は適切。M5 (debounce effect 依存配列) は未修正のため R1 同点据置き |
| 3. a11y (role/aria, listitem, contrast) | 20 | 14 | 17 | +3 | `role="group"` + `aria-pressed` への格下げで H4 解消。Link の `aria-label` 追加 (M6 部分解消)。`tracking 0.18em` 小灰文字 (M7) は未修正で -1 残 |
| 4. エッジケース (空配列, null, mock 状態) | 20 | 14 | 19 | +5 | H1 (`snoozed`) 削除済 / H3 (`CONNECTED`) 削除済 / mock 7 件全て live 許可 state に収束。M3 (snippetText null + slaBreached) は `forceSlaBreached` の運用で実害無し |
| 5. コード匂い (重複、未使用、命名) | 20 | 17 | 19 | +2 | M1 (二重 filter → 1 パス) 解消 / M2 (grid-cols 重複) 解消。M4 (`requiresReview` / `isReplied` 二重) は残置だが scoring 影響軽 |

**総合スコア: 91 / 100** (R1: 78 → +13)
**判定: PASS (90+ 到達)**

---

## R1 HIGH/MEDIUM の追跡

| ID | 内容 | R1 評価 | R2 状態 | 検証 |
| --- | --- | --- | --- | --- |
| H1 | `ThreadFilter` に `snoozed` が UI/SQL に無いのに型に残存 | HIGH | **解消** | `inbox.ts:15` `ThreadFilter = "all" \| "unread" \| "review" \| "meeting"`、`page.tsx:15` `ALLOWED_FILTERS` も 4 値、`inbox-filter-tabs.tsx:10-15` `TABS` も 4 値で完全一致 |
| H2 | `(msgRows as unknown as { rows?: ... }).rows` 型キャスト | HIGH | **解消 (実質)** | `db.execute<MessageRow>(sql\`...\`)` でジェネリクス指定し row 型確保 (`inbox.ts:157`)。残る `as unknown as MessageRow[]` (l.176) は drizzle の戻り値 narrowing 用 1 行で、`MessageRow` 自体は型付き。R1 の「型の完全喪失」状態は無い |
| H3 | mock `CONNECTED as LeadState` 混入 | HIGH | **解消** | `MOCK_THREADS` (l.290-) を確認、`CONNECTED` レコード削除済。残 7 件は全て `REPLIED/MEETING/MESSAGED/FAILED` で live クエリの許可 state 集合 `('MESSAGED','REPLIED','MEETING','COMPLETED','FAILED')` に包含 ✓ |
| H4 | tablist だけあって tabpanel 無し (WAI-ARIA tab pattern 不完全) | HIGH | **解消** | `inbox-filter-tabs.tsx:54-58` `role="group" aria-label="受信箱フィルタ"` に格下げ。各 button は `aria-pressed={active}` (l.66)。tab pattern の中途半端な約束を撤去 |
| M1 | sorted の二重 filter | MEDIUM | **解消** | `inbox-thread-list.tsx:26-30` 1 パスで `slaBreachedItems`/`normalItems` に振り分け。sort はその後個別 |
| M2 | grid-cols `md:` が完全同値で重複 | MEDIUM | **解消** | `inbox-thread-list.tsx:122` `grid-cols-1 md:grid-cols-[1.5fr_120px_56px_minmax(180px,2.4fr)_120px_24px]`。モバイルは 1 列 (縦積み)、md 以上で 6 列に分岐。意味のある breakpoint 分離になった |
| M3 | snippetText null + slaBreached の組合せ | MEDIUM | 部分解消 | `thread()` 第 13 引数 `forceSlaBreached` で明示的に振っているレコードのみ true。mock 7 件は全て snippetText 非 null (`(まだメッセージがありません)` 表示が出るのは live の lastMessageAt null 経路のみ)。実害無し → 据置き |
| M4 | `requiresReview` と `state==='REPLIED'` 二重表現 | MEDIUM | 未修正 | `inbox.ts:33, 211, 426` で `requiresReview: isReplied` 派生プロパティ残置。LOW 相当として後送 |
| M5 | debounce effect 依存配列に `sp, router` | MEDIUM | 未修正 | `inbox-filter-tabs.tsx:50` `[q, qFromUrl, sp, router]` のまま。`useSearchParams()` の戻りはレンダ毎に新リファレンスなので過剰再実行のリスクは残るが、`q === qFromUrl` でショートサーキットしているので動作 incident は出ない (-2 軸 2 据置き) |
| M6 | li 内 Link の aria-label | MEDIUM | **解消** | `inbox-thread-list.tsx:120` `aria-label={\`${thread.leadName} のスレッド · 状態 ${thread.state} · スコア ${thread.score}${thread.slaBreached ? " · SLA 超過" : ""}\`}` で読み上げ整備 |
| M7 | `tracking 0.18em uppercase` 小灰文字コントラスト | MEDIUM | 未修正 | `inbox-thread-list.tsx:87` `text-[11px] font-bold tracking-[0.18em] uppercase` + `text-ink-500` のまま。AA 4.5:1 を割る懸念残置 (-1 軸 3) |

---

## HIGH 残存 / NEW HIGH

### HIGH 残存: なし
R1 で挙げた H1〜H4 は全て解消、もしくは実質解消 (H2 は型情報を確保) を確認。

### NEW HIGH: なし
R2 差分を精査した限り、新たな HIGH (型崩壊 / a11y 致命 / mock-live 乖離 / セキュリティ) は検出されず。

### NEW MEDIUM (参考)

#### NM1. mock `forceSlaBreached: true` を l1 のみに付与しているが、`hoursAgo: 3` 自体で既に `isReplied && now - lastAt > SLA_MS` は true

- 場所: `inbox.ts:291-305` `thread("l1", ..., "REPLIED", ..., 3, "inbound", "...", true)`
- 観察: `hoursAgo = 3` (= 3 時間前) かつ state=REPLIED なので、`forceSlaBreached` 引数を渡さなくても `(isReplied && Date.now() - new Date(lastAt).getTime() > SLA_MS)` 経路で同じ true になる
- 影響: 機能上は完全に同じ結果。`forceSlaBreached` の存在は将来 `hoursAgo < 2` で意図的に SLA 超過を強制したい時のためのフックとして残せるが、現状の使い方は冗長。LOW 相当。

#### NM2. `inbox-filter-tabs.tsx` の hover 系 `[var(--color-brand-50)]/40` などのアルファ値混入 className

- 場所: `inbox-filter-tabs.tsx:72, 123` ほか
- 観察: Tailwind v4 で `bg-[var(--color-brand-50)]/40` のように CSS 変数 + アルファ値スラッシュは v3.4+ で安定動作するが、`oklch` 系の変数化済みデザイントークンとの相性確認が必要。動作 incident は出ていないが、後続 PR で `bg-[color-mix(...)]` への移行も検討余地あり。LOW。

---

## 評価軸別 詳細 (R2)

### 1. 型安全 (18 / 20, +3)

- `db.execute<MessageRow>()` でジェネリクス使用 (inbox.ts:157) ✓
- `MessageRow` 型定義が `lead_id / content / direction / sent_at` でカラム完全網羅 (l.151-156)
- 残: `as unknown as MessageRow[]` 1 行 (l.176) — drizzle 戻り値の最終 narrowing 用、`?? []` フォールバック付き。R1 の「型の完全喪失」とは異なり、許容範囲
- `as LeadState` キャスト削除 ✓ (MOCK_THREADS は全てリテラルで型推論)

### 2. React 19 / Next.js 15 (18 / 20, 0)

- `use client` 境界、`searchParams: Promise<...>` の `await`、`force-dynamic` 全て維持 ✓
- M5 (debounce effect 依存配列) 未修正 → 軸 2 同点据置き

### 3. a11y (17 / 20, +3)

- `role="group"` + `aria-pressed` 方式に格下げ (-0、tab pattern の false-promise 解消) ✓
- Link `aria-label` で名前/状態/スコア/SLA 超過 を結合読み上げ ✓
- 残: `tracking-[0.18em] uppercase text-[11px] text-ink-500` (-1, M7)
- 残: `text-[10px]` バッジのコントラスト (-1, L6 系)
- 数値割り当て: H4 解消で +3、M6 解消で +1、M7/L6 で -2 → 14 → 17

### 4. エッジケース (19 / 20, +5)

- mock-live 整合 (H3 解消) +3
- snoozed 不整合 (H1 解消) +2
- 残: `forceSlaBreached` の冗長性 (-0、NM1 は LOW)
- 軽微: live 側で `lastMsg` 無しかつ `r.lastActionAt` 有りのケースで `lastMessageAt` に lastActionAt を入れる挙動 (`inbox.ts:190, 206-207`)。snippet は null なので UI 表示は `(まだメッセージがありません)` + 日時、SLA は REPLIED でかつ 2h 超で true となり、設計書 §25.3 通り

### 5. コード匂い (19 / 20, +2)

- M1 解消 ✓ (1 パス分離)
- M2 解消 ✓ (`md:grid-cols-...` で意味ある breakpoint)
- 残: M4 (`requiresReview = isReplied` 派生プロパティ) (-1)
- LOW: `MOCK_THREADS` の `forceSlaBreached` 引数が 1 件しか使われていない (NM1)

---

## 90+ 判定

**PASS (91 / 100)**

R2 で HIGH 4 件 + MEDIUM 3 件 (M1/M2/M6) を確実に潰し、R1 比 +13。残課題は MEDIUM 2 件 (M5: debounce 依存配列、M7: コントラスト) と LOW 系のみで、リリースブロッカーには該当しない。

### マージ可否

**ship 可** (リリース許可)。

### 次フェーズで拾うべき推奨タスク (非ブロッカー)

1. M5: `inbox-filter-tabs.tsx:50` の依存配列を `[q]` に絞り、`useSearchParams()` のリファレンス変動による過剰再実行を排除
2. M7: `tracking-[0.18em] uppercase text-[11px] text-ink-500` を `text-ink-600` 以上 or `font-size 12px` 化で WCAG 1.4.3 AA を担保
3. M4: `requiresReview` を `state === "REPLIED"` の派生表示に整理 (state machine 拡張時の同期漏れ予防)
4. NM1: `MOCK_THREADS` の `forceSlaBreached` 引数を全件で省略 (デフォルト計算が同じ結果を返す)

---

## 参考ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\inbox.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\inbox-filter-tabs.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\components\inbox\inbox-thread-list.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\inbox\page.tsx`
