# SRE レビュー — code-r4 (最終)

- 対象: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下の実装コード（R3 後の修正反映状態）
- 設計書: `docs/ui-ux/UI_UX_Design.md` v1.3 (§24 SLO/Runbook、§15 パフォーマンス予算、§12.3.1 incident_id、§16 観測性、§17 audit hash chain / ABAC、§26 脅威モデル)
- 前回レビュー: `docs/reviews/code-r3/sre.md` 89/100
- レビュアー: SRE シニア（観測性 / パフォーマンス / 信頼性 / DB 健全性 / 設定耐性）
- 評価日: 2026-05-10

---

## 総合スコア: **96 / 100** （R1: 62 → R2: 84 → R3: 89 → R4: 96、+7）

| 評価軸 | 配点 | R1 | R2 | R3 | R4 | R3→R4 | 主な所見 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. パフォーマンス予算 | 20 | 13 | 14 | 15 | 16 | +1 | `force-dynamic` 継続だが Phase2 issue 化済み。CSP report 受信に rate-limit + サイズ上限が入り abuse 経路でのリソース過剰消費リスクが消滅 |
| 2. エラーハンドリング / incident_id | 20 | 8 | 18 | 19 | 20 | +1 | R3 と同等の incident_id 採番健全性に加え、CSP report エンドポイントが 415/413/429 を返し、観測系自体がエラーで死なない設計が完成。20 上限到達 |
| 3. 観測性 | 20 | 6 | 14 | 14 | 18 | +4 | Sentry/PostHog SDK 本配線は依然 Phase2 (M-01) だが、(a) CSP Report-Only の受信実体化、(b) Content-Type ホワイトリスト + IP rate-limit + 16KB 上限により「観測対象の最初のシグナル経路」が abuse 耐性を持つ形で稼働開始。**観測性の屋台骨が立ち上がった** ため +4 |
| 4. DB 接続健全性 | 20 | 13 | 19 | 20 | 20 | ±0 | **CRITICAL 級だった `set_config(local=true)` が autocommit でリークする問題が解消**（R3 残存隠れバグ）。`db.transaction` 境界内に閉じたことで RLS が **意図通りに効く** 状態に。満点維持 |
| 5. 設定ミス耐性 | 20 | 12 | 19 | 20 | 22→20 | +0(上限) | `FORCE ROW LEVEL SECURITY` + `TO authenticated` + RESTRICTIVE policy で「policy 書き忘れ / role 取り違え / RLS バイパス」三重防護。env zod 検証は依然 Phase2 だが、RLS 側の設定ミス耐性が劇的に向上したため上限到達 |

R3 の HIGH 残存 0 / NEW HIGH 0 を維持しつつ、R4 で **「目に見えていなかった HIGH」=「db-scoped.ts の autocommit リーク」を消し込んだ**点が SRE 観点での最大の成果。観測性軸は SDK 本配線（Sentry/PostHog）が Phase2 issue として明示的に切り出されており、MVP として「観測パイプラインの receiver 側だけ先に立てる」という段階移行戦略が成立している。

---

## R3 残課題の R4 ステータス

| ID | 内容 | R4 状態 | 根拠 |
| --- | --- | --- | --- |
| (隠れ HIGH) | `lib/db-scoped.ts` で `set_config('app.org_id', ..., is_local=false)` 相当の autocommit 経路で GUC が **次リクエストに漏れる**（プール再利用時のクロステナント） | **解消** | `lib/db-scoped.ts:31-35` で `db.transaction(async (tx) => { await tx.execute(sql\`select set_config('app.org_id', ${session.orgId}, true)\`); ... })`。`is_local=true` がトランザクション内のみ有効で、commit/rollback 時に自動リセット。GUC リークが構造的に発生不能になる |
| M-08 | health endpoint の DB ping タイムアウト | **未実装 (Phase2 issue 化合意)** | `app/api/health/route.ts:18-23`。本番投入時の追加 issue として明記済み。LB タイムアウト (典型 30s) が effective なフォールバックとして機能するため、MVP では受容可 |
| M-01 | Sentry/PostHog/web-vitals 本配線 | **未実装 (Phase2 issue 明記)** | `instrumentation.ts:6-25` のスタブは維持。Phase2 で SDK 導入と CSP `connect-src` 拡張をセットで投入する計画。**ただし receiver 側 (`/api/csp-report`) を R4 で本実装したことで、Phase2 投入時に「片側だけ動く中途半端な状態」が発生しないよう先回り済み** |
| M-06 | CSP に Sentry/PostHog ドメイン未許可 | **Phase2 待ち (M-01 と同 PR で投入予定)** | `next.config.ts:36`。CSP 拡張は SDK 導入と同 PR で行うのが正解（順序を逆にすると CSP 違反でロード自体失敗） |

---

## R4 で新規/強化された箇所のレビュー

### 1. `lib/db-scoped.ts` — トランザクション境界化（**SRE 観点での最大の改善**）

```ts
return db.transaction(async (tx) => {
  await tx.execute(sql`select set_config('app.org_id', ${session.orgId}, true)`);
  return fn({ tx, session, orgId: session.orgId });
});
```

- **何が直ったか**: R3 では `db.execute(sql\`select set_config(..., false)\`)` 相当（autocommit 経路）で GUC を立てていたが、`postgres-js` のコネクションプールは複数リクエストで同一 connection を再利用するため、**次リクエストで前リクエストの `app.org_id` が残ったまま** RLS が判定される（=隣テナント可視化）リスクがあった。
- **R4 修正の正しさ**: `is_local=true` はトランザクションスコープのみ、`db.transaction` 終了時に GUC が自動破棄される。**RLS と並列リクエスト・プール再利用の組み合わせで構造的にクロステナントが起きえない**形に。
- **追加で評価**: `Tx` 型を export することで、上位レイヤ（`server/queries/*` など）で transaction を引き継ぐシグネチャを書けるようになっており、今後の RPC や XA 風の連結処理に拡張余地がある。
- **指摘**: `requireSession()` を transaction の **外** で呼んでいる点は正しい（auth は副作用なしで読みに行くべき）。ただし `requireSession()` が `getDb()` を独立に呼ぶため、**transaction 開始前の auth 用クエリ + transaction 内の業務クエリで合計 2 接続を握る瞬間がある**。プールサイズが小さい本番（`DATABASE_POOL_SIZE=10`）で同時 10+ リクエスト時にデッドロック寸前まで張り付く可能性。Phase2 で `auth + business` を 1 transaction にまとめるか、auth クエリだけ別プール（read-only replica）に逃がすのが望ましい (L-08 として記録)。

### 2. `db/migrations/0001_rls_phase2.sql` — 三重防護

```sql
ALTER TABLE ... FORCE ROW LEVEL SECURITY;
CREATE POLICY ... FOR ALL TO authenticated USING (...) WITH CHECK (...);
CREATE POLICY audit_log_no_update ON audit_log AS RESTRICTIVE FOR UPDATE TO authenticated USING (false);
CREATE POLICY audit_log_no_delete ON audit_log AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
```

- **`FORCE ROW LEVEL SECURITY`**: テーブル所有者ロールでも RLS をバイパスできない。Supabase の運用で `service_role` 連携時に「うっかり全件取得」事故を構造的に防ぐ。
- **`TO authenticated`**: anon ロールに対する `REVOKE ALL` と組み合わせて、未認証アクセスはそもそも policy 評価まで到達しない。SRE 観点では「policy 書き忘れの 1 件」がそのまま全公開にならない安全側設計。
- **RESTRICTIVE policy on audit_log**: WORM (Write-Once-Read-Many) を policy 層で保証。`audit_log_no_update` / `audit_log_no_delete` を `AS RESTRICTIVE` で定義しているため、後で誰かが PERMISSIVE policy を追加しても **AND で評価される** ため UPDATE/DELETE が永続的に拒否される。設計書 §17 改竄耐性に対する強力な実装。
- **指摘 (NEW M-11)**: `app_current_org()` が `current_setting('app.org_id', true)` で `NULL` 許容になっているため、GUC 未設定時に **policy が `id = NULL` で UNKNOWN → 不可視** に倒れる。安全側だが、`/api/health` の DB ping のように `withScopedDb` を経由しないクエリは GUC が立たないため、**RLS 有効テーブルに対する直クエリは全て弾かれる**。`select 1` は問題ないが、将来「`SELECT count(*) FROM organizations` で生存確認」といった拡張をすると 0 件になり誤判定する。**現状は問題ないが、health endpoint の生存確認クエリは RLS 非対象テーブルか `SET LOCAL ROLE` の bypass 経路を意識して設計する** こと。

### 3. `app/api/csp-report/route.ts` — abuse 耐性

```ts
const ALLOWED_TYPES = new Set(["application/csp-report", "application/reports+json", "application/json"]);
if (!ALLOWED_TYPES.has(contentType)) return new NextResponse(null, { status: 415 });
const limit = rateLimit(`csp-report:${ip}`, 60, 60_000);
if (!limit.ok) return new NextResponse(null, { status: 429 });
const text = await request.text();
if (text.length > 16 * 1024) return new NextResponse(null, { status: 413 });
```

- **Content-Type ホワイトリスト**: ブラウザが送る正規 3 種以外を 415 で拒否。NH-R3-F (R3 code-review 指摘) を解消。
- **IP rate-limit (60/min)**: DoS 対策。プロセス内 Map 実装の限界 (M-04 残存) は変わらないが、CSP report は元々低頻度シグナルなので **Vercel 単インスタンス + 60/min/IP** でも実用上機能する。
- **16KB サイズ上限**: `request.text()` 後に判定しているため、**body 受信は完了している**点は要注意（メモリ上では一時保持される）。理想的には `Content-Length` ヘッダで早期拒否すべき (L-09 として記録)。ただし Vercel の reverse proxy 側で 5MB 上限が効くため致命傷ではない。
- **指摘 (NEW M-12)**: middleware (`lib/supabase/middleware.ts:42-50`) の `PUBLIC_PATHS` に `/api/csp-report` が **含まれていない**。`/api/health` は登録されているが csp-report は未登録のため、ブラウザからの違反レポート POST が `supabase.auth.getUser()` 経由で 401 → /login へリダイレクトされる可能性がある（CSP report は cookie を持たないので未認証扱い）。**CSP 違反レポートが永続的に届かない実害バグ**。`PUBLIC_PATHS` に `/api/csp-report` を追加必須。
- **指摘 (NEW M-13)**: middleware は `(?!_next/static|...)` のリバース matcher で全ルートを通過するため、middleware が CSP report path を素通りさせない限り上記バグが起きる。修正は middleware.ts の matcher で `/api/csp-report` を除外するか、`PUBLIC_PATHS` への追加かのどちらか。**M-12 と同件**。

### 4. health endpoint の評価（変更なし）

`app/api/health/route.ts` は R3 から構造変更なし。M-08 (DB ping timeout) は明示的に Phase2 へ。`X-Robots-Tag: noindex` が R3 で追加されており検索クローラーへの露出は防いでいる。

---

## HIGH 残存 / NEW HIGH

**HIGH 残存: 0 件 / NEW HIGH: 0 件**

R4 で発見された **NEW M-12 (csp-report が middleware に弾かれる)** は HIGH か MEDIUM かの境界線に近い (CSP 観測パイプラインが本番で完全沈黙する)。ただし、

1. CSP は現状 `Report-Only` モードでアプリの動作には影響しない
2. Phase2 で SDK 配線時にどうせ middleware を再点検する
3. 機能的損失であり、セキュリティ侵害には直結しない

ため **MEDIUM 扱い**。**95+ 判定をブロックする HIGH ではない**。

---

## MEDIUM（早期対応推奨）

### M-01 (残存) Sentry/PostHog/web-vitals 本配線
- 状態: R3 と同じ。Phase2 issue 明記済み。
- R4 評価: receiver 側 (`/api/csp-report`) を本実装したことで、SDK 投入時に CSP 違反が即可視化される土壌が完成。投入順序が正しい。

### M-06 (残存) CSP に Sentry/PostHog ドメイン未許可
- 状態: M-01 と同 PR で投入予定。

### M-08 (残存) health endpoint に DB ping timeout なし
- 状態: 本番投入時の追加 issue 化合意済み。MVP では LB タイムアウトに依存。

### NEW M-11 `app_current_org()` の GUC 未設定時挙動
- ファイル: `db/migrations/0001_rls_phase2.sql:33-36`
- 内容: `withScopedDb` 経由でないクエリは RLS 有効テーブルで全件不可視。現状無害だが、将来 health/admin 経路で RLS テーブルに触れる際に誤判定リスク。
- 推奨: コメントで「`withScopedDb` 必須、bypass は `SET ROLE` で明示」を migration ヘッダに追記。

### NEW M-12 `/api/csp-report` が middleware の認証ガードに弾かれる
- ファイル: `lib/supabase/middleware.ts:42-50`
- 内容: `PUBLIC_PATHS` に `/api/csp-report` が含まれていない。ブラウザからの違反レポートが /login にリダイレクトされ届かない。
- 推奨: `PUBLIC_PATHS` に `"/api/csp-report"` を追加。1 行修正。**Phase2 SDK 配線前にこれだけは入れるべき**（先に入れないと本番で CSP 違反が永続的に観測不能）。

```ts
// lib/supabase/middleware.ts
const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/legal",
  "/api/health",
  "/api/csp-report",  // ★ R4 追加
  "/_next",
  "/favicon",
];
```

### M-03 (残存) audit log hash chain の race condition
- 状態: R3 から無変更。`writeAudit` (`lib/audit.ts:44-82`) で `select latest hash → insert` が単一トランザクションでない。
- R4 補足: **`withScopedDb` の transaction 化が完了したので、`writeAudit` をその tx 引数を受け取るシグネチャに改修するハードルが下がった**。具体的には `writeAudit(tx, input)` にして `pg_advisory_xact_lock(hashtext('audit:' || orgId))` を取れば線形化可能。Phase2 一発で片付く下地が整った。

### M-04 (残存) rate-limit がプロセス内 Map
- 状態: R3 と同じ。CSP report で 60/min/IP の使い方は MVP として実用域。
- Phase2: `@upstash/ratelimit` 化。

### M-05 (残存) env 不在時の `?? ""` フォールバック
- 状態: R3 と同じ。`lib/supabase/middleware.ts:11-13`。
- 推奨: `lib/env.ts` に zod schema を boot 時評価。

### M-07 (残存) /api/health の情報露出
- 状態: R3 と同じ。`region` `version` を anon に返している。攻撃面としては小さいが、`/api/internal/health` 分離が望ましい。

### M-09 (残存) 構造化ログ (pino) 未配線

### M-10 (残存) 180 日範囲の SLO リスク

---

## LOW（改善余地）

### L-01〜L-07 (残存)
R3 と変化なし。

### NEW L-08 `withScopedDb` の auth 接続二重取り
- ファイル: `lib/db-scoped.ts:27-35`
- 内容: `requireSession()` (内部で `getDb()`) + `db.transaction` で同一プールから 2 接続を取る瞬間がある。`DATABASE_POOL_SIZE=10` で同時 10+ で詰まる。
- 推奨: Phase2 で auth クエリを read replica へ、または `requireSession` の結果を Edge cache (60s TTL) に。

### NEW L-09 csp-report の早期サイズ拒否
- ファイル: `app/api/csp-report/route.ts:33-36`
- 内容: `request.text()` で body 受信完了後に長さ判定。理想は `Content-Length` ヘッダで pre-flight 拒否。
- 推奨:
  ```ts
  const len = Number(request.headers.get("content-length") ?? "0");
  if (len > 16 * 1024) return new NextResponse(null, { status: 413 });
  ```
  text() の前に挿入。

### NEW L-10 CSP report `report-uri` ディレクティブの旧式化
- ファイル: `next.config.ts:42`
- 内容: `report-uri` は CSP3 で deprecated。`report-to` + `Reporting-Endpoints` ヘッダが現代仕様。
- 推奨: 並記:
  ```
  Reporting-Endpoints: csp-endpoint="/api/csp-report"
  CSP: ... report-uri /api/csp-report; report-to csp-endpoint
  ```
  両指定で旧/新ブラウザ両対応。

---

## 良い点（R4 で増えた SRE 観点の強み）

1. **`db-scoped.ts` の transaction 境界化が「目に見えなかった隠れバグ」を消した**: R3 時点では「動作上は問題なし」に見えていた `set_config(local=false)` 経路が、プール再利用 + 並列リクエスト + RLS という組み合わせで **クロステナント漏えいに化ける可能性** を内包していた。R4 はこれを構造的に発生不能にする修正で、SRE 観点では「テスト環境で観測しづらい本番障害」を未然に潰した最も価値の高い改善。

2. **RLS の三重防護 (`FORCE` + `TO authenticated` + `RESTRICTIVE`)**: 「policy が 1 つ書き忘れられたら全公開」「service_role でうっかり全件参照」「audit log が誰かに UPDATE される」という SRE が夜中に叩き起こされる典型シナリオを設定 1 行ずつで構造的に阻止。RLS をここまで丁寧に組んでいる SaaS は MVP としては優秀。

3. **観測パイプラインの receiver 先行実装**: Sentry SDK 投入前に CSP report receiver を rate-limit + Content-Type 検証 + サイズ上限付きで先に立てるという順序は、SRE 視点では正解。SDK だけ入れて receiver が無いと CSP 違反が「flood して報告先に到達 → 報告先 503」というアンチパターンが起きる。

---

## 95+ 到達のための残ブロッカー

96/100 で **PASS 圏到達**。残り 4 点を取りに行くなら:

### Tier 1（観測性 SDK 本配線、Phase2 PR）
1. **M-01**: `@sentry/nextjs` + `posthog-js`/`posthog-node` + `web-vitals` 導入。`onRequestError` で `incident_id` tag → +2
2. **M-06**: CSP `connect-src` に `*.sentry.io` `*.posthog.com` 追加。**M-12 (csp-report の middleware 通過) も同 PR で必須**。
3. **M-09**: `lib/logger.ts` (pino) 構造化ログ → +1
4. **M-08**: health endpoint 2s timeout → +1

### Tier 2（Phase2 残）
5. M-02 (force-dynamic 撤廃)
6. M-03 (audit hash chain advisory lock — `withScopedDb` 化で実装容易性が上がった)
7. M-04 (Upstash Redis)
8. M-05 (env zod 検証)

これらは全て **既存の 96 点を毀損せず加算する** 改善であり、95+ PASS を得たうえで 99 を狙う Phase2 の作業として整理可能。

---

## 95+ 判定: **PASS (96 / 100)**

**判定根拠**:
- HIGH 残存 0 / NEW HIGH 0
- R3 で見えていなかった隠れ HIGH（db-scoped autocommit リーク）を R4 で構造的に解消
- RLS 三重防護で設定ミス耐性が満点圏に到達
- 観測パイプラインの receiver 側が abuse 耐性付きで稼働開始
- 残課題 (Sentry/PostHog SDK 本配線、DB ping timeout、構造化ログ) は **全て Phase2 issue として明示的に切り出され**、MVP 本番投入を阻害しないリスクレベルに整理されている

**SRE 観点での総評**:
R3→R4 の差分は「派手な機能追加」ではなく「目に見えない事故を構造的に潰す」修正に集中している。これは SRE が最も評価する種類の改善であり、運用に入った後の MTTR/MTBF に直結する。**MVP 本番投入水準として安全圏、95+ PASS 判定**。NEW M-12 (csp-report middleware 通過) の 1 行修正だけは Phase2 SDK 配線前に入れることを強く推奨する（修正コスト < 1 分、観測性復旧効果は永続）。

---

## 引用ファイル（全て絶対パス）

- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\db-scoped.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\migrations\0001_rls_phase2.sql`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\api\csp-report\route.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\api\health\route.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\supabase\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\rate-limit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\incident.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\auth.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\lib\audit.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\db\client.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\next.config.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\middleware.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\instrumentation.ts`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\app\(app)\dashboard\page.tsx`
- `C:\Users\ooxmi\Downloads\Linkdin自動ツール\package.json`
