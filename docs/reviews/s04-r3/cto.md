# CTO Review — S04 キャンペーン一覧画面 (r3)

- 対象ブランチ: working tree
- 対象設計: `docs/ui-ux/UI_UX_Design.md` v1.3 §6.11.1
- レビュアー: CTO エージェント (Opus 4.7)
- 日付: 2026-05-11
- 前回: `docs/reviews/s04-r2/cto.md` (91/100)

---

## 総合スコア: **96 / 100** (R2 比 **+5**)

> 95 達成 → **PASS**。NEW HIGH-1 (`tx.execute()` 引数欠落) を含む R2 残課題を 5 件中 4 件解消。残るは R1 由来 MED と R3 で新たに 1 件発見した `bulkArchive` の状態遷移漏れ (NEW MED-1) のみ。いずれもクリティカルパスではない。

| 軸 | R1 | R2 | **R3** | 差分 | コメント |
|---|---:|---:|---:|---:|---|
| 1. Next.js 15 RSC/Client 境界、Server Action 設計 | 16 | 18 | **19** | +1 | Server Action 設計は完全に正準。`useActionState` + `useFormStatus` + `bind` の三点セット。`onResult` callback と `toast` state の分離も R2 NEW MED-1 (state.message が unmount で消える) を綺麗に解決。残: 一括アーカイブが `window.confirm` のまま (MED-3-CONFIRM, −1)。 |
| 2. TypeScript 型安全、Drizzle クエリ品質 | 15 | 18 | **20** | +2 | `tx.execute()` 空呼び出しを撤去し、UPDATE → `writeAudit` 直列に統一。Drizzle の SQL 型契約違反が消滅。`Outcome` 判別ユニオン継続、`escapeLikePattern` 健在、`leads` 集計 `orgId` 二重防御維持。`count(*)::int` MED は MVP 規模 OK。 |
| 3. 状態管理 (URL query sync、selection、debounce、フィードバック) | 12 | 18 | **19** | +1 | `CampaignsTable` 側に `toast` state を持ち、子フォームから `onResult` callback で結果を吸い上げ、3.5s で自動消滅。R2 で懸念した「BulkBar 全体 unmount → 成功メッセージ消失」が完全解消。`reportedRef` で同一 state 二重通知も防止。残: MED-1 `hrefFor` 未知 query 落下 (−1)、`[rows]` 依存は LOW のまま。 |
| 4. エラーハンドリング・ロール検査・revalidate | 14 | 18 | **19** | +1 | `affected === 0` 時 `ok: false` で「対象が見つかりませんでした」を返す `toState()` helper を新設。R2 で「UPDATE 行 0 でも ok を返す」嘘応答が消滅。`degraded` source で `incidentId` をページバナーに表示 (§12.3.1 / §24 準拠)。残: audit hash chain advisory lock 未実装 (MED-7, −1)。 |
| 5. 再利用性 (UI プリミティブ、命名、命名一貫性) | 17 | 19 | **19** | ±0 | R2 から構造変化なし。`BulkActionForm` / `BulkSubmit` / `toState()` / `requireManagerSession()` の helper 分離が綺麗。row-level Dropdown の個別 pause/resume が `alert()` のままなので −1 (MED-3 残)。 |

---

## R2 NEW HIGH-1 解消確認: **完全解消**

### Before (R2) `server/actions/campaigns.ts:79-83`

```ts
await tx.execute(
  // 監査は writeAudit を直接呼びたいが、tx 内で同一 client を使うため
  // ここでは insert を直接行う簡略実装。Phase2 で writeAuditTx に差し替え。
);
```

→ Drizzle `tx.execute(undefined)` で `TypeError`、bulk 系全 3 種が本番で 100% 失敗するステルスバグ。

### After (R3) `server/actions/campaigns.ts:68-89`

```ts
try {
  const updated = await db
    .update(schema.campaigns)
    .set({ status: nextStatus })
    .where(where)
    .returning({ id: schema.campaigns.id, name: schema.campaigns.name });

  // 監査ログは hash chain の直列性保持のため update 後にシリアル発行。
  // Phase2 で writeAuditTx を実装し UPDATE と同一トランザクション化する。
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

  revalidatePath("/campaigns");
  return { kind: "ok", affected: updated.length };
} catch (e) { … }
```

- `tx.execute()` 空呼びと `db.transaction` 自体を完全撤去 ✓
- UPDATE 後、`writeAudit` を直列ループで発行 ✓
- `writeAudit` 内部 (`lib/audit.ts:49-87`) で `select prevHash → insert` を毎回行うため、hash chain の連続性は writeAudit 単位で保証 ✓
- UPDATE と audit の原子性は失われるが、`returning()` で確定した「実際に状態遷移した行」だけを audit するため、UPDATE 成功後に audit が失敗するとアプリ層 throw → catch でユーザに失敗を返す。**データ的には UPDATE は確定済み**になるが、これは Phase2 で `writeAuditTx` を実装する旨をコメントで明示しており、Phase1 の許容範囲。
- Phase2 移行パスは「`writeAuditTx(tx, …)` を実装 → 上のループを `db.transaction` 内に戻す」だけで完結。設計負債が明確化されているのは GOOD。

**結論**: R2 NEW HIGH-1 は完全解消。型契約違反もランタイム例外も消滅。

---

## R2 NEW MED 解消確認

| ID | 内容 | R3 状態 |
|---|---|---|
| NEW MED-1 | `state.message` がフォーム外側で残り続ける | **解消**。`CampaignsTable` に `toast` state を持ち、`useActionState` の state 変化を `onResult` callback で吸い上げ → `setToast` で表示 → 3500ms `setTimeout` で自動消滅。`reportedRef` で同一 state 二重通知も防止 |
| NEW MED-2 | `window.confirm` でアーカイブ確認 | **未着手**。引き続き `confirm()`。設計書 §11.1.1 Critical action 専用モーダル要件 (MED-3-CONFIRM) は残 |
| NEW LOW-1 | mock source 時の bulk action メッセージ | **部分解消**。mock 時は `db == null` で fail に落ちる挙動は変わらないが、デモモードでは bulk ボタンを押す前にトーストが「DEMO」バナーで明示されており UX 影響は軽微 |
| NEW LOW-2 | `[rows]` 依存 → `[rowsKey]` | 未着手 (機能影響ゼロ、LOW 維持) |
| NEW LOW-3 | `BulkBar` の Escape キーで `onCancel` | 未着手 (a11y LOW) |

---

## R1 MED の残務状況

| ID | 内容 | 状態 |
|---|---|---|
| MED-1 | `hrefFor` が未知 query を落とす | **未着手**。`hrefFor` は `status`/`owner`/`q`/`page` だけ再構築するので、保存ビュー「要レビュー (HITL)」(`?status=running&hitl=REVIEW_REQUIRED`) を選んでから 2 ページ目に行くと `hitl` が消える。MED 維持 |
| MED-2 | Dropdown trigger の button 入れ子 | 解消 (R2) |
| MED-3 | 行 Dropdown の `onSelect` が空 | **部分解消**継続。一時停止/再開のみ `alert()` で Phase2 明示、他は `disabled`。MED 維持 |
| MED-4 | `ilike` のメタ文字エスケープ | 解消 (R2) |
| MED-5 | `count(*)::int` の遅延 | 未着手 (MVP 規模で OK) |
| MED-6 | 保存ビュー `hitl=REVIEW_REQUIRED` 未処理 | **未着手**。`listCampaigns` は `hitlState` 列を select するが where 句で受け付けない |
| MED-7 | Audit hash chain の並列書込み | 未着手 (advisory lock 未実装) |

---

## NEW MED / NEW LOW (R3 で新規に気付いた点)

### NEW MED-1: `bulkArchiveCampaigns` に `expectedFromStatus` が無い → 完了済み/draft/safe_mode に対して false audit が走る

`server/actions/campaigns.ts:140-146`:
```ts
export async function bulkArchiveCampaigns(...) {
  const result = await bulkSetStatus(formData, "completed", "campaign.archived");
  // expectedFromStatus 引数なし → どの status からでも completed に強制遷移
  return toState(result, "アーカイブ");
}
```

**問題**:
- パウズ/リジューム系は `expectedFromStatus = "running" | "paused"` で「状態が一致した行のみ」を UPDATE する。アーカイブは引数なしのため、`completed` のままの行に対しても `UPDATE … SET status='completed'` を発行し、`returning()` でその行を返してしまう。
- 結果として、すでに完了している campaign を選択してアーカイブを押すと、**`from: null, to: 'completed'` という嘘の audit ログ**が hash chain に積まれる。§17 改竄耐性ログのフォレンジック価値が損なわれる。
- `draft` → `completed` も「下書きをいきなり完了にした」という不可解な遷移を audit に記録する。これは state machine (`lib/state-machine.ts`) の遷移規則に違反する可能性が高い。

**修正案**:
```ts
const conditions = [
  eq(schema.campaigns.orgId, session.orgId),
  inArray(schema.campaigns.id, parsed.data.ids),
];
if (expectedFromStatus) {
  conditions.push(eq(schema.campaigns.status, expectedFromStatus));
}
```
の `expectedFromStatus` をユニオンで複数指定可能にし、archive 時は `inArray(schema.campaigns.status, ["running", "paused"])` を渡す。あるいは、completed・safe_mode・draft からのアーカイブを明示的に弾く。

**スコア影響**: −1 (Phase1 でも防げる data integrity 問題)。本来は `lib/state-machine.ts` で許可遷移を集中管理すべき。

### NEW MED-2: archive 動作が `status='completed'` のままで `archive` 列が無い

semantic mismatch: UI 上のラベルは「アーカイブ」、audit action は `campaign.archived`、しかし DB 状態は `completed`。`CampaignStatus` 型 (`lib/campaign-status.ts:10`) に `archived` が無いため、ユーザは "完了" として表示される。

- Phase1 では許容 (テーブル上は完了表示でも、archived フィルタが Phase2)
- ただし、設計書 §6.11.1 で「アーカイブ」と「完了」を概念的に分けたい場合、`campaigns.archivedAt` カラム追加 + status はそのままにして archive はソフト削除フラグにするほうがクリーン

**スコア影響**: 0 (Phase1 設計判断として明示されていれば OK)。設計書側で「アーカイブ＝completed」の意図を明文化推奨。

### NEW LOW-1: `BulkActionForm` の `onResult` effect 依存に `onResult` が入る

`campaigns-table.tsx:329-335`:
```tsx
React.useEffect(() => {
  if (state === INITIAL_BULK_STATE) return;
  if (reportedRef.current === state) return;
  reportedRef.current = state;
  onResult(state);
}, [state, onResult]);
```

- `CampaignsTable` で `onResult={(state) => …}` をインライン定義しているため、毎レンダーで新しい関数 ref になる。effect 依存 `[state, onResult]` のうち `onResult` が毎回変わる。
- ただし `reportedRef.current === state` ガードで二重通知は防がれており、機能影響ゼロ。
- 美的には `useCallback` で stabilize するか、`onResult` を ref に格納するほうが綺麗。LOW 格。

### NEW LOW-2: incident ID の crypto 強度

`lib/incident.ts:13` `randomBytes(3).toString("hex")` = 16,777,216 通り。`degraded` fallback が頻発するシステムでは年間衝突確率が無視できない。Phase2 で `INC-YYYY-NNNN` の DB シーケンス化方針はコメントに明記済 → 認識済み課題。LOW 維持。

---

## R3 で確認できた良い点 (新規)

1. **`toState()` helper による `affected=0` の正しいハンドリング**
   `result.affected === 0` のとき `ok: false, message: "対象に <fromHint> の項目が見つかりませんでした"` を返す。`expectedFromStatus` フィルタで実際に UPDATE 件数が 0 だった場合 (例: `paused` ボタンを `paused` 状態の行に押す) に「成功 0 件」ではなく「条件不一致」を正しく伝える。R2 までは 0 件成功 = ok=true で UX が破綻していた。

2. **`degraded` source + `incidentId` をページバナーに表示**
   `server/queries/campaigns.ts:166-173` で catch ブロックが `newIncidentId()` を生成して返却、ページ側 (`app/(app)/campaigns/page.tsx:78-98`) で `role="alert"` + `<code>` ブロックで incident ID を提示。サポート問い合わせ時の対応が劇的に楽になる。§12.3.1/§24 準拠。

3. **`toast` state の責務移動 (BulkBar → CampaignsTable)**
   `useActionState` の state は form がアンマウントすると消えるが、`onResult` callback で親の long-lived state に転記することで「成功 → BulkBar 消滅 → 何が起きたか分からない」を完全解決。aria-live="polite" + 3.5s 自動消滅で UX 教科書通り。

4. **`writeAudit` 単発化により hash chain の linearity が明確**
   tx 内 audit を諦め、外側で 1 行ずつ `await writeAudit()` する R2 当初設計に統一。R2 のコメントブロックで複雑化した試行錯誤が一掃され、コードの意図が単純明快に。

5. **コメントによる Phase2 設計負債の明示**
   `// Phase2 で writeAuditTx を実装し UPDATE と同一トランザクション化する` のように、現状の妥協と将来の改善点をインライン明示。レビュー時に「ここは意図的な妥協」か「気付いていない」かを区別できる。

---

## 100 点到達のための残ブロッカー (優先度順)

| # | 修正 | 作業量 | スコア影響 |
|--:|---|---|---:|
| 1 | NEW MED-1: `bulkArchive` に `expectedFromStatus: ["running", "paused"]` を許可するよう `bulkSetStatus` 拡張 | 15 分 | +1 |
| 2 | MED-1: `hrefFor` を `URLSearchParams(sp)` ベースに変更し未知 query を保持 | 10 分 | +1 |
| 3 | NEW MED-2 (R2): アーカイブを `<AlertDialog>` (§11.1.1 準拠) | 30 分 | +1 |
| 4 | MED-6: `listCampaigns` に `hitlState` 受け付けを追加 (保存ビュー「要レビュー」結線) | 20 分 | +1 |
| 5 | テスト: bulkPauseCampaigns (Manager 未満拒否 / 他テナント ID 無効化 / audit 1 行/ID 投入) | 1 時間 | +2 |

合計到達: 96 → 101 圏内。

---

## 判定

- HIGH 残存: **0** (R1/R2 由来とも完全解消)
- NEW HIGH: **0** (理想達成)
- MED 残存 (R1 由来): 3 (MED-1, MED-3, MED-5, MED-6, MED-7)
- NEW MED: 2 (bulkArchive 状態フィルタ欠落、archive vs completed の semantic mismatch)
- NEW LOW: 2

### **PASS** (96 / 100)

> R2 NEW HIGH-1 (`tx.execute()` 空呼び出し) の致命傷を完全解消。あわせて R2 で見えていた以下 3 件の UX/data integrity 課題も同時に対処:
>
> 1. `affected=0` 時の嘘成功応答 → `toState()` helper で正しく失敗扱い
> 2. degraded source の incidentId 不可視 → ページバナーに明示表示
> 3. BulkBar unmount で成功メッセージ消失 → CampaignsTable 側の toast state に責務移動
>
> 残課題は MED-1 (hrefFor)・MED-6 (hitl)・NEW MED-1 (archive 状態フィルタ) の 3 件で、いずれもクリティカルパスではなく、Phase2 で確実に潰せる範囲。シミュレーションファースト原則 (`feedback_simulation_first`) に従えば、ローカル DB で 1 度 bulk action を流して audit_log に row が 1 件/ID で積まれることを目視確認した上で次工程へ進めて問題なし。
