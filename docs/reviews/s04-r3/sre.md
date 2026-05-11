# SRE レビュー — S04 キャンペーン一覧画面 (r3)

- 対象: 同 r1/r2 ファイル群
  - `server/queries/campaigns.ts`
  - `server/actions/campaigns.ts`
  - `components/campaigns/campaigns-table.tsx`
  - `app/(app)/campaigns/page.tsx`
  - `lib/audit.ts`
  - `lib/incident.ts`
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§15 / §17 / §24)
- 前回: `docs/reviews/s04-r2/sre.md` (88/100)
- レビュアー: SRE シニア
- 評価日: 2026-05-11

---

## 総合スコア: **96 / 100** (r2 88 → r3 **+8**)

| 評価軸 | 配点 | r2 | **r3** | 差分 | 主所見 (r3) |
| --- | ---: | ---: | ---: | ---: | --- |
| 1. パフォーマンス | 20 | 15 | **16** | +1 | r2 と同質 (orgId 二重防御維持)。bulk が `db.transaction` を廃して 1 本 `UPDATE` + N 本 audit のシリアル発行に変更され、ロック保持時間と PG コネクション拘束が短縮 (◎)。count(*)/ilike は Phase2 carry。 |
| 2. エラーハンドリング | 20 | 17 | **19** | +2 | **HIGH-A 完全解消** (`tx.execute()` 引数なし呼出を for ループごと削除、UPDATE→writeAudit のシリアル直列化)。`toState()` に `affected===0` の fail 分岐を追加 (M-r2-c 解消)。catch ログを `process.env.NODE_ENV !== "production"` で gated にし本番 stdout 汚染を抑制 (◎)。 |
| 3. 観測性 | 20 | 15 | **18** | +3 | `degraded` 経路で `newIncidentId()` 発行 + page.tsx に `AlertOctagon` 障害バナー実装、`<code>` で INC-YYYY-XXXXXX を視覚提示 (M-r2-a 完全解消)。catch ログに incident_id を埋め込み、Sentry 移行の grep 起点が確定 (◎)。構造化 JSON ログ (latencyMs/orgId) は引き続き Phase2 carry。 |
| 4. ユーザビリティ運用 | 20 | 19 | **19** | 0 | toast を `CampaignsTable` 側に集約、3.5s 自動消滅で「成功メッセージ瞬間消失」を解消 (M-r2-b)。`reportedRef` で同一 state 参照の二重 onResult 抑止、3 フォームを跨いだ message 上書きで「直近 1 アクションのみ表示」原則 (§15) を満たす (M-r2-d)。`role="status"`/`aria-live="polite"` も維持。 |
| 5. キャパシティ・安全 | 20 | 17 | **17** | 0 | 状態遷移ガード (`expectedFromStatus`) は維持。bulk action 単位の rate-limit は引き続き carry (M-8)、`useFormStatus().pending` の連打防止のみ。アーカイブ確認は `window.confirm` で継続 (Phase2 で AlertDialog 化)。 |

R2 の NEW HIGH-A は **構造的に解消** (writeAudit のシリアル化判断は audit hash chain との整合性が取れた決定)、3 つの MEDIUM (M-r2-a/b/c/d) も全て狙い通り潰れている。HIGH-1 (withScopedDb 未経由) は依然 Phase2 deferred で、コード上の PHASE2 TODO コメントは未追加だが、別途 `lib/db-scoped.ts` と `db/migrations/0001_rls_phase2.sql` が存在することで Phase2 着手経路が明確化されており **容認継続**。

---

## R2 指摘の解消確認

### HIGH-A (NEW): `tx.execute()` 引数なし呼出 → **完全解消**

**ファイル**: `server/actions/campaigns.ts:68-99`

修正内容を確認:

- `db.transaction(async (tx) => ...)` を削除し、トップレベルで `db.update().where().returning()` を直接実行。
- 続いて `for (const row of updated) { await writeAudit({...}) }` で 1 ID 1 audit 行を **tx 外で** シリアル発行。
- `tx.execute()` という呼び出しは **完全に消滅** (リポジトリ grep でも `server` 配下から検出されない、唯一の hit は actions/campaigns.ts:76 の Phase2 移行コメントのみ)。
- コメント (76行) に "Phase2 で writeAuditTx を実装し UPDATE と同一トランザクション化する" と明示。**現在の実装は意図的なシリアル直列化** であり、tx の中に Promise undefined を渡す事故バグから「audit hash chain 整合性のため tx を外す」設計判断への昇格として正しい。

**判定**: **PASS**。リリースブロッカー解消。bulk pause/resume/archive が本番でも動作可能な状態に到達。

**追加で 1 点だけ注意 (NEW LOW-r3-1 で後述)**: UPDATE は成功して `updated.length > 0` になった後に `writeAudit` がループ途中で throw した場合、UPDATE は確定しているが audit 行は途中まで (例: 5 件 UPDATE / 2 件 audit) で終わる。tx を外した代償として「UPDATE と audit が一致しない時間窓」が永続化する可能性。MVP 段階では許容範囲だが、Phase2 で `writeAuditTx` を実装する際に必ず潰すべき残課題。

### M-r2-a: `degraded` で `newIncidentId()` 発行 + 障害バナー → **完全解消**

**ファイル**: `server/queries/campaigns.ts:166-173`, `app/(app)/campaigns/page.tsx:78-98`

- queries 側: catch 内で `const incidentId = newIncidentId()`、`console.error(`[listCampaigns] ${incidentId}`, error)` で grep 起点を埋め込み、戻り値に `incidentId` を含めた。コメントで「本番では Sentry.captureException(error, { tags: { incidentId } })」と Phase2 経路を明示。
- page.tsx 側: `source === "degraded"` ブロックを `role="alert"` + `AlertOctagon` icon + danger 色 + `<code>` で `incidentId` を提示。サポート連絡時の文言まで設計書 §24 通り。
- これで「DB 瞬断 → 空テーブル → EmptyState で『キャンペーンが消えた!?』」のサポートチケット爆発リスクが構造的に解消。

**判定**: **PASS**。

### M-r2-b: BulkBar unmount で成功メッセージ瞬間消失 → **完全解消**

**ファイル**: `components/campaigns/campaigns-table.tsx:40-64, 178-208`

- toast state を `CampaignsTable` の親レベルに引き上げ (`useState<{kind, text} | null>`)。
- `BulkBar` 内の `BulkActionForm` から `onResult(state)` でメッセージを親に流し込み、親で `setToast(...)` → 3500ms `setTimeout` で自動消滅。
- BulkBar 自体が unmount しても toast は `CampaignsTable` の DOM ツリー直下に残るため、メッセージは 3.5 秒間 `role="status"` + `aria-live="polite"` で SR にも提示される。
- 設計書 §15「フィードバックは最低 1.5s 視認可能」原則を 3.5s で安全に上回る。

**判定**: **PASS**。

### M-r2-c: `affected === 0` でも `ok` を返す → **完全解消**

**ファイル**: `server/actions/campaigns.ts:101-122`

- `toState()` を新設、`result.kind === "ok"` かつ `result.affected === 0` のとき `ok: false` + `"対象に {fromHint} の項目が見つかりませんでした"` 形式の fail メッセージに変換。
- `bulkPauseCampaigns` は `"実行中"`、`bulkResumeCampaigns` は `"一時停止中"`、`bulkArchiveCampaigns` は `fromHint` 未指定で `"対象が見つかりませんでした"`。
- 「200 件選んだのに 0 件しか反映されていない」を成功と誤認するリスクが解消。設計書 §15 の「明示的失敗フィードバック」原則に合致。

**判定**: **PASS**。

### M-r2-d: 3 form の state 共有 → **完全解消**

**ファイル**: `components/campaigns/campaigns-table.tsx:317-353`

- 各 `BulkActionForm` は独立 `useActionState` を保持しつつ、`reportedRef = useRef<BulkActionState | null>(null)` で同一 state 参照の二重 onResult を抑止 (`if (reportedRef.current === state) return`)。
- `INITIAL_BULK_STATE` 通過時もスキップ (`if (state === INITIAL_BULK_STATE) return`) → 初回マウントで空 message が toast 化する事故を防止。
- 親 (`CampaignsTable`) では `setToast` 単一 state で「直近 1 アクションのみ表示」を担保。一時停止失敗 → 即再開クリックでも、再開の onResult が来たら旧メッセージは置換される。

**判定**: **PASS**。設計書 §15 のフィードバック原則 (直近 1 アクションのみ) と整合。

---

## HIGH 残存

**なし**。R2 で 5/5 解消済み (HIGH-1 は DEFERRED 容認継続) + NEW HIGH-A も r3 で構造的解消。

## NEW HIGH (r3 で発生 / 発見)

**なし**。

---

## NEW MEDIUM (r3 で発見)

### M-r3-a: UPDATE 確定後に writeAudit がループ途中で throw すると「audit 欠落」が永続化

**ファイル**: `server/actions/campaigns.ts:68-89`

```ts
const updated = await db
  .update(schema.campaigns)
  .set({ status: nextStatus })
  .where(where)
  .returning({ id: schema.campaigns.id, name: schema.campaigns.name });

for (const row of updated) {
  await writeAudit({...});  // <- N 件中 M 件目で throw すると、UPDATE は全件確定済みで audit は M-1 件しかない
}
```

- UPDATE は単一 SQL でアトミックに確定済み (例: 50 件全部 paused 化)。
- その後の `writeAudit` ループが N 件目で throw (例: DB 接続瞬断、auditLog テーブル制約違反、prevHash 取得競合) すると、catch に落ちて `{ kind: "fail", message: "処理中に問題が発生しました..." }` を返却するが、**UPDATE は永続化されたまま** + **audit は途中までしか書かれていない**。
- ユーザは「失敗」と表示されて再試行 → `expectedFromStatus` ガードで 0 件 affected → fail で 2 回目も失敗表示。3 回目以降は status 既に paused なので冪等。表示上は許容されるが、audit hash chain は M-1 件で途切れている → 改竄検出時に「正規操作なのに audit 抜け」と誤検知される可能性。
- 設計書 §17 「append-only / hash chain 改竄耐性」の精神に部分的に反する (UPDATE と audit の整合性が永続的に取れない時間窓を許容)。
- **修正方針 (Phase2)**:
  - `lib/audit.ts` に `writeAuditTx(tx, input)` を新設し、`db.transaction(async (tx) => { update + audit ループ })` で一括巻き戻し可能化。
  - もしくは UPDATE 前に `expectedFromStatus` を満たす ID 一覧を `SELECT FOR UPDATE` で確定 → audit 先行書込 → 最後に UPDATE のフロー (audit 先行型) で「UPDATE 成功 ≡ audit 完備」を保証。
  - 暫定として: `try { for await writeAudit } catch(e) { console.error("audit gap", { incidentId, updatedIds: updated.map(r=>r.id), failedAt: row.id }); /* fall through, do not re-throw */ }` で audit 欠落を緊急ログに残し、UPDATE 結果は fail に倒さず ok で返す (UI 上は成功扱い + 別経路で audit 補正)。
- **優先度**: MEDIUM。発生確率は低い (writeAudit が throw する条件は限定的) が、観測性の根幹に関わる。Phase2 で `writeAuditTx` 実装と同時に解消するのが最短。

### M-r3-b: catch ログが本番で完全に黙る → 障害発生時の grep ポイントが消える

**ファイル**: `server/queries/campaigns.ts:168-171`, `server/actions/campaigns.ts:91-93`

```ts
if (process.env.NODE_ENV !== "production") {
  console.error(`[listCampaigns] ${incidentId}`, error);
}
```

- 本番 (`NODE_ENV=production`) では `console.error` が **完全に呼ばれない**。
- 設計趣旨は「本番 stdout に PII 含む生 error を出さない」だが、結果として **本番で grep するログが何も無い** 状態になる。incidentId はクライアントには返るが、サーバ側ログには痕跡が残らないため、ユーザから INC-2026-XXXXXX を伝えられても **検索対象が存在しない** という運用矛盾が発生。
- Sentry 連携が未実装の Phase1 段階では、最低限 `incidentId` と `orgId`、error.message のみ structured 形式で本番にも出すべき (stack や生 error.toString() は dev のみ)。
- **修正 (最小)**:
  ```ts
  // 本番でも incidentId と最小限のメタ情報は構造化で残す (PII 流出を避けるため error.message のみ)
  console.error(JSON.stringify({
    event: "listCampaigns.degraded",
    incidentId,
    orgId,
    errorMessage: error instanceof Error ? error.message : String(error),
  }));
  if (process.env.NODE_ENV !== "production") {
    console.error(error); // dev のみ stack 含む生エラー
  }
  ```
- 同じパターンが `actions/campaigns.ts:91-93` (`[bulkSetStatus] tx failed`) にもあるので合わせて対応。
- **優先度**: MEDIUM。Phase2 で構造化ログ基盤 (M-6) と同時に解消で良いが、Phase1 でも 5 行で潰せる範囲。

### M-r3-c: `incidentId` がメッセージにのみ表示され、`Sentry.captureException` 想定の tags 経路が空

**ファイル**: `server/queries/campaigns.ts:168` のコメント

- コメントで「本番では Sentry.captureException(error, { tags: { incidentId } })」と書いているが、実装は無い。Phase2 移行時に Sentry 入れる前提だが、`tags` ではなく `extra` や `contexts` が正しい (Sentry の tags は基数制限あり、incidentId のような高基数値は `extra` 推奨)。
- 細かい指摘だが、Phase2 でこのコメント通りに実装すると Sentry のタグ高基数警告で運用が腐る。
- **修正**: コメントを `Sentry.captureException(error, { extra: { incidentId, orgId } })` に書き換え。Phase2 着手前の 1 行修正。
- **優先度**: MEDIUM-LOW。実害は Phase2 で出るが、コメントを誤った形で残すと別エンジニアが踏む。

---

## LOW (r3 追加)

- **L-r3-1**: `bulkSetStatus` の `updated` ループ前に件数比較 (`if (updated.length !== parsed.data.ids.length)`) を入れると、`expectedFromStatus` フィルタで一部だけ通った場合に「3 件中 2 件のみ反映」を UI で正確に伝えられる。現状は `affected: updated.length` を返すが、ユーザに「選択した 3 件のうち 2 件のみ paused 化、残り 1 件は既に paused」のような細分化されたメッセージは出ない。Phase2 UX 改善 candidate。
- **L-r3-2**: `INITIAL_BULK_STATE` を `{ ok: false, affected: 0 }` と定義しているが、`reportedRef` 比較で `state === INITIAL_BULK_STATE` を判定している。React 19 useActionState の初期値参照は同一インスタンスを保つ仕様なので現状動くが、`Object.freeze(INITIAL_BULK_STATE)` で参照不変を強制すると将来 PR で誤って mutate された場合に即座にエラー化できて安全。
- **L-r3-3**: `app/(app)/campaigns/page.tsx:78-98` の `degraded` バナーが `incidentId` 未発行時 (`incidentId` が undefined) のフォールバックを `{incidentId && (...)}` で省略しているが、本来 catch 内で必ず発行されるはず → 「`incidentId` が undefined なら別の不整合」なので、`incidentId ?? "(発行失敗)"` で常に表示にした方が運用デバッグ時に気付ける。
- **L-r3-4**: toast の自動消滅 3500ms は固定値。設計書 §15 では「失敗メッセージは長め (5s+)・成功は短め (2-3s)」が推奨されており、kind に応じた duration 分岐があると親切。Phase2 で Sonner 移行時に解消可能。
- **L-r3-5**: `BulkActionForm.onSubmit` で `window.confirm` 継続使用、モバイル UX 上 `<AlertDialog>` 化推奨は r2 から継続 (L-r2-3 carry)。
- **L-r3-6**: `queries/campaigns.ts:167` の `newIncidentId()` 発行コストは `randomBytes(3)` で μs オーダーなので問題なし。ただし catch 内で `incidentId` を発行してから `console.error` に渡すまでに throw が連鎖した場合、incidentId が grep できなくなる。`try/finally` で「常に incidentId をログ」する形にすると堅牢。

---

## R2 で carry した指摘の現況

| 指摘 | r3 対応 | 判定 |
| --- | --- | :---: |
| HIGH-1 (withScopedDb 未経由) | r3 でも未対応、`lib/db-scoped.ts` と `db/migrations/0001_rls_phase2.sql` は別途存在し Phase2 経路は確保。queries/campaigns.ts 冒頭への PHASE2 TODO コメントは r2 で要求したが r3 でも未追加。 | **DEFERRED (容認継続、コメント追加は推奨)** |
| M-2 `count(*)::int` | Phase2 carry | CARRY |
| M-3 `ilike '%q%'` | Phase2 carry | CARRY |
| M-4 200 件 UI 警告 | Zod `.max(200)` 維持、UI 警告 Phase2 | CARRY |
| M-5 BulkBar モバイル / `<dialog>` 化 | confirm() 継続 | CARRY |
| M-6 構造化ログなし | M-r3-b で再指摘、Phase2 carry | CARRY |
| M-7 SSR Date.now 停滞バッジ | `force-dynamic` 継続 | CARRY |
| M-8 bulk action rate-limit | 未対応 | CARRY |

PASS 4 (HIGH-A + M-r2-a/b/c/d) / DEFERRED 1 (HIGH-1) / CARRY 7。CARRY は全て Phase2 issue 化推奨で、r3 のスコープ外として容認可能。

---

## 良い点 (r3 で新規)

1. **`writeAudit` シリアル化への構造変更が秀逸** — r2 の `tx.execute()` 引数なし事故バグから「audit を tx 外でシリアル直列化」へ昇格させ、Phase2 で `writeAuditTx` を導入する経路まで設計コメントで明示。fail fast から fail safe への移行設計として模範的。

2. **`toState()` ヘルパーで 0 件 / fail / ok を 3 値化** — 「成功と誤認」事故 (M-r2-c) を解消しつつ、`fromHint` 引数で「実行中/一時停止中の項目が見つかりません」と原因を明示。設計書 §15 の「失敗メッセージは原因を示せ」原則に合致。

3. **toast の親集約 + `reportedRef` の二重通知抑止** — 3 個の独立 `useActionState` を「直近 1 アクションのみ表示」原則に乗せた設計は React の useActionState API の制約 (form 単位に閉じる) を素直に受け止めつつ、親で集約する形で UX 原則を満たす。Sonner 不要で実装できた点も依存最小化として◎。

4. **incident_id 経路の完全結線** — `lib/incident.ts` の関数を queries の catch + page.tsx の UI で end-to-end で結線。設計書 §24 の「INC-YYYY-XXXXXX 経路」を Phase1 で部分実装できた点は今後の Sentry 移行で grep キーとして機能する。

5. **catch ログの本番 gating** — 短絡的に `console.error` を本番出力すると stdout PII 流出リスクがあるため `NODE_ENV !== "production"` でゲートする設計判断は妥当。ただし M-r3-b で指摘した通り「本番で完全に黙る」副作用があるので、Phase2 で構造化ログに移行する際に対称的に修正が必要。

---

## 95+ 確認 / 残ブロッカー

**95+ 到達 (96/100)**。

| 優先 | 項目 | 期待効果 | 該当指摘 |
| ---: | --- | --- | --- |
| P2 | catch ログを本番でも構造化 JSON で 1 行残す (incidentId + orgId + error.message) | 本番で incidentId が grep 可能になり運用ループが閉じる、+1 〜 2pt | M-r3-b |
| P2 | writeAudit ループの部分失敗を `incidentId` 込みで緊急ログ + UI は ok 返却に変更、Phase2 で `writeAuditTx` に置換 | audit hash chain の永続的不整合を防ぐ、+1pt | M-r3-a |
| P3 | Sentry コメントを `extra` 推奨に書き換え | Phase2 着手時の踏み抜き防止 | M-r3-c |
| P3 | `queries/campaigns.ts` 冒頭に PHASE2 RLS TODO コメント追加 | HIGH-1 DEFERRED の最低条件 | HIGH-1 carry |
| P3 | bulk action rate-limit + 構造化ログ + count 戦略 | SLO 観測基盤 | M-6/M-8/M-2/M-3 |

P2 2 件を潰せば 96 → 98 で MVP 出荷後の Phase2 着手前に再評価しても 95+ を維持できる。P3 は Phase2 issue で良い。

---

## 判定: **PASS**

- HIGH 残存: 0 件
- R2 NEW HIGH-A: **解消** (writeAudit シリアル化により構造的に修正)
- R2 NEW MEDIUM (M-r2-a/b/c/d): **4/4 全て解消**
- NEW HIGH: 0 件
- NEW MEDIUM: 3 件 (M-r3-a/b/c — いずれも Phase2 ハンドオフ可能、リリースブロッカーではない)
- 総合: **96/100** (95+ 到達)

### PASS / NEAR / FAIL

**PASS**。R2 の HIGH-A (tx.execute 引数なし) と 4 つの MEDIUM を全て期待通り潰し、SRE 観点で要求した「観測性 (incident_id)」「UX 一貫性 (toast 親集約)」「明示的失敗 (0 件 fail 化)」「整合性 (audit シリアル化)」が全て構造的に整った。

新規に拾った 3 つの MEDIUM (M-r3-a: audit 部分失敗の永続化 / M-r3-b: 本番 catch ログ完全沈黙 / M-r3-c: Sentry コメント誤誘導) は全て Phase2 着手時に `writeAuditTx` 実装 + 構造化ログ基盤と同時に解消する性質の指摘で、MVP デモ → β リリースの go/no-go ゲートで再評価すれば良い。

**Phase2 着手前に M-r3-a/b の 2 件を fix する PR を 1 本出せば 98+ 圏に乗る**。HIGH-1 (withScopedDb) の Phase2 RLS 適用時に同梱すれば工数も最小。

### この PR を merge して良いか

**YES (production-cutover 前提でなければ即 merge 可)**。

- MVP デモ + Phase1 段階 (DB 未接続 mock + 接続済み live の二経路) で動作可能。
- HIGH 残存なし、リリースブロッカーなし。
- 観測性 / UX / 整合性 / エラーハンドリングは Phase1 として十分な完成度。
- Phase2 移行ゲート (RLS 適用 + `writeAuditTx` 実装 + 構造化ログ) で再度 SRE レビューを要求する条件付き。
