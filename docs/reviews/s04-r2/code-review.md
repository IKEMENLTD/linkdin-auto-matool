# S04 キャンペーン一覧画面 — 精密コードレビュー (s04-r2)

レビュー対象コミット / レビュー日: 2026-05-11
前回レビュー: `docs/reviews/s04-r1/code-review.md` (72/100)
レビュー対象ファイル:

- `app/(app)/campaigns/page.tsx`
- `components/campaigns/campaigns-table.tsx`
- `components/campaigns/campaigns-filter-bar.tsx`
- `components/campaigns/campaign-status-chip.tsx`
- `components/ui/{checkbox,dropdown,pagination,select}.tsx`
- `lib/campaign-status.ts`
- `lib/utils.ts` (escapeLikePattern / clamp 追加)
- `lib/audit.ts` (AuditAction union 拡張)
- `server/queries/campaigns.ts`
- `server/actions/campaigns.ts`

---

## 総合スコア: **89 / 100** (R1: 72 → R2: 89 / **+17**)

| 評価軸 | 配点 | R1 | R2 | 主な改善点 / 残課題 |
| --- | --- | --- | --- | --- |
| 1. 型安全 (any/as castなし、Drizzle型) | 20 | 14 | 18 | `as unknown as string` 撤去 (H6 解消) / `startsAt.toISOString()` 直接適用 / `escapeLikePattern` 純関数化 ── 残: `as Date \| null` (許容範囲だが不要)、`leadsTotal/hitlState/startsAt` 露出 |
| 2. React 19 / Next.js 15 (use client境界、Server Action 戻り型) | 20 | 12 | 14 | `useActionState` + `useFormStatus` で BulkBar 配線 (H1 解消)、dead hidden input 撤去 (H2 解消) ── **残: tx 内に空の `tx.execute()` 呼出し (runtime crash 確定)**、tx 外 writeAudit による audit 整合性ギャップ、BulkBar アンマウントで成功メッセージが消える |
| 3. a11y 詳細 (role/aria/keyboard) | 20 | 12 | 18 | Dropdown nested interactive 撤去 (H3 解消) / `role="columnheader"` 整備 / モバイル要約をリンク内に統合 (H4 解消) / 停滞バッジ `role="img"` + `aria-label` ── 残: `role="table"` ルート欠落、Chip `aria-label` 二重発話 |
| 4. エッジケース (空配列、null、フィルタなし、選択ゼロ) | 20 | 17 | 18 | filter-bar の q 同期 effect 追加 (M4 解消) / server クエリで `clamp(safePage, 1, 1000)` / `try/catch` で degraded ── 残: **page 値の UI 側クランプ無し → `?page=999` で "24951–10 / 10 件" 表示** |
| 5. コード匂い (重複、未使用、命名) | 20 | 17 | 21→**20** | `isStagnant` 純関数抽出 (M1 解消) / audit action 別名化 (H5 解消, `campaign.paused`/`resumed`/`archived`) / `confirm` 危険操作だけ ── 残: `mkRow` で `startsAt: lastActivityAt` 流用 (微妙な意味のズレ)、`leadsTotal` 依然未使用 |

> **R1 HIGH 6件は全て解消** (H1〜H6 すべて確認済)。ただし R2 で **新規 HIGH 1件** (NH1: 空 `tx.execute()` による runtime crash) が混入。これを潰せば 95+ 到達。

---

## R1 HIGH 解消確認

| ID | R1 指摘 | R2 状態 | 確認箇所 |
| --- | --- | --- | --- |
| H1 | BulkBar 未結線 (alert のみ) | **解消** | `campaigns-table.tsx:217-264` BulkBar + `BulkActionForm` (`useActionState`+`useFormStatus`)。`bulkPauseCampaigns` / `bulkResumeCampaigns` / `bulkArchiveCampaigns` を `<form action={formAction}>` で結線、`pending` でスピナ、`state.message` で成功/失敗トースト相当を表示。 |
| H2 | dead `<input name="total">` | **解消** | `campaigns-table.tsx` に "total" hidden input は無し。`ids[]` を form 内 hidden input で展開 (l.309-311)。 |
| H3 | Dropdown nested interactive | **解消** | `components/ui/dropdown.tsx:51-61` で `<span role="button">` を撤去し直接 `<button type="button" aria-haspopup="menu" aria-expanded={open}>` に。`triggerClassName` / `triggerAriaLabel` API 経由で呼出側 (RowActions / 保存ビュー) は `<button>` を渡さず `ReactNode` (テキスト / Icon) のみを描画 → ネスト消滅。 |
| H4 | モバイル行リンク常時非表示 | **解消** | `campaigns-table.tsx:127-134` モバイルでは `md:hidden` の要約ブロックを `<Link>` 内に統合。`hidden md:hidden` の絶対配置 `<a>` は撤去。`<li>` も `relative` に維持しつつ、モバイル時は名前の `<Link>` 自体がフル幅のタップ対象。 |
| H5 | audit action が "campaign.launched" 固定 | **解消** | `lib/audit.ts:6-24` に `campaign.paused` / `campaign.resumed` / `campaign.archived` を追加。`server/actions/campaigns.ts:116, 130, 144` で各アクションに正しい `auditAction` を渡している。1 ID = 1 audit エントリも `for (const row of updated) writeAudit(...)` で担保。 |
| H6 | `new Date(a.lastAt as unknown as string)` 二重キャスト | **解消** | `server/queries/campaigns.ts:133` で `a.lastAt as Date \| null`、`r.startsAt.toISOString()` 直接呼出 (l.150)。`unknown` 経由のキャストは撲滅。 |

R1 HIGH の **対応漏れは 0**。フォローアップ系 (ilike エスケープ / page クランプ部分 / try/catch degraded / columnheader / aria-label 停滞) も全て確認できた。

---

## NEW HIGH (R2 で混入 — PR ブロッカー)

### NH1. Bulk Action のトランザクション内に **空の `tx.execute()` 呼出し** がある → 必ず runtime crash する

- **ファイル**: `server/actions/campaigns.ts:78-83`
- **コード**:
  ```ts
  for (const row of result) {
    await tx.execute(
      // 監査は writeAudit を直接呼びたいが、tx 内で同一 client を使うため
      // ここでは insert を直接行う簡略実装。Phase2 で writeAuditTx に差し替え。
    );
  }
  ```
- **問題**:
  1. Drizzle 0.36 の `tx.execute(sql)` は **`SQL` チャンクを必須**にする。引数なし呼出は型エラー (tsc が通るなら strict 設定が緩い証拠) ── runtime では `Cannot read properties of undefined (reading 'toSQL')` 系で投げる。
  2. 結果: **`bulkPauseCampaigns` を `affected > 0` の状態で実行すると常に例外** → `catch` ブロックで `kind: "fail"` + "処理中に問題が発生しました…" を返す。 ただし `update` は既に発行済みなので、**campaigns.status は paused に変わり、audit は書かれず、UI には失敗メッセージが出る** という整合性最悪のケース。
  3. シミュレーションファースト原則 (memory: `feedback_simulation_first.md`) で言うところの「実機でチェック → 一時停止クリック → DB 変わるが画面はエラー → 二度押し → 二重監査ログ」 の温床。
- **影響範囲**: `bulkPauseCampaigns` / `bulkResumeCampaigns` / `bulkArchiveCampaigns` 全てが影響。S04 のコア機能 (一括操作) は実質動かない。
- **推奨**:
  ```ts
  // 案A: ループごと削除 (audit は tx 外で良しとする現行設計を素直に反映)
  const updated = await db.transaction(async (tx) =>
    tx.update(schema.campaigns)
      .set({ status: nextStatus })
      .where(where)
      .returning({ id: schema.campaigns.id, name: schema.campaigns.name })
  );
  ```
  または:
  ```ts
  // 案B: tx 内 audit を本実装 (writeAuditTx を切り出して tx を引き回す)
  for (const row of result) {
    await writeAuditTx(tx, { orgId, actorUserId, action, targetId: row.id, ... });
  }
  ```
- **副次問題**: 仮にこのループを消しても、`writeAudit` を **tx の外** で逐次発行している (l.88-97) ため:
  - 例外発生時は campaigns 更新済みだが audit log 未記録 → 監査ログの append-only 保証が破れる。
  - 同一 org の他リクエストが間に入ると prev_hash 競合 → ハッシュチェーン破損。
  - SOC2 / 改ざん耐性ログ要件 (`UI/UX 設計書 §17`) を満たさない。

  → 案B (tx 内 audit) に倒すのが本筋。R2 では「コメントのみ」で実装が無いので、Phase2 へ先送りするなら **そもそもこのループ自体を消す** こと。

---

## HIGH 残存

なし (R1 H1〜H6 全て解消)。

---

## MEDIUM (推奨修正)

### M1. ページ番号の UI 側クランプが未実装 → `?page=999` で "24951–10 / 10 件"

- **ファイル**: `app/(app)/campaigns/page.tsx:37`
- **状態**: 部分対応 (R1 M3)。`listCampaigns` 内で `clamp(safePage, 1, 1000)` を入れて DB 負荷は防げているが、**`page` 変数自体は `Math.max(1, Number(sp.page) || 1)` のまま** で `Pagination` にそのまま流れる。
- **検証**: `?page=999` で `total=10` の場合:
  - `from = (999-1)*25 + 1 = 24951`
  - `to = Math.min(999*25, 10) = 10`
  - 表示: `"24951–10 / 10 件"` (R1 M3 と同じ状態)
- **推奨**:
  ```ts
  // listCampaigns 後に totalPages を計算してクランプ
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const effectivePage = Math.min(totalPages, Math.max(1, Number(sp.page) || 1));
  // Pagination には effectivePage を渡す
  // または page > totalPages なら redirect(hrefFor(totalPages))
  ```

### M2. `writeAudit` が transaction の外 → 監査ログ整合性ギャップ

- **ファイル**: `server/actions/campaigns.ts:69-97`
- **問題**: `db.transaction(...)` 内で campaigns を更新したあと、`writeAudit` は **tx 外** で 1 件ずつ発行 (l.88-97)。`writeAudit` が例外を吐くと、`campaigns.status` は更新済み・audit は未記録の半端状態で `catch` に飛び、ユーザには "処理中に問題が発生しました" と表示される。
- **影響**: NH1 のロジックを撤去しても残る本質的な設計問題。append-only / hash chain の "全ての破壊的変更に対応する audit が必ず存在する" 仕様 (UI/UX 設計書 §17) を破る。
- **推奨**: `writeAuditTx(tx, input)` を `lib/audit.ts` に追加し、`bulkSetStatus` の transaction 内で発行する。あるいは campaigns 更新と audit を分離して**両方失敗時は補正用の audit (`BREAK_GLASS`?) を書く** など、設計指針を明文化。

### M3. BulkBar アンマウントで成功メッセージが消える

- **ファイル**: `components/campaigns/campaigns-table.tsx:217-264, 313-331`
- **問題**: `onComplete()` で `selected` を空にすると `BulkBar` が `if (ids.length === 0) return null;` で消える (l.218)。 → `BulkActionForm` の `state.message` も同時に消滅し、ユーザは「○件を一時停止しました」 のフィードバックを見られない。`completedRef` の 800ms タイマーも、コンポーネントが既に unmount してるので意味なし。
- **推奨**:
  - Toast コンポーネントが Phase2 とのコメントだが、最低限 **Header エリアに `aria-live="polite"` の領域** を出して `useActionState` の `state` を上位 (CampaignsTable) で保持し、選択解除後も 3〜5 秒表示する。
  - or `setTimeout` で `onComplete()` を遅延させ、メッセージが出てから消す。
- **a11y 観点**: `role="status"` / `role="alert"` 自体は OK だが、内部要素が unmount → 即削除 はスクリーンリーダーに読み上げが届かないリスクあり (NVDA はライブリージョン unmount を発火しない場合がある)。

### M4. `lib/campaign-status.ts` に `STAGNANT_MS` / `isStagnant` が無く `server/queries/campaigns.ts` ローカルに留まっている

- **ファイル**: `server/queries/campaigns.ts:40-46`
- **R1 M1 対応**: live/mock 両方から呼べる純関数化 (`isStagnant`) は **達成**。ただし R1 推奨では `lib/campaign-status.ts` に置くことを示唆しており、現状は server-only ファイル内に留まる。
- **影響**: `components/campaigns/campaigns-table.tsx` 等のクライアントから判定したい場合 (e.g. 「停滞のみ表示」フィルタ) は import できない (server-only 制約)。 現時点では UI 側で判定する必要は無いが、`lastActivityAt` が `string \| null` で UI に渡る都合上、フロントで再判定したくなったときに不便。
- **推奨**: `lib/campaign-status.ts` (isomorphic ファイル) に切り出す。

### M5. `mkRow` の `startsAt: lastActivityAt` は意味的に正しくない

- **ファイル**: `server/queries/campaigns.ts:229`
- **問題**: `startsAt` (キャンペーン開始時刻) と `lastActivityAt` (最終アクション時刻) はまったく別の意味だが、mock は前者を後者で代用している。 現在 UI で `startsAt` を使う箇所は無いので実害ゼロだが、将来「開始予定日でソート」を実装するときに mock の挙動が live と乖離する。
- **推奨**: `mkRow` に `startsAt` 引数を追加するか、`startsAt: null` で明示。`leadsTotal` も同様で、`Math.round(sent * 1.4)` の魔数を撲滅し型から削除すべき。

### M6. `Select` の placeholder 二重選択可能 (R1 L2 持ち越し)

- **ファイル**: `components/ui/select.tsx:33-37`
- **状態**: 未対応。 現状は `CAMPAIGN_STATUS_OPTIONS` の先頭が `{ value: "", label: "すべての状態" }` なので placeholder prop は使われていないが、API としては R1 と同じく残る。 LOW でも可。

### M7. R1 L3 (CampaignStatusChip の aria-label 二重発話) 未対応

- **ファイル**: `components/campaigns/campaign-status-chip.tsx:9`
- **状態**: `<Badge aria-label={meta.ja}>` + 内側に `{meta.ja}` テキスト → スクリーンリーダ「実行中、実行中」 と二重読み上げ。
- **推奨**: aria-label を外すか、テキストを `aria-hidden` にして詳細な aria-label を入れる。

---

## LOW (将来改善)

### L1. `as Date | null` (型アサーション) はやや雑

- **ファイル**: `server/queries/campaigns.ts:133`
- **コメント**: `sql<Date | null>` で既に型付けされているので、theoretically この `as` も不要。ただし R1 H6 と違って `unknown` を経由していないので「ナロー化のための明示」と読める範囲。 厳密には `lastAt: a.lastAt` だけで OK のはず。

### L2. `useEffect` で `setQ(qFromUrl)` するパターン (deps: [qFromUrl]) は controlled / uncontrolled の混在

- **ファイル**: `components/campaigns/campaigns-filter-bar.tsx:36-38`
- **問題**: URL → state の片方向同期は OK だが、 ユーザ入力中 (q が変わって debounce 待ち) に他のフィルタが変わって URL の q が更新されると、入力中の文字が上書きされる可能性。 通常運用では問題にならないが、競合ケースを考えるなら `useDeferredValue` or 「IME 確定中はスキップ」 が良い。
- **L 評価**: 実運用では発火しにくいので Phase2 で OK。

### L3. `Dropdown` の focus trap / Arrow キー移動が未実装 (R1 L8 持ち越し)

- **ファイル**: `components/ui/dropdown.tsx` 全体
- **状態**: open 中 Tab で外に出られる / ArrowDown/Up 未対応。 コメント「shadcn/ui の Radix 版に置換予定」明記済 → **既知の負債**として LOW で OK。

### L4. `BulkActionForm` 内 `useEffect` の `completedRef.current = false` 復元タイマー (800ms) は不要

- **ファイル**: `components/campaigns/campaigns-table.tsx:289-296`
- **問題**: `onComplete()` で `BulkBar` 自体がアンマウントされるので、`completedRef` を 800ms 後に false に戻す処理は実行されない (cleanup されない warning が出る可能性)。 アンマウント時の警告は React 19 ではあまり出さないが、ロジックとして dead。
- **推奨**: `setTimeout` を削除し、 `state.resetSelection && !completedRef.current` だけで一回限り発火制御。

### L5. `searchParams.status` のキャストパターン

- **ファイル**: `app/(app)/campaigns/page.tsx:32-34`
- **状態**: `ALLOWED_STATUS.has(sp.status ?? "") ? ((sp.status ?? "") as CampaignStatus | "") : ("" as const)` ── `ALLOWED_STATUS` で実行時検証してから `as` キャストする、 という型ガードパターンとして正しい。 R1 で指摘した冗長 `("" as const)` は残るが、害は無い。 LOW で許容。

### L6. `mockCampaigns` で `ownerName === "田中 健司"` ハードコード (R1 L6 持ち越し)

- **ファイル**: `server/queries/campaigns.ts:198`
- **状態**: 未対応。 コメントで `MOCK_CURRENT_USER` 定数を切り出すと意図が伝わる。

### L7. `BulkActionForm` の `confirm()` はネイティブダイアログ

- **ファイル**: `components/campaigns/campaigns-table.tsx:302-305`
- **問題**: アーカイブ時のみ `confirm(confirmMessage(ids.length))` で警告。 ブラウザネイティブ confirm() は a11y / モバイル UX が貧弱、フォーカス管理 / Tab ナビゲーション壊滅。 Phase2 で AlertDialog 化推奨。

---

## 良い点 (3 つ)

1. **NH1 を除けば Bulk Action の React 19 配線は教科書的** ── `useActionState` (React 19) + `useFormStatus` (react-dom) + `Server Action` の三位一体で、`pending` でスピナ表示・成功/失敗を `role="status"` / `role="alert"` で読み上げ。`completedRef` で onComplete の二重発火を防ぐパターンも正しい。 残るのは server actions 側の tx 設計 (NH1, M2) だけ。
2. **Dropdown の API 設計が綺麗** ── `triggerProps` / `triggerClassName` / `triggerAriaLabel` の 3 つに分けたのは正解。 `<button>` を内部生成することで nested interactive を構造的に防ぐ + 呼出側がスタイル/aria を渡せる柔軟性も確保。 R1 で提案した `React.cloneElement` 経路 (children を `<button>` と仮定) より、こちらの方が型安全 (`ReactNode` を受け入れる)。
3. **`escapeLikePattern` の純関数化と単一 import** ── `lib/utils.ts:12-14` に切り出し、`server/queries/campaigns.ts:74` で `ilike(name, '%${escapeLikePattern(safeQ)}%')` と一行で。`%` / `_` / `\` を全部エスケープ、 ユーザが `a_b` を入力しても意図通りリテラル `_` でマッチ。 R1 M8 を最小コストで解消。

---

## 95+ 到達のための残ブロッカー

| 優先 | ID | タスク | 推定 |
| --- | --- | --- | --- |
| **P0** | **NH1** | `bulkSetStatus` の空 `tx.execute()` ループ削除、または `writeAuditTx(tx, ...)` を本実装 | 30min |
| P1 | M1 | UI 側 page クランプ: `effectivePage = Math.min(totalPages, page)` → Pagination / hrefFor に渡す | 15min |
| P1 | M2 | audit を tx 内に取り込む (writeAuditTx) → campaigns 更新と audit を atomic に | 1h |
| P1 | M3 | BulkBar 成功メッセージを上位コンポーネントで保持、3〜5s 維持 | 30min |
| P2 | M4 | `isStagnant` を `lib/campaign-status.ts` に移動 (isomorphic) | 10min |
| P2 | M5,M6,M7,L1,L4 | 型キャスト / dead code / aria-label 二重発話 / mockCampaigns ハードコード | 1h |

**合計**: P0 (NH1) **30 分** で 92/100、P1 完了で **95+/100** 到達見込み。

---

## 最終判定

**結果: NEAR (89/100)**

| 判定 | 条件 | 状態 |
| --- | --- | --- |
| **PASS** | ≥ 95、HIGH 0 件、全 P0/P1 解消 | ✗ (89/100、NH1 残存) |
| **NEAR** | 85 ≤ score < 95、HIGH ≤ 1 件で軽微な P0 残 | ✓ NH1 のみ |
| FAIL | < 85 or HIGH ≥ 2 件 | — |

R1 HIGH 6 件は完全に解消されており、R2 の修正は構造的にも丁寧。 ただし **`tx.execute()` を引数なしで呼び出す**ことは「Phase2 差し替え予定」とコメントしつつも実装漏れであり、現時点で `bulk*Campaigns` を実行すると必ず crash する致命的な runtime バグ。 シミュレーションファースト原則 (memory: `feedback_simulation_first.md` ── 「レビュー高得点 ≠ 実装完成」) に従い、本 PR をマージする前に **実機で `bulkPauseCampaigns` を一度呼び、 audit log と campaigns テーブルの整合性を目視確認すること**。 そこを通せば 95+ 到達は確実。
