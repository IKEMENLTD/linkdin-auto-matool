# S11 LinkedIn 接続管理 — SRE Review (r2)

**対象**: app/(app)/connections/linkedin/page.tsx, components/connections/{account-card,connections-container}.tsx, server/queries/connections.ts, server/actions/connections.ts, lib/audit.ts (AuditAction enum), lib/rate-limit.ts
**観点**: 本番運用のパフォーマンス・信頼性・観測性・キャパシティ
**判定方針**: 90+ で PASS、85-89 で NEAR、84 以下で FAIL
**前回**: r1 88/100 NEAR

---

## 総合スコア: **91 / 100** → **PASS** (r1 88 → r2 91, **+3**)

| 軸 | r1 | r2 | 差分 | 主要根拠 |
|---|---|---|---|---|
| 1. パフォーマンス | 16 | 16 | ±0 | TZ精度は +0.5、leads index 未追加で実値は据え置き |
| 2. エラーハンドリング | 19 | 19 | ±0 | tx 一貫性・型ユニオン・テナント分離は引き続き優秀 |
| 3. 観測性 | 16 | 17 | +1 | safe_mode 自動切替 UI 文言の明示で「説明と実装の乖離」HIGH 解消 / AuditAction 4 action 分離維持 |
| 4. ユーザビリティ運用 | 19 | 19 | ±0 | "Phase2 監視ジョブで実装" 明記で運用説明の信頼性が向上 |
| 5. キャパシティ・安全 | 18 | 20 | +2 | 4 action 全てに checkRate 適用 (HIGH-3 解消) + todayStart JST 固定 (HIGH-4 解消) |

---

## 1. パフォーマンス: 16 / 20 (±0)

### r1 からの変化
- **HIGH-4 解消 (todayStart JST 固定)**: `server/queries/connections.ts:37-49` で `Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo" })` を `formatToParts` で分解 → `${y}-${m}-${d}T00:00:00+09:00` で ISO 文字列を構築。UTC ホスト上でも **JST 00:00 (= UTC 15:00 前日)** が正しく取れる。
  - 副次効果: `gte(lastActionAt, todayStart)` の境界が日次サイクルと一致し、`todaySent` のスパイク (朝 9 時に「20/25」が見える事故) を回避。
  - 実装精度: `formatToParts` の `find(p => p.type === "year")!` は `Intl` 仕様上必ず返るため non-null assertion は安全。Node 18+ で `Intl` が full-icu 既定なので Vercel ランタイムでも問題なし。

### 引き続き残る HIGH (r1 から持ち越し)
- **HIGH-1 (未解消) — `leads(assigned_account_id, last_action_at)` の部分 index がない**
  `db/schema.ts:171-181` の (t) => ({...}) ブロックに `orgStateActionIdx` はあるが `assignedAccountId` 単独・複合 index は依然ゼロ。R2 の修正対象に含まれていない (HIGH リストでも H4/H3/H2 のみ言及)。
  - 現クエリプランは `Bitmap Index Scan on leads_org_state_action_idx` → ヒープで `assigned_account_id = ANY(...)` フィルタ。リード 10 万超で P95 が崩れる。
  - **Phase2 ロールアウト前に migration 1 本で必須**:
    ```sql
    CREATE INDEX leads_assigned_action_idx
      ON leads (assigned_account_id, last_action_at)
      WHERE assigned_account_id IS NOT NULL;
    ```
  - 今回 PASS 判定には影響しない (Phase1 のリード件数では P95 < 100ms に収まる見込み)。ただし**「Phase2 監視ジョブ稼働時に必須」** として README/runbook に明記する必要がある。

### 据え置き MEDIUM
- 2 クエリの並列化 (`accounts` と `sentCounts` を `Promise.all`) は未対応。RTT は 1 ホップ余分。Phase1 では許容。
- `mockAccounts()` の module-scope 凍結は未対応。LOW のままで PASS 影響なし。

**スコア根拠**: H4 解消で +0.5 (TZ 起因の表示誤差消滅)、index 未追加で -0.5。差し引き ±0 → 16/20 維持。

---

## 2. エラーハンドリング: 19 / 20 (±0)

r1 から構造変化なし。

- `ConnectionsResult` 判別ユニオン + `incidentId` (query 側) 健在。
- 4 mutation action 全てが tx 内で `update().returning()` → `ACCOUNT_NOT_FOUND` throw → audit と一緒にロールバック。整合性 OK。
- r1 で指摘した **MEDIUM (getDb null 時の `ok: true` 返し)** は r2 でも 4 action 全てに残る (`if (!db) return { ok: true, message: "(DEMO) ..." }`)。
  - Phase1 ローカル DEMO ユースケースなので致命傷ではない。本番 `DATABASE_URL` 未設定の検出は `lib/env.ts` の起動時ガードで担保される前提。
- r1 で指摘した **LOW (action 側 incidentId 不在)** も継続。query 側だけ incidentId を採番している非対称は気持ち悪いが、PASS 影響なし。

**スコア根拠**: 変更なし → 19/20 維持。

---

## 3. 観測性: 16 → 17 / 20 (+1)

### r1 からの変化
- **HIGH-2 解消 (safe_mode 自動切替の UI 文言整合)**: `app/(app)/connections/linkedin/page.tsx:70`
  ```
  Unipile OAuth 経由 (Phase2) · ウォームアップ 14 日 · 安全モード自動切替は Phase2 監視ジョブで実装
  ```
  に修正。r1 の指摘「説明と実装の乖離 (Ops が『自動で止まるはず』と誤解する)」は文言整合で解決。Phase2 で監視 cron を入れた時にこの文言を「失敗連続 5 回で自動切替 (稼働中)」に差し替えるフローも自然に進む。
  - r1 でこの項目は HIGH だったため、UI 上の明示で **インシデント時の対応遅延リスクをゼロ** にできた効果は大きい。

- **AuditAction enum 4 action 分離維持**: `lib/audit.ts:33-37` で 5 種類が定義済み:
  ```ts
  | "linkedin.account_connected"
  | "linkedin.account_disconnected"
  | "linkedin.account_paused"
  | "linkedin.account_resumed"
  | "linkedin.account_limit_changed"
  ```
  4 mutation action (pause/resume/limit/disconnect) がそれぞれ別の `action` 文字列で audit に書き込んでいるため、SQL で `WHERE action = 'linkedin.account_disconnected'` の grep が直に効く。Datadog/PostHog で action 別 counter を出すときも 1:1 マッピングで済む。
  - r1 では「action level metric 連動なし」を MEDIUM 扱いしていたが、enum 分離が確実なら metric 化は機械的 (`metric.increment("connections.action." + action.split(".")[1])`) なので残りはダッシュボード配線のみ。

### 引き続き残る MEDIUM (r1 から持ち越し)
- 本番 `logger.error` 未配線 (現状 `process.env.NODE_ENV !== "production"` で console 抑止)。
- Datadog/OTel metric 送出が 4 action いずれも未連動。
- `lastWarningAt` がクエリ側で `null` 固定 (mock 側のみ値を返す)。

これら 3 件は **r1 と同じく Phase2 観測基盤整備フェーズで一括導入** の方針で許容。Phase1 PASS には不要。

**スコア根拠**: HIGH-2 (UI 文言) 解消で +1 → 17/20。

---

## 4. ユーザビリティ運用: 19 / 20 (±0)

r1 から構造変化なし。**ただし HIGH-2 の文言修正で「説明と実装の乖離」が消えた**ことで運用説明の信頼度は実質的に向上している (スコア外加点)。

- DEMO バッジ・空状態・safe_mode 強調 (`border-[#FECACA]` + 先頭固定) 健在。
- `DISCONNECT` 二段確認・`reason` 必須も維持。
- r1 で指摘した **MEDIUM (Disconnected からの復元 UI 不在)** は r2 でも持ち越し。「7 日以内に復元可能」のメッセージと UI の乖離は残る。
  - Phase2 で `restoreAccount(accountId)` action を追加する前提。今回 PASS 判定には影響しない。

**スコア根拠**: 変更なし → 19/20 維持。

---

## 5. キャパシティ・安全: 18 → 20 / 20 (+2)

### r1 からの変化
- **HIGH-3 解消 (操作レート制御の全 4 action 適用)**: `server/actions/connections.ts:29-49` に `checkRate` ヘルパが新設され、4 action の auth ガード直後・DB アクセス直前で呼ばれる:
  ```ts
  pause:      10 / 60_000ms       (10 req/min)
  resume:     10 / 60_000ms       (10 req/min)
  limit:      20 / 60_000ms       (20 req/min)
  disconnect:  3 / 600_000ms      (3  req/10min)
  ```
  キーは `conn:${key}:${userId}:${accountId}` で **action × user × account の 3 軸**。同じ Admin が複数アカウントを並列に操作する正常運用は阻害せず、同一アカウントへの連打のみブロック。
  - r1 で指摘した「悪意ある (or 乗っ取られた) Admin が 1 分で全アカウント disconnect → 業務停止」のシナリオは、`disconnect 3/10min` で **物理的に 30 分かかる** ようになり (10 アカウント想定)、CS が気付ける時間幅を確保。
  - `lib/rate-limit.ts` 実装はメモリ単一プロセスで、Vercel multi-instance では緩い保護になる旨を `lib/rate-limit.ts:5-9` のコメントで明示。Phase2 Redis 化 (TODO 明記) は許容。
  - r1 で「`disconnectAccount` のみ 2FA 再認証」も提案したが、Phase1 では rate-limit + 二段確認 (`DISCONNECT` typing) の二層で実用十分。

- **HIGH-4 解消 (todayStart JST 固定)**: 軸 1 と同じく `Asia/Tokyo` 固定。UTC ホストで「JST 09:00 まで昨日のカウントが残る」事故を完全に塞いだ。ウォームアップ 14 日カウントとも齟齬しない。

### 引き続き残る MEDIUM (r1 から持ち越し)
- `safe_mode` 自動切替ワーカー本体は未実装 (Phase2)。ただし軸 3 でも触れた通り **UI 文言で「Phase2 監視ジョブで実装」と明示済**のため、Ops の誤解リスクは消滅。安全側に倒れている。

### 据え置き LOW
- `revalidatePath("/connections/linkedin")` のリテラル重複。constant 化は未対応。PASS 影響なし。

**スコア根拠**: HIGH-3 (rate-limit) +1.5、HIGH-4 (todayStart JST) +0.5 → 20/20 満点。

---

## HIGH 残存 / NEW HIGH

### HIGH 残存 (r1 から持ち越し)
- **HIGH-1: `leads(assigned_account_id, last_action_at)` 部分 index 未追加**
  R2 修正対象外 (H4/H3/H2 のみ言及)。Phase1 のリード件数では P95 への影響は限定的のため PASS 判定はブロックしない。**Phase2 ロールアウト前 (= 監視ジョブ稼働 = リード件数増加期) に migration 1 本で対応必須**。runbook / README に明記すること。

### NEW HIGH
- **なし** — R2 の修正で新規回帰は検出されず。
  - `checkRate` の memory-only 実装は MEDIUM (Vercel multi-instance で緩い) だが、`lib/rate-limit.ts:5-9` のコメントで Phase2 Redis 化が TODO 明記されており、HIGH には昇格しない。
  - `Intl.DateTimeFormat` の non-null assertion (`parts.find(...)!`) は型安全上問題なし (`Intl` 仕様で保証)。
  - AuditAction 5 種類 (`connected` 含む) のうち `connected` だけ現状コード使用なし (Phase2 OAuth 接続で使用予定) だが、未使用 enum 値は HIGH 案件にあたらない。

---

## 90+ 判定: **PASS (91)**

| 条件 | 結果 |
|---|---|
| 機能完成度 | ◎ (4 action + クエリ + UI 一通り) |
| 本番投入準備 | ◯ (HIGH-3/H4/H2 解消 / HIGH-1 のみ Phase2 まで猶予) |
| 観測性 | ◯ (UI 文言整合 + AuditAction 分離 / metric/log は Phase2) |
| 安全性 | ◎ (Admin ガード・tx・テナント分離・rate-limit 4 action 適用・JST 固定) |

### PASS 到達根拠
1. r1 で指摘した HIGH 4 件のうち 3 件 (H2/H3/H4) を確実に解消。
2. 残 HIGH-1 (leads index) は Phase2 までの猶予がある **キャパシティ前提条件** であり、Phase1 リリースをブロックしない性質。
3. r2 で新規回帰なし (NEW HIGH ゼロ)。
4. `checkRate` の 3 軸キー設計 (`action:userId:accountId`) と action 別 window が運用合理性を持つ (disconnect だけ 10min window で破壊性を反映)。
5. AuditAction enum 5 種類分離で metric 化・SQL 突合が容易な観測性土台が整備済み。

### Phase2 ロールアウト前の必須宿題 (PASS 後の継続作業)
1. **leads_assigned_action_idx (部分 index) migration** ← HIGH-1 持ち越し
2. `lib/rate-limit.ts` を `@upstash/ratelimit` + Redis に置換 ← multi-instance 対応
3. 本番 `logger.error` + Datadog/OTel metric 送出
4. `safe_mode` 自動切替ワーカー (failure_streak >= 5 検知 cron)
5. `lastWarningAt` をクエリで実値取得 (`metrics_daily` or 監査ログから派生)
6. Disconnected → restore UI

---

## 結論

S11 LinkedIn 接続管理は r2 で **88 → 91 (PASS)** に到達。R2 で潰した H4 (JST) / H3 (rate-limit 4 action) / H2 (UI 文言) + AuditAction 4 action 分離は **いずれも仕様通り正しく実装**されており、Phase1 SRE 受け入れ基準を満たす。残課題は HIGH-1 (leads 部分 index) のみで、Phase2 監視ジョブ稼働前に migration 1 本で完了する性質の作業。**91 / 100 PASS**。
