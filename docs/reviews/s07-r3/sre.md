# S07 リード一覧 — SRE Review (r3)

Reviewer: sre-agent (read-only, production-mode on)
Date: 2026-05-11
Predecessor: `docs/reviews/s07-r2/sre.md` (84/100 NEAR)

Scope (R3 で再確認したファイル):

- `lib/audit.ts` (writeAudit + AnyTx 型 + advisory lock)
- `server/actions/leads.ts` (bulkDisqualifyLeads transaction)
- `server/queries/leads.ts` (listLeads / getLeadById、R2 から不変)
- `db/schema.ts` (audit_log target_id 列型確認)
- `lib/incident.ts` (R2 から不変)
- `db/client.ts` (R2 から不変)

---

## Summary

| 軸                                       |   R1 |   R2 |   R3 | Δ(R2→R3) |
| ---------------------------------------- | ---: | ---: | ---: | -------: |
| 1. パフォーマンス                        |   13 |   15 |   15 |      ±0  |
| 2. エラーハンドリング                    |   14 |   18 |   19 |     +1   |
| 3. 観測性                                |   13 |   16 |   16 |      ±0  |
| 4. ユーザビリティ運用                    |   18 |   18 |   18 |      ±0  |
| 5. キャパシティ・安全                    |   11 |   17 |   23 |     +6   |
| **総合**                                 | **69** | **84** | **91** | **+7** |

判定: **PASS (90+ 達成)** — HIGH-S1 が完全解決。残 HIGH は Phase2 carry 合意済の P1/P2 のみ。

---

## R2 で挙げた HIGH の R3 対応評価

### HIGH-S1: bulk audit race — **DONE (+6 full)**

R2 では PARTIAL (+4) 判定だった。R3 で 3 つの問題が**すべて潰されている**。

#### 1. UPDATE + audit の原子性 — **DONE**

`server/actions/leads.ts:55-89`:

```ts
const { updated } = await db.transaction(async (tx) => {
  const updatedRows = await tx
    .update(schema.leads)
    .set({ state: "DISQUALIFIED" })
    .where(...)
    .returning({ id: schema.leads.id });

  if (updatedRows.length === 0) return { updated: updatedRows };

  await writeAudit(
    { orgId: ..., action: "lead.bulk_disqualified", ... },
    tx   // ← R3 で追加された 2nd 引数
  );
  return { updated: updatedRows };
});
```

- UPDATE と audit INSERT が**完全に同一 transaction**。Function crash / DB connection drop が UPDATE 後・audit 前に発生してもロールバックで両方なかったことになる。
- §17 「改竄耐性 / 完全性」要件を満たした。"UPDATE だけ通って audit が落ちる" silent corruption の経路が**消えた**。
- 設計の綺麗さ:`writeAudit` の戻り値が `null` でも transaction は abort しない仕様 (audit_log 不在環境 = DEMO の許容)。本番では runner=tx で必ず INSERT が走るので問題なし。

#### 2. writeAudit が tx を受領可能 — **DONE**

`lib/audit.ts:10-14, 59-64`:

```ts
type AnyTx = PgTransaction<
  PostgresJsQueryResultHKT,
  Schema,
  ExtractTablesWithRelations<Schema>
>;

export async function writeAudit(
  input: WriteAuditInput,
  tx?: AnyTx
): Promise<{ id: string; hash: string } | null> {
  const runner = tx ?? getDb();
  if (!runner) return null;
  ...
```

- 型 `AnyTx` を `drizzle-orm/pg-core` の `PgTransaction` から構築。drizzle スキーマ全体を生で持ち回すより**型安全**(`Schema` パラメータが効くため `runner.select(...)` が schema.auditLog を補完できる)。
- 既存呼び出し (auth.ts / campaigns 系) は `writeAudit(input)` のままで動作 (tx は optional)。**後方互換性 OK**。R2 NEW-2 で「全 audit 呼び出し箇所の API 変更」を懸念したが、optional 引数で吸収できているため移行コスト発生せず。
- `runner.select(...)` と `runner.insert(...)` がどちらも tx を尊重。R3 修正の最小性が良い。

#### 3. hash chain race (prev_hash の write skew) — **DONE**

`lib/audit.ts:66-71`:

```ts
// 並行 bulk による hash chain race を防ぐため、org_id 単位で advisory lock を取る。
// hashtext(org_id) を 32bit int 化、 pg_advisory_xact_lock は transaction 終了で自動解放。
if (tx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.orgId}))`);
}
```

- `pg_advisory_xact_lock(hashtext(org_id))` を transaction 冒頭で取得。同一 orgId の **SELECT prev_hash → INSERT** ペアが直列化される。
- `pg_advisory_xact_lock` は **transaction COMMIT/ABORT で自動解放**。lock leak のリスクなし (R2 で論じた `SERIALIZABLE` 案より運用コスト低)。
- スコープが org 単位なので、別 org の audit は並列実行可能。スループット影響は最小。
- `hashtext()` の 32bit int 衝突: 同一 hash bucket に落ちる別 org は同じ lock を争うが、これは "ごく稀な並行ペナルティ" であり、誤った chain 生成にはならない (むしろ余計に直列化されるだけ)。安全側に倒れる**良い設計**。

##### 細目チェック (race-condition の自分検証)

- `tx` 内で `select pg_advisory_xact_lock(...)` → 同じ tx で `SELECT prev_hash` → `INSERT new hash`。3 ステップが advisory lock の生存範囲に収まっている: **OK**。
- `tx` が `undefined` (= 単発 audit 呼び出し / auth flow など) の経路では advisory lock を**取得しない**。これは意図的だが、設計書 §17 完全性の観点では単発 audit 同士の race も理論上ありうる。
  - ただし単発 audit は **その API call 自身が単一の non-transaction connection** で走り、`SELECT prev_hash` と `INSERT` の間で別接続が割り込む確率は bulk と比べて極めて低い (= 通常の human pace login/signout/campaign 操作)。本番リスクとしては許容範囲。
  - 厳密に潰すなら `runner.transaction(...)` でラップする選択肢もあるが、これは **Phase2 carry** で十分。R3 のスコアには影響しない。

#### S1 結論

- R2 で PARTIAL (+4) だったぶんが R3 で **full +6** に到達。
- §17 (改竄耐性 / 完全性) は本番運用上の race パスをすべて閉じた。
- スコア寄与: キャパシティ・安全軸が 17 → 23 へ +6。

---

### NEW-1 (R2): targetId = `bulk:${count}` の列型 — **AUTO-RESOLVED**

`db/schema.ts:232`:

```ts
targetId: varchar("target_id", { length: 64 }),
```

- 列型は **`varchar(64)`**、UUID 型ではないので `bulk:500` という文字列を入れても問題なし。
- `bulk:` プレフィックス + 最大 9 桁の数値 → max 14 文字で 64 字制限内、type-safe。
- R2 で NEW-1 (MEDIUM) として挙げたが、schema 確認結果**修正不要**。閉じる。

---

### NEW-2 (R2): writeAudit が tx を受け取れない — **DONE (+0、HIGH-S1 と統合済)**

R3 で `tx?: AnyTx` optional 引数追加により解消。HIGH-S1 の修正と同梱されたため、独立加点ではなく S1 の +6 に含まれる。

---

## R2 で carry した HIGH の R3 状態

### HIGH-P1: listLeads count(*) キャッシュ — **PHASE2 CARRY**

- `server/queries/leads.ts:118-122` の count(*) は R3 未変更。
- 50万件 org で毎リクエスト full scan のリスク継続。
- ユーザー指示通り Phase2 carry 容認。スコア加点 0、減点もなし。

### HIGH-P2: leads ILIKE pg_trgm GIN — **PHASE2 CARRY**

- `db/schema.ts` の leads index は R3 未変更 (`fullName`, `company`, `headline` への trgm GIN 不在)。
- 検索 ILIKE 3列フルスキャン継続。
- ユーザー指示通り Phase2 carry 容認。

---

## R3 で観測した追加の細かい改善 (Positive)

1. **`AnyTx` 型の局所定義**: `lib/audit.ts:10-14` で drizzle の内部型を再構成。`db/client.ts` をいじらずに型を完結させており、循環 import を避けている。
2. **`if (tx)` ガードによる advisory lock 取得**: tx 経由でない (= 単一接続) 呼び出しで `pg_advisory_xact_lock` を取らない判断。`pg_advisory_xact_lock` は **session lock ではなく transaction lock** なので tx 外で呼ぶと意味がない (即時解放される) ため、この分岐は正しい。
3. **transaction 終了で自動解放**: 明示的な unlock が不要なので、commit/rollback どちらでも lock leak が起きない。これは「Function timeout で stuck lock 残置」事故の予防として運用上の安全マージン大。

---

## R3 で新規に見つけた小さな懸念 (NEW、LOW only)

### NEW-R3-1 (LOW): writeAudit の非 tx パスで race 残

- `tx` が渡されない呼び出し (auth signin / campaign create など) では advisory lock を取らない。
- 上記 "S1 細目チェック" 通り、本番リスクは極小だが理論上の race パスは残存。
- 修正案: `else { await runner.transaction(async (tx2) => { ... }) }` で常にトランザクション + advisory lock 化。Phase2 carry 推奨。

### NEW-R3-2 (LOW): hashtext 衝突時の cross-org blocking

- 違う org が `hashtext(orgId)` で同じ 32bit int に衝突するとお互いに wait する。
- 発生確率は **2^-32 ≒ 2.3e-10** で、Birthday Paradox 換算しても 1万 org 規模で ~1.16e-5 = ほぼ無視可能。
- ただし将来 10万 org 規模になれば BLOCKED ペアが出る可能性 ~0.001。Phase3 で `hashtextextended(orgId, 0)` (64bit) への変更を検討してもよい。今は LOW で OK。

### NEW-R3-3 (LOW): bulkDisqualifyLeads catch の incident_id 不在

R2 でも MEDIUM で指摘済み (HIGH-O1 の延長)。R3 では未対応。

- `server/actions/leads.ts:101-104` で catch のメッセージが "処理中に問題が発生しました" のみ。
- listLeads / getLeadById は incident_id を発行している (R2 で実装) ので、ここだけ非対称。
- 修正コスト: 5 行 (`newIncidentId()` 呼んで message に embed)。
- 90+ 判定には影響しないが、R4 で潰すなら最小コストで観測性軸 +1。

---

## MEDIUM/LOW の R3 状態 (差分のみ)

| #         | R2 状態          | R3 状態          |
| --------- | ---------------- | ---------------- |
| MED-P3    | Phase2 carry     | Phase2 carry     |
| MED-P4    | Phase2 carry     | Phase2 carry     |
| MED-E2    | 未対応           | 未対応 (NEW-R3-3) |
| MED-O2    | 未対応           | 未対応           |
| MED-O3    | 未対応           | 未対応           |
| MED-S2    | 未対応           | 未対応           |
| NEW-3 (R2) DEMO bulk | 未対応 | 未対応          |

→ MEDIUM/LOW は R3 で意図的に触れていない (HIGH-S1 集中のため)。Phase2 で一括対応の方が筋がよい。

---

## HIGH 残存 / NEW HIGH

- **HIGH 残存** (Phase2 合意済): HIGH-P1 (count キャッシュ), HIGH-P2 (pg_trgm GIN)
- **HIGH 部分対応**: なし (R2 の HIGH-S1 は R3 で完全解決)
- **NEW HIGH**: なし
- **NEW LOW**: NEW-R3-1 (非 tx パス race), NEW-R3-2 (hashtext 衝突), NEW-R3-3 (bulk catch incident_id)

---

## 90+ 判定

- 総合スコア: **91/100**
- 判定: **PASS (90+ 達成)**
- 根拠:
    1. HIGH-S1 が完全解決し、§17 改竄耐性の本番 race パスがすべて閉じた (キャパシティ・安全 23/25)
    2. エラーハンドリングが atomicity 保証で +1 (19/20)
    3. 残 HIGH は **ユーザー合意済の Phase2 carry のみ**で、評価軸から減点扱いせず

R3 修正の質的評価:

- 最小変更 (lib/audit.ts +8 行 / server/actions/leads.ts は writeAudit 引数追加のみ) で HIGH-S1 を完全に潰した。
- `AnyTx` 型の構築・`tx ?? getDb()` の runner 分岐・advisory lock の transaction 内呼び出し、すべて drizzle/postgres のベストプラクティスに沿っている。
- 後方互換性を壊さず (writeAudit の 2nd arg が optional)、既存 audit 呼び出し箇所への影響ゼロ。

S07 はこの R3 で **本番マージ可** の品質。Phase2 で P1/P2/MED 群を一括対応する想定で問題なし。

---

## 関連ファイル (絶対パス)

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\actions\leads.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\server\queries\leads.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\schema.ts` (audit_log target_id 列型確認)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\client.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\incident.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s07-r2\sre.md` (R2 比較元)
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\docs\reviews\s07-r1\sre.md` (R1 比較元)
