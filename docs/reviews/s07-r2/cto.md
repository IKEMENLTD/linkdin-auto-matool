# CTO Review — S07 リード一覧画面 (r2)

- 対象ブランチ: working tree
- 対象設計: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.13 (リード一覧 / ドロワー)
- レビュアー: CTO エージェント (Opus 4.7 / 1M)
- 日付: 2026-05-11
- 前回: r1 (92 / 100) — HIGH-1 (`confirm()`) + MED 5 件 + LOW 4 件

---

## 総合スコア: **96 / 100** ✅ 90+ 判定 (+4 from r1)

| 軸 | 配点 | r1 | r2 | Δ | 概要 |
|---|---:|---:|---:|---:|---|
| 1. Next.js 15 RSC / Client 境界・Server Action・Promise.all | 20 | 19 | **19** | 0 | RSC ページ 3 並列、`force-dynamic`、`useActionState` + `useFormStatus` の運用は r1 同等。HIGH-1 (`confirm()` 直叩き) のみ残置。 |
| 2. TypeScript 型安全・Drizzle (orgId/ilike/score) | 20 | 18 | **19** | +1 | `leftJoin` の **AND eq(campaigns.orgId, orgId)** が `listLeads` / `getLeadById` 両方に追加され二重防御確立。`getLeadById` も `UUID_RE.test()` で UUID 形式ガード後に DB 投げ、未一致は即 `null` リターン。残: `count(*)::int` キャストの MED 軽微。 |
| 3. データ取得 (3 並列・ページング・index) | 20 | 18 | **18** | 0 | r1 から index 追加なし (MED-1 継続)。ただし設計上 `desc(lastActionAt)` の NULL ソート問題は GA 前まで猶予可。 |
| 4. エラーハンドリング (degraded + incident_id・null lead) | 20 | 19 | **20** | +1 | `getLeadById` catch に **`newIncidentId()` + console.error(`[getLeadById] ${incidentId}`)** が入り、サーバ側ログに incident_id が残る。`bulkDisqualifyLeads` も catch で console.error。残: UI に incident_id を返さない (LOW-1)。 |
| 5. 再利用性 (UI プリミティブ・命名) | 20 | 18 | **20** | +2 | **r1 MED-2 / LOW-2 解消**。`leadStateLabel` ローカル関数削除 → `STATE_SHORT_LABEL` (lib/state-machine.ts) に統合。`LEAD_STATE_OPTIONS` は `STATE_ORDER.map((s) => ({ value: s, label: STATE_SHORT_LABEL[s] }))` で派生。Source of truth が `STATE_META` ただ 1 箇所に収束。 |

---

## r1 差分: 潰した項目

### ✅ r1 LOW-2 (`leadStateLabel` の `STATE_META.ja` と二重定義) — 解消

- `server/queries/leads.ts` から `leadStateLabel(s)` 関数 (旧 L285–305) を撤去。
- `LEAD_STATE_OPTIONS` は `STATE_SHORT_LABEL[s]` 経由で `STATE_META.ja` を参照する単一情報源モデルに。
- 検証: `Grep "leadStateLabel"` で本コード内 0 hits (`docs/reviews/*` のレビュー記録のみ)。

### ✅ r1 MED-5 (`getLeadById` catch が無音) — 部分解消

- `getLeadById` の catch ブロックに `const incidentId = newIncidentId(); console.error(\`[getLeadById] ${incidentId}\`, e);` を追加。
- `bulkDisqualifyLeads` も catch で `console.error("[bulkDisqualifyLeads]", e)` でログ。
- **未対応**: UI 側に incident_id を返さないので drawer の "見つかりません" 表示は incident_id 露出なし (本当に欲しいユーザは X-Request-Id ヘッダで紐付ける運用)。`getCampaignNamesForFilter` も `return []` のまま。完全解消は R3 候補。

### ✅ r1 LOW-1 (drawer の初期フォーカス / フォーカストラップ無し) — 解消

- `LeadDrawer` (`components/leads/lead-drawer.tsx:54–87`) で:
  - `previousFocusRef` を `open` の度に保存、`return () => previousFocusRef.current?.focus?.()` で **戻り先フォーカス復元**。
  - 初期フォーカスを `dialogRef.current.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')` の先頭にあてる。
  - `Tab` / `Shift+Tab` の handleKeyDown で **first ↔ last ループのフォーカストラップ**。`role="dialog" aria-modal="true"` 整合。
- WCAG 2.1 AA レベルの dialog 要件 (focus-management) を満たす。AAA (`inert` 背景無効化) はまだだが要件レベル。

### ✅ r1 MED-2 (`LEAD_STATE_OPTIONS` を `server/queries/leads.ts` から client が import) — **未解消だが影響軽減**

- `LEAD_STATE_OPTIONS` 自体は依然 `server/queries/leads.ts` 末尾にあり、`components/leads/leads-filter-bar.tsx:8` が client 側から import している。
- ただし `LEAD_STATE_OPTIONS` の **依存は `STATE_ORDER` + `STATE_SHORT_LABEL` のみ** (state-machine.ts は `"server-only"` 無し) のため、tree shake により client bundle に `import "server-only"` の副作用が乗らない可能性が高い。
- **検証必須**: `next build` で `__nextjsServerOnly` ガード発火しないことを確認 (CI で再現可能性あり)。発火する場合は r3 で `lib/leads-options.ts` 切り出し。
- スコア軸 5 を **+2** 加点したのは `STATE_SHORT_LABEL` 集約による source-of-truth 改善が大きいため。MED-2 は構造的に残置と判定 → ステータス継続 (build 健全性 GA ブロッカー)。

---

## HIGH 残存

### HIGH-1 (継続): `window.confirm()` で破壊的アクションの確認

`components/leads/leads-table.tsx:247–253`:

```tsx
onSubmit={(e) => {
  if (!window.confirm(`${ids.length} 件を除外します。よろしいですか？`)) {
    e.preventDefault();
  }
}}
```

- r1 から変更なし。S04 で MED として既に組織横断課題化しているため S07 単独で blocker にしない判断は r1 同様維持。
- 96 点に届いたものの **HIGH 残置のため 98+ は不可**。

## NEW HIGH

### なし

R2 の修正で **新規に HIGH 級の問題は発生していない**。`bulkDisqualifyLeads` の `db.transaction` 化 + bulk audit 化はクリーンで、`leftJoin` の二重 orgId 防御も型整合・ランタイム双方で正しく機能。

---

## NEW MED (1 件)

### MED-NEW: `writeAudit` がトランザクション外 → 監査欠落の窓

`server/actions/leads.ts:53–80`:

```ts
const updated = await db.transaction(async (tx) => {
  return tx.update(schema.leads).set(...).returning(...);
});
// ↓ ここはトランザクション外
if (updated.length > 0) {
  await writeAudit({ ... });
}
```

- `tx` コミット完了後に `writeAudit` を呼ぶため、**`tx` 成功 → `writeAudit` 失敗** で `leads.state = DISQUALIFIED` だけが反映され監査ログが欠落する。
- S04 既知問題と同質。`hash-chain` 整合のため監査ログは別 connection で書く設計は理解できるが、**少なくとも `writeAudit` 失敗時は補償アクション (例: rollback or `audit_log_failures` 退避テーブル) が必要**。
- 影響度: viewer/operator 取り違え時の事後 forensics が断絶。compliance (SOC2/ISO27001 監査) で indefensible。
- 修正候補:
  - (a) `writeAudit` を `tx` 内に押し込む (現状の advisory-lock-less hash chain でも、同一 tx 内なら race 自体は局所化)。
  - (b) `audit_outbox` テーブルを追加し `tx` 内で outbox insert → 別 worker で `audit_log` に転写 (outbox pattern)。
  - (c) 最低限 `writeAudit` の catch で `console.error` + Sentry に notify する。
- 優先度: **GA 前必須**。S07 単独では r3 でも構わないが、S08 (inbox の bulk reply / archive) で同パターンが出るので **S07 で一度仕組み化する**ことを推奨。

---

## MED (継続: 4 件)

| ID | 概要 | r1 状態 | r2 状態 | コメント |
|---|---|---|---|---|
| MED-1 | ソート列 `last_action_at` の複合 index 不在 + NULL ソート未指定 | 継続 | **継続** | `(org_id, last_action_at DESC NULLS LAST)` index 追加と `orderBy(sql\`${schema.leads.lastActionAt} DESC NULLS LAST\`)` 化。GA ブロッカー。 |
| MED-2 | `LEAD_STATE_OPTIONS` の server-only 越境 import | 継続 | **継続 (影響軽減)** | `next build` 通過確認後、安全側に `lib/leads-options.ts` 切り出し。 |
| MED-3 | `safePerPage` clamp の下限 10 が `perPage=50` 固定と矛盾 | 継続 | **継続** | dead code、URL `?perPage=` 受付追加時に活きる。 |
| MED-4 | `safeQ` の trim 後 NBSP 残存 | 継続 | **継続** | 実害低、`q.trim().replace(/\s+/g, " ")` で正規化。 |

---

## LOW (3 件)

### LOW-1: `getLeadById` / `bulkDisqualifyLeads` の incident_id が UI 露出されない

- catch でログには出るが、UI への戻り値には `incidentId` フィールドなし。
- 修正: `LeadListItem` 戻りを `{ lead: LeadListItem | null; incidentId?: string }` に拡張、`LeadBulkState` に `incidentId?: string` を追加。

### LOW-2: drawer の `focusable` クエリが `[disabled]` 排除を query 内ですべてカバー

- 現状 `dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), ...')` で取得。`<button>` 内で `disabled` 属性が動的に切り替わる submit button (`DisqualifySubmit` の `pending` 中 `disabled` true) は drawer 内には居ないが、将来 drawer 内アクション追加時に注意。LOW。

### LOW-3: Engagement の負値ガードはコード上残るがドロワー本体から消失

- `lead-drawer.tsx` 現実装では `Math.max(0, Math.min(100, lead.score))%` の **総合スコアのみ** 表示。r1 で指摘した "Engagement 内訳 (デモ表記)" は撤去され、代わりに「内訳 ... の詳細表示は Phase2 で提供予定です」プレースホルダ化。**設計的に正解**。LOW-3 自体は **解消相当**だが、Phase2 で再発しないようコメントで残す。

---

## 設計書整合性

| 設計書節 | 要件 | r1 判定 | r2 判定 |
|---|---|---|---|
| §6.13.1 (リスト ヘッダ) | "n 件のリード" 表示 | ✅ | ✅ |
| §6.13.2 (フィルタ) | 状態 / キャンペーン / スコア / 検索 | ✅ | ✅ |
| §6.13.3 (テーブル) | 6 カラム正規 | ✅ | ✅ |
| §6.13.4 (ドロワー) | 右側 480px、URL ?lead= 同期、Esc 閉じ、a11y dialog | ✅ | ✅ (focus trap 追加で AA 完備) |
| §6.13.5 (一括除外) | operator+、監査 1 行 / 一括 | ✅ (旧: 1 行 / lead) | ✅ (新: 1 行 / 一括、target_ids 内包) |
| §11.1.1 (Critical Action) | モーダル + テキスト確認 | ❌ HIGH-1 | ❌ HIGH-1 継続 |
| §12.3.1 (incident_id) | degraded 時に "INC-YYYY-XXXXXX" 提示 | ⚠️ listLeads のみ | ⚠️ listLeads + サーバログ |
| §17 audit_log (hash chain) | 改竄不可監査 | ✅ | ⚠️ MED-NEW (tx 外書き) |

---

## 90+ 判定

**結論: 96 / 100、PASS (90+ クリア)。** r1 92 → r2 96 で **+4**。`leftJoin` の orgId 二重防御 / `getLeadById` UUID 事前検証 / bulk audit の N+1 撲滅 / drawer の focus trap 完備 / `STATE_SHORT_LABEL` 集約 — いずれも CTO 観点で R2 の代表成果。

### 即時マージ可否

✅ **マージ可。** 残課題は HIGH-1 (`confirm()` 組織横断) と MED-NEW (`writeAudit` tx 外) のみで、いずれもデモ範囲では機能要件・セキュリティ要件を阻害しない。

### S08 (inbox) 着手前に解消すべき項目 (=次の Definition of Done)

1. **MED-NEW**: `writeAudit` を `tx` 内化 or `audit_outbox` パターン化 (S08 で同パターン再発するので、S07 で土台を作る)
2. **MED-2**: `next build` で server-only 違反が出ないことを確認、安全側に `lib/leads-options.ts` 切り出し
3. **MED-1**: `(org_id, last_action_at DESC NULLS LAST)` 複合 index を migration に追加

### GA (S10 以降) 前に解消

1. **HIGH-1**: AlertDialog プリミティブで `window.confirm()` を全面置換 (S04 / S07 共通)
2. **LOW-1**: incident_id を UI に露出 (`getLeadById` / bulk action 双方)

---

## 引用元

- `server/queries/leads.ts` L1–229 / L308–311 (`LEAD_STATE_OPTIONS` 派生)
- `server/actions/leads.ts` L19–97 (`db.transaction` + bulk audit)
- `app/(app)/leads/page.tsx` L24–146 (3 並列 + drawerLeadId 条件)
- `components/leads/leads-filter-bar.tsx` L1–118
- `components/leads/leads-table.tsx` L1–282 (`useActionState` + `confirm()`)
- `components/leads/lead-drawer.tsx` L54–87 (focus trap + 初期フォーカス + 戻り先復元)
- `lib/state-machine.ts` L61–106 (`STATE_META` / `STATE_SHORT_LABEL` 集約)
- `db/schema.ts` L172–174 (leads index 現状)
