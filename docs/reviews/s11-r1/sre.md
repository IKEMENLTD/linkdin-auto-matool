# S11 LinkedIn 接続管理 — SRE Review (r1)

**対象**: app/(app)/connections/linkedin/page.tsx, components/connections/{account-card,connections-container}.tsx, server/queries/connections.ts, server/actions/connections.ts
**観点**: 本番運用のパフォーマンス・信頼性・観測性・キャパシティ
**判定方針**: 90+ で PASS、85-89 で NEAR、84 以下で FAIL

---

## 総合スコア: **88 / 100** → **NEAR (再修正で 90+ 到達可能)**

| 軸 | スコア | 主要根拠 |
|---|---|---|
| 1. パフォーマンス | 16 / 20 | 2 クエリ並列化なし / ANY(uuid[]) は走るが index 不在 / N+1 はなし |
| 2. エラーハンドリング | 19 / 20 | degraded + incident_id, ACCOUNT_NOT_FOUND, tx 一貫性 OK / DB null fallback が成功扱い |
| 3. 観測性 | 16 / 20 | incident_id 採番済 / 本番ログ無し・metric 未送出・audit はあるが action level metric 連動なし |
| 4. ユーザビリティ運用 | 19 / 20 | DEMO バッジ・空状態・safe_mode 強調・DISCONNECT 二段確認 全て揃う |
| 5. キャパシティ・安全 | 18 / 20 | Admin+ ガード徹底 / 7 日復元はメッセージのみで実装上は表示と乖離 / 操作 rate-limit 不在 |

---

## 1. パフォーマンス: 16 / 20

### 良い点
- `listLinkedinConnections` は **2 クエリのみ** (accounts list → sentCounts per account)。N+1 なし。
- `count(*) FILTER (WHERE state IN ...)` を 1 ラウンドトリップに集約 (送信・返信を 1 グループで取得)。
- `revalidatePath("/connections/linkedin")` でアクション後の再フェッチが ISR キャッシュを汚さない。
- `force-dynamic` + `force-no-store` で stale データを返さない設計。

### 課題
- **HIGH — `leads.assigned_account_id` に index がない**
  `db/schema.ts:164` で `assignedAccountId` は FK だが index 列単独・複合いずれにも入っていない。既存複合 index は `(org_id, state, last_action_at)` のみ。
  今のクエリプランは:
  ```
  Bitmap Index Scan on leads_org_state_action_idx
    Filter: assigned_account_id = ANY('{...}'::uuid[])
  ```
  org 内の全リード行を `(org_id, state, last_action_at)` で絞ったあと、`assigned_account_id = ANY(...)` をヒープに対して逐次フィルタする。リード件数 10 万を超えるテナントでは数百 ms スパイクが避けられない。
  **対策**: `CREATE INDEX leads_assigned_action_idx ON leads (assigned_account_id, last_action_at) WHERE assigned_account_id IS NOT NULL;` (部分 index) を追加し、ANY(uuid[]) ハッシュ join に倒す。Phase2 のスケール前に必須。
- **MEDIUM — 2 クエリの並列実行ができていない**
  `rows` を待ってから accountIds を作って `sentCounts` を投げているため、シリアルに **RTT × 2** かかる。`Promise.all` で fan-out → join in app は無理だが、`accounts` 取得時点で orgId だけ知っていれば `sentCounts` も orgId 主軸で同時並行投げて app で join できる。1 ページロードあたり 30-50ms 短縮 (リージョン跨ぎなら 100ms+)。
- **MEDIUM — `todayStart` の TZ 問題 (詳細は軸 5 参照)**
  サーバ TZ 依存で集計範囲がズレる。UTC ホスト上だと JST 09:00 で「本日カウント」がリセットされる。同じクエリのパフォーマンスには影響しないが、運用上は誤った値を表示することによる**信頼性インシデント**の母数を増やす。
- **LOW — `accounts.length === 0` 時の早期 return は良いが、`mock` は呼び出しのたびに毎回オブジェクト生成。**
  実害は小さいが、`const MOCK_ACCOUNTS = mockAccounts();` を module-scope に上げてフリーズ参照のほうが GC 負荷ゼロ。

### 追加メモ
- `accountIds` が空配列の時に ANY('{}'::uuid[]) になり、PG は空集合を返す。N=0 ガードは不要 (空 → クエリは即返る)。問題なし。
- `count(*)::int` のキャストはオーバーフローしない (PG bigint → int) ことは保証されないが、1 アカウント 1 日 200 件上限なら絶対に int32 を超えない。許容。

---

## 2. エラーハンドリング: 19 / 20

### 良い点
- **`ConnectionsResult` 判別ユニオン**で degraded 状態を型に持ち上げているのは秀逸。`ok: false → reason: "degraded" + incidentId` までセット。ページが alert を出して `incidentId` を `<code>` で表示する流れがクリーン。
- **トランザクション境界**が全 mutation に張られており、`update.returning()` の row 数で `ACCOUNT_NOT_FOUND` を判定 → throw → tx ロールバック → audit も書かれない。整合性が崩れない。
- **`orgId` テナント分離**が全 update の WHERE に入っており、他組織のアカウントを誤更新する経路がない。
- **本番では `console.error` を抑制**し、開発時のみログ出力。スタックトレース漏洩を回避。
- **`writeAudit` をトランザクション内に同梱**し、状態変更と監査ログがアトミック。

### 課題
- **MEDIUM — `getDb()` が null の時に `ok: true` を返す**
  `pauseConnection` 他 4 アクション全てで `if (!db) return { ok: true, message: "(DEMO) ..." };` となっている。**DB 未接続を「成功」として返すのは観測性的に毒**。
  - Phase1 ローカル開発では便利だが、本番でうっかり `DATABASE_URL` 抜けが起きた場合、UI が成功トーストを出し続け、SRE は何時間も気付かない (audit log にも乗らない、incident_id も発行されない)。
  - `process.env.NODE_ENV === "production"` のときだけ `ok: false, message: "現在メンテナンス中です", incidentId` に分岐させるべき。
- **LOW — `incident_id` がアクション側にはない**
  query 側は `newIncidentId()` を発行するが、4 アクションは「処理中に問題が発生しました」を返すだけ。本番運用者が `incident_id` で grep できない。
  最低限 `console.error` の代わりに構造化ログ (`logger.error({ incidentId, action: "linkedin.account_paused", orgId, accountId, err })`) を出し、UI にも `incidentId` を返す形に揃えるべき。query 側と非対称なのが気持ち悪い。

---

## 3. 観測性: 16 / 20

### 良い点
- **`incident_id` の発行**が `lib/incident.ts` 経由で標準化されており、degraded フローでユーザーに ID 表示。CSラインで突合可能。
- **`writeAudit` がトランザクション同梱**で、admin が一時停止/再開/上限変更/切断したログが必ず残る。`purpose` フィールドに人間可読の理由 (一時停止の reason そのもの) が入るのは秀逸 — 半年後の監査でも「なぜ止めたか」が辿れる。
- **`diff: { status: { to: "safe_mode" } }`** の形で変更前後を audit に残しているのは Phase2 ロールバック時に重宝する。

### 課題
- **HIGH — `safe_mode` 自動切替の閾値監視がない**
  CLAUDE.md に「失敗連続 5 回で安全モード自動」とあるが、コード内に閾値判定ロジックが見当たらない。`page.tsx:70` の `subtitle` で「失敗連続 5 回で安全モード自動」と謳っているが、**現状は手動 (pauseConnection) だけ**で自動遷移するワーカーが未配線。
  - ユーザーへの説明と実装のギャップは **インシデント時の対応遅延に直結**する (Ops が「自動で止まるはず」と思い込んで放置)。
  - Phase2 で監視ジョブを入れるならば、page.tsx の説明文を「失敗連続 5 回で安全モード自動 (Phase2)」に揃えるか、Phase1 で最低限の cron を立てるべき。
- **MEDIUM — `metric` 送出がない**
  - `connections.account.paused`, `connections.account.limit_changed`, `connections.action.error` のような counter を Datadog/OpenTelemetry に送る hook がない。
  - 「過去 24h で disconnect された数」「safe_mode 突入率」「daily_limit 変更頻度」が dashboards で見えない。
  - Audit テーブルから後追い集計はできるが、リアルタイムにアラート発火させたい場合は metric が必要 (例: 同一 orgId が 1h で 3 件以上 disconnect → SRE ページ)。
- **MEDIUM — 本番ログが完全に欠落**
  `process.env.NODE_ENV !== "production"` で console.error を分岐しているため、**本番では何も記録されない**。`logger.error` を本番でも出すべき (PII 漏洩を避けるため `orgId`, `accountId`, `incidentId`, `err.code` のみ)。
- **LOW — `lastWarningAt` がクエリで常に null 固定**
  `connections.ts:99` で `lastWarningAt: null` をハードコード。AccountCard 側で `safe_mode` 警告ブロックに表示する設計なのに値が常に null。「最終警告: ◯時間前」の UI が一度も表示されない。安全モード時の判断支援が機能しない。

---

## 4. ユーザビリティ運用: 19 / 20

### 良い点
- **DEMO バッジ** (`page.tsx:53-61`) で「DB 未接続のためサンプルアカウントを表示しています」と明示。
- **空状態** (`page.tsx:79-85`) で「Phase2 で Unipile OAuth 経由の接続を提供します」と次のフェーズを案内。
- **安全モード強調** が複数レイヤで一貫:
  - card 自体に `border-[#FECACA]` で赤縁取り
  - 並び替えで最前列に固定 (`connections-container.tsx:20-24` の score 関数)
  - `ShieldAlert` アイコン + 推奨アクション 3 つ (クールダウン/ログイン確認/サポート)
- **`DISCONNECT` 二段確認** で誤操作防止。`type-to-confirm` パターンは本番 SRE 観点で 100 点。
- **`pause` 時に `reason` 必須** (max 400 文字、textarea) — 監査側で「なぜ止めたか」が必ず残る。
- **再開ボタンは `safe_mode` 状態のみ表示** — 「アクティブなアカウントを再開する」のような無意味な操作経路を最初から塞ぐ。
- **トースト 3.5 秒で自動消滅** + `aria-live="polite"` — 操作完了の認知負荷が低い。

### 課題
- **MEDIUM — Disconnected 状態からの復元 UI がない**
  メッセージ上は「7 日以内なら復元可能」と謳う (`account-card.tsx:420`, `connections.ts:263`) が、disconnected card には `<Button>` が一切表示されない (`account-card.tsx:155-188` の `!isDisconnected` ガードで全 action がレンダリングされない)。
  - 7 日以内に復元したいユーザーは「結局どこから復元するの？」になり、CS チケット流入 or サポート連絡が増える。
  - 最低限 `disconnected` で `restoreAccount(accountId)` ボタンを追加するか、メッセージを「7 日以内ならサポートに連絡で復元可能」に揺らがないトーンに直す。
- **LOW — `safeModeCount` のサブタイトル**
  `page.tsx:49` で `safeModeCount > 0` のときだけ「安全モード ◯」を出すのは良いが、アクセシブルに `role="status"` を当てる手はある。

---

## 5. キャパシティ・安全: 18 / 20

### 良い点
- **Admin+ ガード** が 4 アクション全てに入っており、`AUTH_REQUIRED` / `FORBIDDEN` を分けて返している。member ロールが UI からアクションフォームを submit しても server 側で弾く。
- **`dailyLimit` の二重 clamp**: zod で 1-200 にバリデート + `clamp(parsed.data.dailyLimit, 1, 200)` で再 clamp。クライアント改竄 / zod 抜けの両方に耐性。
- **`warmupCap` (ウォームアップ自動上限)** が `WARMUP_DAILY_CAP_BY_DAY(warmupDay)` から決まり、`account-card.tsx:43` の `effectiveLimit = min(dailyLimit, warmupCap)` で実質上限が下回る方を採用 — 「Admin が 200 にしてもウォームアップ中なら 25/日」が物理的に守られる。
- **`uuid` バリデーション**が全アクションの accountId に入っており、SQLi/path traversal の窓口がない (drizzle のパラメタライゼーションと併せて二重防御)。
- **`orgId` テナント分離**が WHERE 句に必ず入っている (auth ガード後の `session.orgId` を使うため、cross-org 操作不可)。

### 課題
- **HIGH — 操作レート制御が完全に不在**
  `updateDailyLimit`, `pauseConnection`, `disconnectAccount`, `resumeConnection` の 4 アクションいずれも、Admin が 1 秒間に 100 回連打しても全部通る。
  シナリオ:
  - 悪意ある (or アカウント乗っ取られた) Admin が 1 分で全アカウントを disconnect → 業務停止。
  - Bug で UI が `disconnectAccount` を loop submit → audit テーブル汚染 + 業務停止。
  対策案 (優先順):
  1. `lib/rate-limit.ts` に IP+actorUserId 単位の sliding window (例: `disconnectAccount` は 5 req / 10 min, `pauseConnection` は 30 req / 10 min, `updateDailyLimit` は 60 req / 10 min)。
  2. `disconnectAccount` のみ 2FA 再認証を必須 (もっとも破壊的)。
- **HIGH — `todayStart` のサーバ TZ 依存**
  `connections.ts:37-38`:
  ```ts
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  ```
  これは **Node プロセスの TZ** で 00:00 を取る。Vercel/AWS の本番は UTC 既定なので、`todayStart` は **UTC 00:00 = JST 09:00** になる。
  影響:
  - JST 09:00 までは「昨日の送信」が `todaySent` に積まれる (ユーザーから見て「朝なのにもう 20/25 行ってる」)。
  - JST 00:00 リセットを期待した運用 (ウォームアップ 14 日カウントなど) と齟齬。
  対策:
  ```ts
  // JST (UTC+9) で本日 00:00 を取る
  const nowJst = new Date(Date.now() + 9 * 3600_000);
  nowJst.setUTCHours(0, 0, 0, 0);
  const todayStart = new Date(nowJst.getTime() - 9 * 3600_000);
  ```
  または `process.env.TZ = "Asia/Tokyo"` をプロセス起動時にセット。
  運用上 `org.timezone` (将来的なマルチ TZ 対応) を schema に持つのが正解だが、Phase1 は JST 固定で良い。
- **MEDIUM — `safe_mode` 自動切替の閾値が未配線**
  軸 3 と重複だが、キャパシティ観点でも書く。失敗連続 5 回検知のワーカーがないと、LinkedIn 検知 → CAPTCHA → 永久 BAN の経路を機械的に止められない。Phase2 監視ジョブで `metrics_daily.failure_streak >= 5` を見て自動 `status = safe_mode` UPDATE する cron を入れる方針を README に明記すること。
- **LOW — `revalidatePath` の path が hard-code**
  4 箇所で `revalidatePath("/connections/linkedin")` をリテラルで持っており、URL 変更時に同期漏れリスク。`lib/paths.ts` で constant にする等の小改善余地あり。

---

## 重要度別サマリー

### HIGH (PASS 到達に必須)
1. **`leads(assigned_account_id, last_action_at)` 部分 index 追加** — 軸 1 の P95 を守るキャパシティ前提。
2. **`safe_mode` 自動切替ワーカー or 説明文の修正** — UI で謳う「失敗連続 5 回で自動」が動いていない。説明と実装の乖離。
3. **操作レート制御の導入** — 4 アクション全て無制限。disconnect の連打で業務停止可能。
4. **`todayStart` の JST 化** — UTC ホストで 9 時間ズレる。本番投入前に直す。

### MEDIUM (推奨修正)
5. **`getDb()` null 時に本番では `ok: true` を返さない** — 本番事故を成功と誤認するリスク。
6. **2 クエリの並列化** — RTT 半減。
7. **構造化ログ + metric 送出** — 本番で何も観測できない現状を解消。
8. **`lastWarningAt` 実値の取得** — 安全モード UI の情報源が常に null。
9. **アクション側にも `incidentId` を発行** — 障害対応の突合に必須。
10. **Disconnected からの復元 UI** — メッセージと UI の乖離。

### LOW (余裕があれば)
11. `mockAccounts()` を module-scope 凍結。
12. `revalidatePath` を constant 化。
13. `safeModeCount` サブタイトルに `aria-live` 検討。
14. `count(*)::int` のオーバーフロー懸念 (実害なし)。

---

## 90+ 判定: **NEAR (88)**

| 条件 | 結果 |
|---|---|
| 機能完成度 | ◎ (4 アクション + クエリ + UI が一通り動く) |
| 本番投入準備 | △ (HIGH 4 件のうち TZ・rate-limit・index は本番前に必須) |
| 観測性 | △ (incident_id はあるが metric/log が本番無音) |
| 安全性 | ◯ (Admin ガード・tx・テナント分離 OK / rate-limit のみ穴) |

### PASS (90+) に到達する最短ルート
**HIGH 4 件のうち 3 件以上を解消すれば 90+**:
- HIGH-1 (index) → +1 (軸 1: 16 → 17)
- HIGH-2 (safe_mode 自動切替 or 説明修正) → +1 (軸 3: 16 → 17)
- HIGH-3 (rate-limit) → +1 (軸 5: 18 → 19)
- HIGH-4 (todayStart JST) → +1 (軸 5: 18 → 19 or 軸 1: 16 → 17)

最小工数で 90+ に乗せるなら:
1. `todayStart` JST 化 (3 行)
2. `revalidatePath` の path 変更は不要 / `safe_mode` の説明文に「(Phase2)」を追記 (1 単語)
3. `disconnectAccount` のみ `lib/rate-limit.ts` (5 req / 10 min) を当てる (10 行)
4. migration 1 本で 部分 index 追加

これで **91-92** 到達見込み。

---

## 結論

S11 LinkedIn 接続管理は **Phase1 の UX としては完成度が高く** (DEMO バッジ・空状態・型確認 disconnect・安全モード強調)、トランザクション境界とテナント分離も適切。ただし **本番投入前に TZ・index・rate-limit・safe_mode 自動化の 4 点を埋めないと SRE 観点で受け入れられない**。コードの構造は綺麗なので、修正は数十行で済む。**88 / 100 NEAR**。
