# CTO Review — S04 キャンペーン一覧画面 (r2)

- 対象ブランチ: working tree
- 対象設計: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.11.1
- レビュアー: CTO エージェント (Opus 4.7)
- 日付: 2026-05-11
- 前回: `docs/reviews/s04-r1/cto.md` (74/100)

---

## 総合スコア: **91 / 100** (R1 比 **+17**)

> 95 未達。**NEW HIGH-1 (tx.execute() 空呼び出し)** が即時 RuntimeError を引き起こし、bulk action が本番で 100% 失敗するため。これ 1 件を直せば **96–97** で確定的に PASS。

| 軸 | R1 | **R2** | 差分 | コメント |
|---|---:|---:|---:|---|
| 1. Next.js 15 RSC/Client 境界、Server Action 設計 | 16 | **18** | +2 | `useActionState` + `<form action={bind}>` + `useFormStatus` で正準の Server Action 結線。`force-dynamic` / `force-no-store` 維持。残: BulkBar が `confirm()` 直叩きで Critical action のモーダル要件 §11.1.1 を満たさない (−1)、tx 内空 execute (−1)。 |
| 2. TypeScript 型安全、Drizzle クエリ品質 | 15 | **18** | +3 | `leads` 集計に `eq(leads.orgId, orgId)` 追加で二重防御達成。`escapeLikePattern` で `%`/`_` を退避。`Outcome` 判別ユニオンで Action 戻り値が型契約に。`clamp` を `lib/utils.ts` 共通化。残: `count(*)::int` は MED 維持 (−1)、`tx.execute()` の引数欠落で Drizzle の `SQL` 型契約違反 (−1)。 |
| 3. 状態管理 (URL query sync、selection state、debounce) | 12 | **18** | +6 | `useEffect([rows])` で visible 集合差し替え、`prev` を返して bail-out。`q.trim().slice(0,120)` でサーバ入力長制限、page clamp 1–1000。HIGH-2 完全解消。残: MED-1 (`hrefFor` が未知 query を落とす) 未着手 (−1)、 `[rows]` 依存だと毎レンダー effect 走るので `[rows.map(r=>r.id).join(",")]` のほうが綺麗 (−1)。 |
| 4. エラーハンドリング・ロール検査・revalidate | 14 | **18** | +4 | `AuditAction` に `paused`/`resumed`/`archived`/`duplicated`/`deleted` を追加、1 ID = 1 audit 行。`requireManagerSession` で 403 / 401 を区別。`db.transaction` で UPDATE を原子化、`try/catch` → degraded fallback。`revalidatePath` 健在。残: hash chain 直列性は `writeAudit` 内で逐次取得しているが advisory lock 無し (MED 維持、−1)、`tx.execute()` 空呼びで catch ブロックに必ず落ちる構造 (−1)。 |
| 5. 再利用性 (UI プリミティブ、命名、命名一貫性) | 17 | **19** | +2 | `Dropdown` trigger を `<button>` に統一しており、filter-bar の保存ビューも Fragment trigger なので button 入れ子は消滅 (MED-2 解消)。`BulkActionForm` / `BulkSubmit` を分離し、再利用しやすい。残: row-level Dropdown の `onSelect={() => close()}` (個別 pause/resume) はまだ alert/disabled (MED-3 残)、`<input type="hidden" name="total" />` 残骸 (LOW-1) は未確認。 |

---

## R1 HIGH 解消確認

### HIGH-1 (audit action 固定 / targetId CSV): **完全解消**

- `lib/audit.ts:13-17` `AuditAction` に `campaign.paused` / `campaign.resumed` / `campaign.archived` / `campaign.duplicated` / `campaign.deleted` 追加。型レベルで虚偽 action を弾く。
- `server/actions/campaigns.ts:88-97` で `updated` (=実際に状態遷移した行) を 1 行ずつループし `writeAudit({ targetId: row.id, diff: { status: { from, to } } })`。CSV 連結バグ根絶。
- `bulkPauseCampaigns` / `bulkResumeCampaigns` / `bulkArchiveCampaigns` 三者が異なる `auditAction` を `bulkSetStatus` に渡しており、shared helper のテーマも保たれている。

**残課題 (MED 格)**: 直列ループだが、`writeAudit` 内部の `select prevHash → insert` が**独立トランザクション**で走るため、外側で `await Promise.all([writeAudit, writeAudit])` していなくても、同時に別リクエストの `writeAudit` が割り込むと chain 分岐の可能性が残る。MED-7 として継続課題。

### HIGH-2 (selection rows 追随): **完全解消**

`components/campaigns/campaigns-table.tsx:41-52`:
```tsx
React.useEffect(() => {
  const ids = new Set(rows.map((r) => r.id));
  setSelected((prev) => {
    let changed = false;
    const next = new Set<string>();
    for (const id of prev) {
      if (ids.has(id)) next.add(id);
      else changed = true;
    }
    return changed ? next : prev;
  });
}, [rows]);
```

- 表示中行に存在しない ID を選択集合から落とす ✓
- `changed ? next : prev` で参照同値を維持 → 不要な再レンダーを抑制 ✓
- 結果として「page=2 で 5 件選択 → page=1 戻る → 5 件選択は維持されず空集合に」が成立。フィルタ切替時も同様。

**改善余地 (LOW 格)**: 依存配列 `[rows]` は SSR 毎に新しい配列参照を受け取るので毎レンダー effect が走る。`rowsKey = rows.map(r=>r.id).join(",")` で `[rowsKey]` にすると ID 集合が同じ時に skip できて綺麗。ただし bail-out が効くので機能的には問題なし。

### HIGH-3 (BulkBar 未結線): **設計は正準、ただし実行時に NEW HIGH-1 で死ぬ**

- `useActionState(action, INITIAL_BULK_STATE)` で Server Action を bind ✓
- `<form action={formAction}>` 内に `ids` を `<input type="hidden" name="ids">` で展開 ✓
- `useFormStatus()` を子 `BulkSubmit` で読み、`pending` 中はスピナー＋disabled ✓
- 成功時 `state.message` を `aria-live="polite"` で読み上げ、失敗時 `role="alert"` ✓
- 成功 + `resetSelection` で親に `onComplete()` を 1 度だけ呼んで選択をクリア ✓

設計としては Next.js 15 の正準パターンを踏襲しており優秀。**ただし**、Server Action 本体が NEW HIGH-1 で必ず例外を吐くため、現状は UI が「処理中に問題が発生しました。時間をおいて再試行してください」を出す装置になっている。

**MED 格課題**: アーカイブの確認だけ `confirm()` で済ませている。設計書 §11.1.1 では Critical action は専用モーダル + 二段階入力を要求しており、確認 UI 未到達。MED-3-CONFIRM として残す。

### HIGH-4 (`leads` 集計に `orgId` 欠落): **完全解消**

`server/queries/campaigns.ts:118-124`:
```ts
.where(
  and(
    eq(schema.leads.orgId, orgId),
    inArray(schema.leads.campaignId, ids)
  )
)
```

- 二重防御 ✓ (campaign 側 RLS バグや GUC 漏洩でも他社 lead に到達不能)
- インデックス: `leads_org_idx` と `leads_camp_idx` が両方使え、planner が選択可。理想は `(org_id, campaign_id)` 複合 index 追加だが Phase2 で OK
- §17 ABAC「常に `org_id = current_org`」を遵守

---

## NEW HIGH (R2 で混入した致命傷)

### NEW HIGH-1: `server/actions/campaigns.ts:79-83` — `tx.execute()` が引数なしで呼ばれている

```ts
await tx.execute(
  // 監査は writeAudit を直接呼びたいが、tx 内で同一 client を使うため
  // ここでは insert を直接行う簡略実装。Phase2 で writeAuditTx に差し替え。
);
```

**問題**:

- JavaScript の関数呼び出しの中身がコメントブロックだけ ⇒ パーサは `tx.execute()` として実引数 0 個の呼び出しと解釈する。
- Drizzle ORM (postgres-js) の `tx.execute()` シグネチャは `execute<T>(query: SQL | Query)` 必須。`undefined` を渡すと内部で `query.toQuery()` 呼び出し時に `TypeError: Cannot read properties of undefined (reading 'toQuery')` (もしくは equivalent) を throw。
- 結果: **`updated.length > 0` であれば必ずトランザクションが rollback** → `bulkSetStatus` の catch にハマり、ユーザは「処理中に問題が発生しました」を見る。**bulk action 全 3 種が本番で 100% 失敗**。
- mock 環境 (`db == null`) では `bulkSetStatus` が `"データベースに接続できません"` を返すため UI 上はそれっぽく動いてしまい、ローカル目視では気付かない。本番 + 真の DB 接続で初めて顕在化する**典型的なステルスバグ**。
- 1 行 UPDATE が成功した直後に rollback されるので、データ的には無事だが UX は完全破綻。さらに「audit 行が 1 件も書かれない」=「§17 改竄耐性ログが穴を生む」=コンプライアンス的にも痛い。

**修正 (推奨)**: ループ自体を削除し、tx 外で `writeAudit` する現行設計に統一する (R2 がやろうとした方針)。

```ts
const updated = await db.transaction(async (tx) => {
  return await tx
    .update(schema.campaigns)
    .set({ status: nextStatus })
    .where(where)
    .returning({ id: schema.campaigns.id, name: schema.campaigns.name });
});

// tx 外で audit を 1 行ずつ append (writeAudit が hash chain を担保)
for (const row of updated) {
  await writeAudit({
    orgId: session.orgId,
    actorUserId: session.userId,
    action: auditAction,
    targetType: "campaign",
    targetId: row.id,
    diff: { status: { from: expectedFromStatus ?? null, to: nextStatus } },
  });
}
```

**コミット必須**。スコアの 91 → 96 を分ける唯一のブロッカー。

---

## R1 MED の残務状況

| ID | 内容 | 状態 |
|---|---|---|
| MED-1 | `hrefFor` が未知 query を落とす | **未着手**。`hitl=REVIEW_REQUIRED` 等が 2 ページ目で消える。MED 維持 |
| MED-2 | Dropdown trigger の button 入れ子 | **解消**。`Dropdown` が `<button>` を内蔵し、filter-bar の trigger は Fragment、table は icon ノードなので button 入れ子無し |
| MED-3 | 行 Dropdown の `onSelect` が空 | **部分解消**。一時停止/再開のみ `alert()` で Phase2 明示、他は `disabled`。MED 維持 (個別 action 未実装) |
| MED-4 | `ilike` のメタ文字エスケープ | **解消**。`escapeLikePattern` で `\`/`%`/`_` を退避 |
| MED-5 | `count(*)::int` の遅延 | 未着手 (MVP 規模で OK 判定継続) |
| MED-6 | 保存ビュー `hitl=REVIEW_REQUIRED` 未処理 | **未着手**。STARTER に居座っているが `listCampaigns` 未対応 |
| MED-7 | Audit hash chain の並列書込み | 未着手 (HIGH-1 直列化で部分緩和) |

---

## NEW MED / NEW LOW (R2 で新規に気付いた点)

### NEW MED-1: `useFormStatus` の `state.message` がフォーム外側で残り続ける
`BulkActionForm` の `state.message` は `useActionState` 経由で保持されるが、次の選択変更でフォームが unmount されないとメッセージが消えない。`onComplete` で `setSelected(new Set())` するため BulkBar 全体がアンマウントされ実害なし。ただし「アーカイブ確認 cancel → state は INITIAL のまま」=「再 submit して結果が来るまで以前の成功メッセージが残る」エッジケースあり。Toast コンポーネントへの置換で根本解決。

### NEW MED-2: BulkBar の確認モーダルが `window.confirm`
設計書 §11.1.1 Critical action は「専用モーダル + 二段階確認」要件あり (アーカイブはほぼ削除と等価)。`confirm()` で済ませると a11y / モバイル UX が崩れる。専用 `<AlertDialog>` 化必要。

### NEW LOW-1: `mock` ソース時に `bulkPauseCampaigns` が `"データベースに接続できません"` を返す
ローカル開発で誤って bulk を押すと一見「DB が無い」というエラーが出る。`source === "mock"` を Action 側で検知し「Demo モードでは一括操作は無効です」を返した方が親切。

### NEW LOW-2: `setSelected` の effect 依存が `[rows]` のみ
`rowsKey` を導出して `[rowsKey]` にした方が無駄な effect 起動を抑えられる (現状でも bail-out するので機能影響ゼロ、LOW 格)。

### NEW LOW-3: `BulkBar` のキーボード操作
スペース / Enter の挙動は HTML form のデフォルトに任せているが、`Escape` で `onCancel` を呼ぶ実装が欠落。BulkBar が出ている間は Escape で選択解除がアクセシビリティ的に望ましい。

---

## R2 で確認できた良い点 (新規)

1. **`Outcome` 判別ユニオンで Server Action 戻り値を型契約化**
   `bulkSetStatus` の戻り値が `{ kind: "fail"; message } | { kind: "ok"; affected }`。呼び出し側 (`bulkPauseCampaigns` 等) で `if (result.kind === "fail")` の網羅性チェックが TS に効き、`message` 必須性が型レベルで保証される。R1 で指摘した「Action 戻り値の `affected: 0` への暗黙依存」が解消。

2. **`useActionState` + `useFormStatus` の組み合わせがモダン**
   Next.js 15 / React 19 の正準 Server Action パターン。`pending` UI、`state.message` の polite live-region、成功時の `resetSelection` フラグまで一気通貫。`completedRef` で onComplete 重複発火を防ぐディテールも良い。

3. **`AuditAction` ユニオン拡張 + 1 行 1 監査**
   `campaign.paused` / `campaign.resumed` / `campaign.archived` / `campaign.duplicated` / `campaign.deleted` 全部入り。設計書 §17 のフォレンジック要件 (誰が、いつ、どの 1 ID に対し、何を) を厳密に満たす。Phase2 で `campaign.duplicated` / `campaign.deleted` を結線するときも変更点が action 名のみで済む拡張余地。

4. **`escapeLikePattern` / `clamp` を `lib/utils.ts` に集約**
   再利用しやすく、テスタブル。`listCampaigns` 以外 (リード一覧 S07、受信箱 S09) が ILIKE するときも同じ helper を呼べる。順序も `\\` → `%` → `_` で再エスケープ事故が起きないように正しい。

---

## 95+ 到達のための残ブロッカー (優先度順)

| # | 修正 | 作業量 | スコア影響 |
|--:|---|---|---:|
| 1 | **NEW HIGH-1**: `server/actions/campaigns.ts:79-83` の `for (row of result) { tx.execute() }` ループを削除 (audit は tx 外で `writeAudit` する現行設計に統一) | 5 分 | **+5** (軸 1, 2, 4 が各 +1〜2) |
| 2 | MED-1: `hrefFor` を `sp` 全体 base に。`hitl` 等の未知 query を引き継ぐ | 10 分 | +1 |
| 3 | NEW MED-2: アーカイブを `window.confirm` → 専用 `<AlertDialog>` (§11.1.1 準拠) | 30 分 | +1 |
| 4 | NEW LOW-2: `[rows]` を `[rowsKey]` に | 2 分 | +0.5 |
| 5 | テスト: bulkPauseCampaigns Manager-未満拒否 / orgId 異なる ID は UPDATE されない / audit 行 1 件/ID 投入 | 1 時間 | +2 |

**合計**: 91 → 100 圏内まで到達可。**最低限 NEW HIGH-1 だけ潰せば 96** で確実に PASS。

---

## 判定

- HIGH 残存: **0 (R1 由来)**
- NEW HIGH: **1 (NEW HIGH-1: `tx.execute()` 引数欠落)**
- MED 残存 (R1 由来): 3 (MED-1, MED-5, MED-6)
- NEW MED: 2
- NEW LOW: 3

### **NEAR** (91/100)

> NEW HIGH-1 が本番で bulk action を 100% 失敗させるため、機能的には R1 と同等の「使えない」状態にある。設計改善 (HIGH-1〜4 全解消、型安全強化、a11y 改善) の質は明確に PASS レンジだが、ステルスバグ 1 件で PASS とは言えない。
>
> **NEW HIGH-1 のたった 1 件の修正** (5 行のコメントブロックと閉じカッコを削除するだけ) で **96–97 / 100** に上がり、PASS 確定。シミュレーションファースト原則 (`feedback_simulation_first`) で、ローカル DB に接続した状態で 1 度 bulk pause を流せば必ず気付くタイプの問題なので、修正後に必ず実機シナリオを 1 周流すこと。
