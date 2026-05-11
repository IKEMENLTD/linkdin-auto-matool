# S07 リード一覧 — SRE Review (r2)

Reviewer: sre-agent (read-only, production-mode on)
Date: 2026-05-11
Predecessor: `docs/reviews/s07-r1/sre.md` (69/100 FAIL)

Scope (R2 で再確認したファイル):

- `server/queries/leads.ts` (listLeads / getLeadById)
- `server/actions/leads.ts` (bulkDisqualifyLeads)
- `lib/audit.ts` (writeAudit)
- `lib/incident.ts`
- `db/client.ts`
- `app/(app)/leads/page.tsx`

---

## Summary

| 軸                                       |   R1 |   R2 | Δ    |
| ---------------------------------------- | ---: | ---: | ---: |
| 1. パフォーマンス                        |   13 |   15 | +2   |
| 2. エラーハンドリング                    |   14 |   18 | +4   |
| 3. 観測性                                |   13 |   16 | +3   |
| 4. ユーザビリティ運用                    |   18 |   18 | ±0   |
| 5. キャパシティ・安全                    |   11 |   17 | +6   |
| **総合**                                 | **69** | **84** | **+15** |

判定: **NEAR (90+ 未達)** — R2 で HIGH 3 件解消したが、HIGH-S1 が**部分対応のみ**でフル解決していない。残 HIGH 1 件 (S1 残課題) + Phase2 carry 2 件 (P1/P2) で 90 まで届かない。

---

## R1 で挙げた HIGH の R2 対応評価

### HIGH-S1: bulk audit race — **PARTIAL (+4, full は +6)**

R1 指摘: `for (row of updated) { await writeAudit(...) }` で 500 件 N+1 + hash chain race + 原子性違反。

R2 修正 (`server/actions/leads.ts:52-81`):

```ts
const updated = await db.transaction(async (tx) => {
  return tx.update(schema.leads).set(...).where(...).returning(...);
});

if (updated.length > 0) {
  await writeAudit({
    action: "lead.bulk_disqualified",
    targetId: updated.length === 1 ? updated[0].id : `bulk:${updated.length}`,
    diff: { state: { to: "DISQUALIFIED" }, target_ids: updated.map(r => r.id), requested_count: ... },
  });
}
```

評価:

- ✅ **N+1 撲滅** — 500 件分の writeAudit ループが 1 件に集約 (audit_log 行数 500→1)。これは大きな改善。Vercel Functions 10s タイムアウトリスクも解消。
- ✅ **bulk_disqualified action 新設** — `lib/audit.ts:19` に `lead.bulk_disqualified` を AuditAction 型に追加済み。設計書 §17 の type-safety も保持。
- ⚠️ **原子性 (UPDATE + audit) 未達** — `db.transaction(async (tx) => { return tx.update(...).returning(...) })` の中身が UPDATE のみで、`writeAudit` は**トランザクション外**で呼ばれている (`server/actions/leads.ts:53` で tx クローズ後、`:69` で writeAudit)。
    - 結果: UPDATE 後・audit insert 前に Function crash / DB connection drop が起きると **DISQUALIFIED にはなったが audit_log には残らない** = §17 改竄耐性違反。
    - 修正コスト: `writeAudit` を `tx` を受けるオーバーロード (`writeAudit(input, tx?)`) にして、`db.transaction` 内で呼ぶだけ。10-15 行。
- ⚠️ **hash chain race 未達** — `writeAudit` 内部 (`lib/audit.ts:53-91`) は **SELECT prev_hash → INSERT** を 2 クエリで非トランザクション実行。
    - 並行 bulk が同 orgId で走ると `SELECT prev_hash` が同じ値を読み、両方が同じ prev_hash を持つ枝が INSERT される。chain が**分岐 = 検証時 detect 不能**。
    - 同じ tx で囲んでも postgres デフォルト READ COMMITTED では prev_hash の write skew は防げない。`SERIALIZABLE` か `pg_advisory_xact_lock(hashtext('audit:' || org_id))` が必要。
    - 修正コスト: writeAudit 冒頭で `await tx.execute(sql`SELECT pg_advisory_xact_lock(${...})`)` 1 行。

**結論**: N+1 と監査エントリ肥大化は解決したが、設計書 §17 の "改竄耐性 / 検証可能性" 観点では race 経路が残っている。本番並行 bulk 操作が日常的にある UI なので、**最低でも `writeAudit` を `tx` 受領版にして同一トランザクション化**してほしい (advisory lock は Phase2 でも可)。

スコア: +4 (full +6 を狙うなら writeAudit tx 同梱が必要)

### HIGH-E1: getLeadById catch{} — **DONE (+2)**

R2 修正 (`server/queries/leads.ts:222-228`):

```ts
} catch (e) {
  const incidentId = newIncidentId();
  if (process.env.NODE_ENV !== "production") {
    console.error(`[getLeadById] ${incidentId}`, e);
  }
  return null;
}
```

評価:

- ✅ incident_id 発行 → R1 で挙げた "ユーザーに見える ID が SRE 側で逆引きできない" 問題は **logger 配線時に紐付けられる土台ができた**。
- ✅ listLeads (`:141`) と同じパターンで統一されており、後で logger 配線時に grep 一括置換可能。
- ⚠️ `getLeadById` の incidentId が **戻り値に乗っていない** → drawer UI で「現在取得できません (INC-xxx)」と表示できない。`getLeadById` の戻り型を `LeadListItem | null | { error: true; incidentId: string }` に分岐させるのが理想。
    - ただし drawer UI 側は「404 か取得失敗かを区別しない」設計 (`lead-drawer.tsx:198` のメッセージ) なので、**Phase2 carry** で許容範囲。R2 の評価としては full PASS。
- ⚠️ `console.error` の `NODE_ENV !== "production"` ガードは残存 (R1 HIGH-O1 とも共通)。これは HIGH-O1 側の Phase2 carry として既に合意済み。

スコア: +2 (HIGH-E1 として満点)

### HIGH-O1: incident_id 発行は実装、SDK 配線 Phase2 — **ACCEPTED (+3)**

R2 確認:

- ✅ `lib/incident.ts:11-15` で `INC-YYYY-XXXXXX` を crypto.randomBytes(3) ベースで生成。R1 で論じた誕生日衝突 (~3.7% / 年間36500件) も実装コメントに明示。
- ✅ listLeads / getLeadById で incidentId を発行し、UI まで配線済み (`page.tsx:93-101`)。
- ⚠️ ただし **incidentId が DB / 集約 log のどこにも永続化されない** ため、ユーザーから INC-2026-A1B2C3 と言われても SRE 側で原因リクエストへ逆引きできない。これは R1 HIGH-O1 のまま残る。
    - 「Phase2 で Sentry / pino 配線」と明示されているので、R2 の評価としては **incident_id 発行レイヤ完成** = HIGH-O1 半分達成扱い。
- ⚠️ `bulkDisqualifyLeads` の catch (`server/actions/leads.ts:93-96`) は **incident_id 未発行**。R1 MEDIUM-E2 と表裏一体 (catch のテキストに INC を埋めるとサポート連絡が機能する)。Phase2 carry なら許容だが、ここは listLeads と一貫させる方がコスト 5 行で済む割に効くので**強く推奨**。

スコア: +3 (incident_id 発行レイヤとしては OK、配線残)

### HIGH-P1: count(*) 重い — **PHASE2 CARRY (0)**

- R1 指摘 (50万件 org で毎リクエスト count フルスキャン) は R2 未着手。`server/queries/leads.ts:118-122` の count(*) はそのまま。
- Phase2 で `unstable_cache(30s)` 対応合意済み。
- スコア加点: 0。R1 評価 (HIGH-P1 = +3 想定) のうち 0 点。

### HIGH-P2: ILIKE pg_trgm GIN — **PHASE2 CARRY (0)**

- R1 指摘 (3 列 ILIKE が GIN 不在でフルスキャン) は R2 未着手。`db/schema.ts` の leads index に trgm GIN 追加 migration はまだ。
- Phase2 で migration 合意済み。
- スコア加点: 0。

---

## R1 で挙げた MEDIUM の R2 状態 (差分のみ)

| #     | R1 | R2 確認                                                                                                      |
| ----- | -: | ------------------------------------------------------------------------------------------------------------ |
| MED-P3 |  - | leads (org_id, last_action_at DESC) 複合 index 未追加。Phase2 carry                                          |
| MED-P4 |  - | getLeadById ショートサーキット未実装。drawer 開く度に追加 1 クエリ。Phase2 carry                             |
| MED-E2 |  - | bulk error msg に incident_id 未同梱。R1 から悪化していないが改善もなし                                      |
| MED-O2 |  - | correlationId 伝播未実装 (writeAudit は受け取れるが渡されていない)                                           |
| MED-O3 |  - | metrics 計装ゼロ                                                                                             |
| MED-S2 |  - | rate limit 未実装                                                                                            |

→ MEDIUM はほぼ全件 carry。これらが 90+ 到達のもう一段の差分。

---

## R2 で潰した不可視の副次効果 (Positive)

R2 commit を読んで気付いた、R1 では明示していないが改善された点:

1. **audit_log 行数の劇的削減**
    - bulk 500 件 → audit 1 件で済む。設計書 §17 の audit_log retention (3年保持/Cold storage) コストが 500 倍効率化。
    - 監査読み返し時の UI も "1 アクション = 1 行" で見やすい。

2. **bulk_disqualified の target_ids が JSON diff に内包**
    - 後で `WHERE diff->'target_ids' @> '["uuid"]'` で個別リードの除外履歴を引ける (Phase2 の jsonb GIN index 前提)。設計書 §17.4 の "個別リード監査追跡" との互換性が維持されている。

3. **`tx.update().returning()` の戻り値で audit に渡している**
    - UPDATE 対象 ID が parsed.data.ids と異なる可能性 (RLS / org_id mismatch でフィルタされる) を吸収できている。R1 では `parsed.data.ids` をそのまま audit に書く実装も想定したが、R2 は厳密に "実際に UPDATE された ID" を記録 = 監査の正確性 ↑。

---

## R2 で新規に検出した懸念 (NEW)

### NEW-1 (MEDIUM): targetId = `bulk:${count}` の検索性

`server/actions/leads.ts:74` で `targetId: updated.length === 1 ? updated[0].id : `bulk:${updated.length}``

- `bulk:500` のような targetId は本来 UUID 列を想定する audit_log.target_id に文字列を入れることになる。
- `db/schema.ts` 側で target_id が `text` 型なら問題ないが、`uuid` 型だと型エラー / runtime crash の可能性。
- 確認すべき: `db/schema.ts:audit_log.target_id` のカラム型。

→ schema を要確認。文字列 column ならスルーで OK、uuid なら R3 で text へ変更必要。

### NEW-2 (LOW): writeAudit が tx を受け取れない設計

- 現状 `writeAudit(input)` のみ。tx を引数で受けられないので、HIGH-S1 を完全に潰すには **`writeAudit(input, tx?: Database)`** 形のリファクタが要る。
- これは S07 単体ではなく **全 audit 呼び出し箇所の API 変更** になるので影響範囲を見極めて Phase2 で集約推奨。

### NEW-3 (LOW): bulkDisqualifyLeads が DEMO mode (DB null) で sl=ent fail

- `db/client.ts:14` で `DATABASE_URL` 未設定時 `getDb() = null`、`server/actions/leads.ts:48-50` で `db` null → "データベースに接続できません" を返す。
- 一方 `listLeads` (`:62-72`) は同条件で mockLeads を返す。**bulk アクションのみ DB 必須**。
- DEMO 環境 (info@revirall.jp のメモリにある `mock` UI demo) で "DEMO バッジは出ているのに bulk 押すとエラー" という UX 不一致が出る。
- 推奨: bulk アクション側も `source === "mock"` 状態を session/cookie から検出して "DEMO モードでは bulk 操作は無効です (`UI 側で disable`)" と先出しガード。

---

## 90+ 到達に必要な R3 修正一覧 (優先順)

| #     | 優先度 | 概要                                                                          | 想定加点 |
| ----- | ------ | ----------------------------------------------------------------------------- | -------- |
| S1-残 | HIGH   | writeAudit を tx 受領版にして UPDATE と同一 transaction、advisory lock 追加  | +2       |
| P1    | HIGH   | listLeads count(*) を unstable_cache(30-60s) or hasMore に変更                | +3       |
| P2    | HIGH   | leads (full_name/company/headline) に pg_trgm GIN migration                  | +2       |
| E2    | MED    | bulkDisqualifyLeads catch で incident_id 発行 + message に同梱                | +1       |
| O1-残 | MED    | logger (pino/winston) 配線、`NODE_ENV !== "production"` ガード撤去            | +1       |

R3 で +9 → 93/100 で **90+ PASS** 見込み。

---

## HIGH 残存 / NEW HIGH

- **HIGH 残存** (Phase2 合意済): HIGH-P1 (count), HIGH-P2 (pg_trgm)
- **HIGH 部分対応**: HIGH-S1 (writeAudit tx 同梱が残)
- **NEW HIGH**: なし
- **NEW MEDIUM/LOW**: NEW-1 (targetId column 型), NEW-2 (writeAudit tx 引数), NEW-3 (DEMO mode bulk fail)

---

## 90+ 判定

- 総合スコア: **84/100**
- 判定: **NEAR (90+ 未達)**
- 理由:
    1. HIGH-S1 が部分対応 (N+1 解消は OK だが tx 外 audit と hash chain race が残)
    2. HIGH-P1 / HIGH-P2 が Phase2 carry のため performance 軸が 15/20 止まり
    3. MEDIUM 群がほぼ手付かずで観測性 16/20 / エラー 18/20 が頭打ち

R1 (69) → R2 (84) は **+15 で大幅改善**、HIGH 3 件中 2 件は綺麗に潰せている。S1 を full 対応 + P1/P2 を Phase2 でなく R3 で同梱できれば 1 巡で 90+ 到達可能。

---

## 関連ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\leads.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\leads.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\incident.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\client.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\leads\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s07-r1\sre.md` (R1 比較元)
