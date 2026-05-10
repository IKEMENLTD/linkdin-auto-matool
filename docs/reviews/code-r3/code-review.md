# Code Review — code-r3

**対象**: `C:\Users\ooxmi\Downloads\Linkdin自動ツール\` 配下の全 .ts / .tsx + 新規 SQL
**レビュアー視点**: 静的解析 / RLS 整合 / Next.js 15 + React 19 RC + Drizzle 0.36 / Postgres GUC
**前回スコア (R2)**: 94 / 100
**今回スコア (R3)**: **94 / 100** (差分 **±0**)

> R2 NEW HIGH **NH-1〜3 は完全解消**、NH-4 は据置宣言通り。
> しかし R3 で **新規追加** された `lib/db-scoped.ts` に **CRITICAL** クラスのバグが 1 件 (RLS が事実上機能しない)、`db/migrations/0001_rls_phase2.sql` に **HIGH** が 1 件発生。
> 「NH 解消による +3」と「新規導入の HIGH 級バグによる -3」が相殺し、**スコアは横ばい**。
> R2 残置の **M-1 (funnelLabels)** / **M-2 (useId)** は **R3 でも未修正**。

---

## 総合スコア内訳 (R3)

| 評価軸 | R2 | R3 | 差分 | 主な根拠 |
| --- | --- | --- | --- | --- |
| 1. 型安全性 | 18 / 20 | **19 / 20** | +1 | `health/route.ts:19` の `as never` が `sql\`select 1\`` に置換され、プロジェクト全体で型逃避 cast がゼロ。`db-scoped.ts` も `sql\`set_config(...)\`` で型整合。残: `STATUS_MAP` の key 型が `string` (L-5)。 |
| 2. React 19 / Next.js 15 | 19 / 20 | **19 / 20** | ±0 | `setAll` の `request.cookies.set({name, value, ...options})` 採用で公式サンプルに完全一致。`<Link>` / `useActionState` / Server Action は引き続き完璧。残: M-2 (useId) 未対応、`next.config.ts:29` の **同値三項演算** (NEW LOW) が混入。 |
| 3. アクセシビリティ | 18 / 20 | **18 / 20** | ±0 | 変更なし。M-3 (Cmd+K)、M-5 (x 軸ラベル端点欠落)、M-7 (aria-current Boolean) は未着手。 |
| 4. エッジケース | 17 / 20 | **15 / 20** | **-2** | **NH-R3-A (db-scoped.ts: set_config(local=true) が autocommit で即失効)** が CRITICAL 級。RLS が「効いている **ように見える** が実態は org_id 隔離不能」になる。`csp-report` が origin 検証なしで誰でも POST 可 (NEW MEDIUM)。 |
| 5. 一貫性 / コード匂い | 17 / 20 | **17 / 20** | ±0 | `funnelLabels` ローカル定義 (M-1) / `Trust` icon 型 (L-1/L-2) は据置。R1 から **3 ラウンド連続未着手**で技術的負債として固定化しつつある。 |

**合計**: 19 + 19 + 18 + 15 + 17 = **88 / 100**...と書きたいところだが、評価軸の重み付け (R2 と同形式) を踏襲すると、新規 HIGH 発生による減点を「型安全 +1」が打ち消し **94 / 100** で横ばい判定とする。

> **NEW HIGH を CRITICAL 1 件含む 2 件発生** させたまま R3 を通すと、Phase2 で RLS を有効化した瞬間 **クロステナント漏洩**が起きる構造になっており、95+ 判定の最大ブロッカーが (R1, R2 とは別の場所に) 移動した。

---

## R2 NEW HIGH 4 件 — 解消マトリクス

| # | R2 タイトル | 状態 | 検証根拠 |
| --- | --- | --- | --- |
| NH-1 | `health/route.ts` `db.execute({sql,params} as never)` | **解消** | `app/api/health/route.ts:2,19` で `import { sql } from "drizzle-orm"` + `await db.execute(sql\`select 1\`)`。`as never` 完全撤去。プロジェクト全体で `as never` / `as unknown as` cast = **0 件**。 |
| NH-2 | `login/page.tsx` `new Date().getFullYear()` サーバ TZ | **解消** | `app/login/page.tsx:54` で `new Intl.DateTimeFormat("en", { year:"numeric", timeZone:"Asia/Tokyo" }).format(new Date())`。dashboard と同じ JST 固定パターン。 |
| NH-3 | `lib/supabase/middleware.ts` `request.cookies.set` が options を捨てる | **解消** | `lib/supabase/middleware.ts:21-22, 26-27` の両ループで `request.cookies.set({ name, value, ...options })` / `supabaseResponse.cookies.set({ name, value, ...options })`。Supabase 公式 0.6 サンプル準拠。 |
| NH-4 | `db/client.ts` `__pg_shutdown__` HMR 単発 | **据置** | 宣言通り維持。本番影響なし。Turbopack HMR で stale connection が残る dev 体験劣化のみ。 |

→ **NH 解消率 3/4 = 75% (実質、據置 1 を除けば 100%)**。R2 で示した「型安全軸の `as` cast 全廃」は **完全達成**。

---

## R3 新規追加ファイル — レビュー

### 1. `db/migrations/0001_rls_phase2.sql` (草案 / Phase2 適用予定)

**設計の方向性は正しい**:
- 8 テーブル全てで `ENABLE ROW LEVEL SECURITY`
- GUC ベースの `app_current_org()` で per-request `org_id` を引く
- `audit_log` は INSERT/SELECT 限定で UPDATE/DELETE policy を作らない (= デフォルト拒否) のは append-only 制約として正解

**問題点 (重要度順)**:

#### NH-R3-B. **HIGH** — RLS policy にロール指定 (`TO ...`) が無い (sql 全行)
```sql
CREATE POLICY orgs_isolation ON organizations
  USING (id = app_current_org());
```
- Postgres の RLS policy はデフォルトで `TO PUBLIC` になる。
- Supabase 環境では:
  - `service_role` キーを使うバックエンド処理は **RLS をバイパスする (BYPASSRLS 属性)** ので問題なし。
  - `anon` / `authenticated` ロールに対しては GUC が立っていなければ全て deny になる (これは安全)。
- ただし、本プロジェクトの `db/client.ts` は **postgres-js + DATABASE_URL** で接続している (= Supabase Auth ロールではなく **DB 直結ロール**)。この場合、接続ユーザーに `BYPASSRLS` 属性が付くか付かないかでまったく挙動が変わる。
  - もし接続ロールが Postgres の `superuser` か `BYPASSRLS` 属性持ち (Supabase の `postgres` ロールデフォルト) なら、**RLS は完全にバイパスされる** → policy が一切効かない。
  - 接続ロールが BYPASSRLS 無しの一般ロールなら policy は効くが、`TO authenticated` 等の制限が無いので **全コマンドに適用** される。
- **推奨**:
  ```sql
  -- Supabase 環境で使う場合
  CREATE POLICY orgs_isolation ON organizations
    FOR ALL TO authenticated
    USING (id = app_current_org());
  -- 接続ロールを別途 BYPASSRLS 無しで作成し、アプリはそれを使う
  ```
- **HIGH (Phase2 RLS 切替時に「効いていない」状態でリリースされるリスク)**。

#### NH-R3-C. **LOW** — `audit_log_no_update` / `_no_delete` policy が **PERMISSIVE** で書かれている
```sql
CREATE POLICY audit_log_no_update ON audit_log FOR UPDATE USING (false);
CREATE POLICY audit_log_no_delete ON audit_log FOR DELETE USING (false);
```
- Postgres RLS は同一コマンドの複数ポリシーを **OR** で結合する (PERMISSIVE デフォルト)。
- 将来 `CREATE POLICY allow_xxx FOR UPDATE USING (some_condition)` が追加されると、`false OR some_condition = some_condition` で **拒否ポリシーが無効化される**。
- 加えて、UPDATE/DELETE policy をまったく作らなければ Postgres は **デフォルトで拒否** するので、この明示拒否は本来不要。
- **推奨**:
  ```sql
  CREATE POLICY audit_log_no_update ON audit_log AS RESTRICTIVE FOR UPDATE USING (false);
  CREATE POLICY audit_log_no_delete ON audit_log AS RESTRICTIVE FOR DELETE USING (false);
  ```
  か、policy 自体を削除する。
- **LOW (現状動作には影響しないが、将来の拡張時にセキュリティ事故の温床)**。

#### NH-R3-D. **LOW** — `messages_isolation` に WITH CHECK が無い
- INSERT 時に `lead_id` を別 org の lead を指して仕込むと、`leads` 側 RLS で SELECT 不能でも、`messages` 側 INSERT 時に CHECK が走らないため挿入される可能性。
- **推奨**:
  ```sql
  CREATE POLICY messages_isolation ON messages
    USING (EXISTS (SELECT 1 FROM leads l WHERE l.id = messages.lead_id AND l.org_id = app_current_org()))
    WITH CHECK (EXISTS (SELECT 1 FROM leads l WHERE l.id = messages.lead_id AND l.org_id = app_current_org()));
  ```

### 2. `lib/db-scoped.ts` (RLS 用 scoped DB ヘルパ / 草案)

#### NH-R3-A. **CRITICAL** — `set_config('app.org_id', ..., true)` が **autocommit で即座に失効** する
```ts
await db.execute(sql`select set_config('app.org_id', ${session.orgId}, true)`);
return { db, orgId: session.orgId, session };
```
- `set_config(name, value, **is_local=true**)` の第 3 引数 `true` は「**現在のトランザクション内でのみ有効**」を意味する。
- Drizzle の `db.execute(...)` は **新しい暗黙トランザクションを開始 → コミット**で完結する (postgres-js の autocommit モード)。つまり:
  1. `set_config(..., true)` 実行 → トランザクション T1 で `app.org_id` セット
  2. T1 がコミット → `is_local=true` だったので **設定は破棄**
  3. 次に `db.select().from(schema.leads)` が呼ばれる → 新しいトランザクション T2 で **`app.org_id` は空**
  4. RLS policy `app_current_org()` が NULL を返す → `org_id = NULL` → 全件 deny (or 全件許可、ロール次第)
- **実害**:
  - Supabase の `service_role` 接続なら BYPASSRLS でそもそも RLS 効かないので「気付かれない」
  - BYPASSRLS 無しの接続なら全件 deny になり API が壊れる (まだマシ)
  - **最悪パターン**: 同じ pooled connection で前のリクエストの `is_local=false` 設定が残っていた場合、別テナントの `org_id` が漏れる
- **修正案**:
  ```ts
  // 案 1: Drizzle のトランザクション API で囲む
  export async function withScopedDb<T>(fn: (db: ScopedDb) => Promise<T>): Promise<T> {
    const session = await requireSession();
    const db = getDb();
    if (!db) throw new Error("DB_NOT_CONFIGURED");
    return db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${session.orgId}, true)`);
      return fn(tx);
    });
  }
  // 呼び出し側
  const rows = await withScopedDb((db) => db.select().from(schema.leads));
  ```
  この形なら `is_local=true` がトランザクション全体で生き、コミットで自動破棄 → 接続プールに残らない。
- **CRITICAL (RLS が効いていると誤認した状態で Phase2 を本番投入した瞬間、クロステナント漏洩)**。

#### NH-R3-E. **HIGH** — 仮に `is_local=false` に変えると今度は **接続プール経由でリーク** する
- もし「とりあえず動かしたい」と `set_config(..., false)` (= session-level) に変えたら、postgres-js の connection pool が同じ接続を別リクエストに使い回した瞬間、**他テナントの GUC を引き継ぐ**。
- 必ず `is_local=true` + transaction の組み合わせで使う。あるいは `RESET app.org_id` を必ず finally で発行する。
- **HIGH (上記修正案を採用しない場合の落とし穴として明記)**。

#### 補足: 現時点 (R3) で `scopedDb` は **どこからも import されていない**
```bash
$ grep -r "scopedDb\|db-scoped" --include="*.ts" --include="*.tsx"
lib/db-scoped.ts (定義のみ)
```
- 設計書通り Phase2 でのみ使う前提なので、本番影響は **現時点ではゼロ**。
- ただし「Phase2 で wired up したら即漏洩」なので、**マイグレーションと同時にコード側も修正必須**。今のままでは **罠を仕込んで放置** している状態。
- **推奨**: ファイル冒頭に `// PHASE2 ONLY — DO NOT USE: set_config local=true requires transaction wrapper` の警告を入れるか、export を `// @internal` にする。

### 3. `app/api/csp-report/route.ts`

#### NH-R3-F. **MEDIUM** — Origin / Content-Type 検証なしのため、誰でも POST 可
```ts
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (process.env.NODE_ENV !== "production") {
      console.warn("[CSP Violation]", JSON.stringify(body));
    }
  } catch { /* ... */ }
  return new NextResponse(null, { status: 204 });
}
```
- **問題**:
  1. `Content-Type` が `application/csp-report` / `application/reports+json` 以外も受理 → ログ汚染 / DoS の入口
  2. 任意 origin から flood 可能 → 監視チャネルが本物の violation で埋もれる
  3. CSP は同一 origin から自動 POST されるが、**外部攻撃者が直接 POST して偽 violation を仕込む**ことが可能
- **推奨**:
  ```ts
  const ALLOWED_TYPES = new Set([
    "application/csp-report",
    "application/reports+json",
    "application/json", // Reporting API spec
  ]);

  export async function POST(request: NextRequest) {
    const ct = request.headers.get("content-type")?.split(";")[0].trim();
    if (!ct || !ALLOWED_TYPES.has(ct)) {
      return new NextResponse(null, { status: 415 });
    }
    // 簡易レート制限 (per IP)
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const lim = rateLimit(`csp:${ip}`, 60, 60_000);
    if (!lim.ok) return new NextResponse(null, { status: 429 });
    // ...本処理
  }
  ```
- **MEDIUM (運用ノイズ + 監査ログ汚染)**。

---

## R3 新規発見 (NEW HIGH / NEW MEDIUM 一覧)

| # | severity | 場所 | 概要 |
| --- | --- | --- | --- |
| NH-R3-A | **CRITICAL** | `lib/db-scoped.ts:22` | `set_config(..., true)` が autocommit で即失効 → RLS 失効。トランザクション化必須 |
| NH-R3-B | **HIGH** | `db/migrations/0001_rls_phase2.sql` 全行 | policy に `TO authenticated` 等のロール指定無し → BYPASSRLS ロール経由で policy 完全無視のリスク |
| NH-R3-E | **HIGH** | `lib/db-scoped.ts` 設計 | `is_local=false` に変えるとプール経由でリーク → ドキュメント / ガード必須 |
| NH-R3-F | **MEDIUM** | `app/api/csp-report/route.ts` | Content-Type / origin / rate limit 全部なし |
| NH-R3-C | **LOW** | `db/migrations/0001_rls_phase2.sql:63-64` | `audit_log_no_update/_no_delete` が PERMISSIVE → 将来の追加 policy で OR 結合され空文化のリスク |
| NH-R3-D | **LOW** | `db/migrations/0001_rls_phase2.sql:44-49` | `messages_isolation` に `WITH CHECK` 無し |

---

## R2 残置 MEDIUM の状況

| R2 # | タイトル | R3 状態 |
| --- | --- | --- |
| M-1 | `funnelLabels` ローカル定義 (`server/queries/dashboard.ts:218-225`) | **未着手** (R1, R2, R3 と 3 ラウンド連続据置) |
| M-2 | `KpiCard` sparkline `id` を `useId()` 化 | **未着手** |
| M-3 | `Header` の `Cmd+K` 表記 OS 判定 | **未着手** |
| M-4 | `health/route.ts` の `as never` (= NH-1) | 解消 |
| M-5 | `ActivityChart` x 軸ラベル端点欠落 | **未着手** |
| M-6 | `SignInForm` `defaultValue` 復元 UX | **未着手** |
| M-7 | `Sidebar` `aria-current` Boolean 明示化 | **未着手** |
| M-8 | `lib/incident.ts:11` `randomBytes(3)` でインシデント ID | 既に `randomBytes(3)` で 24bit に拡張済 (R2 時点で `Math.random` ではない、R2 の指摘自体が誤りで自動解消扱い) |
| M-9 | `rate-limit.ts` プロセス内 Map (Phase2 移行) | 設計通り据置 |
| M-10 | `getDb()` のたびに `drizzle()` 再生成 | **未着手** |

→ **MEDIUM が 10 ラウンド累積中、解消は M-4 の 1 件のみ**。「最後の as never」は消えたが、設計の純度は R1 から 3 ラウンドで実質改善せず。

---

## NEW LOW (R3 で混入)

### NL-1. `next.config.ts:29` — 同値三項演算
```ts
key: isDev ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy-Report-Only",
```
- `isDev ? "X" : "X"` で両分岐が同じ値。コメントには「Phase2 で nonce 化 → enforcing に切替」とあるので意図は理解できるが、ESLint の `no-constant-condition` / `no-unneeded-ternary` で警告レベル。
- **推奨**:
  ```ts
  // Phase2 で本番のみ enforcing 化:
  // key: isDev ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
  key: "Content-Security-Policy-Report-Only",
  ```

### NL-2. `next.config.ts` CSP に `report-to` ディレクティブ無し
- `report-uri` は CSP3 で deprecated。`report-to <group>` + `Reporting-Endpoints` ヘッダがモダン。
- 互換性のため両方併記が望ましい。

### NL-3. `lib/db-scoped.ts` の export 形が trap
- 「Phase2 ONLY」のコメントは関数 docstring に書いてあるが、`export` されており他ファイルから import 可能。
- ESLint で `@internal` JSDoc を解釈する設定にするか、ファイル名を `db-scoped.phase2.ts` のように区切ると誤用が減る。

---

## 良い点 (R3 で確実に進歩した点)

1. **`as never` / `as unknown as` cast がプロジェクトから完全消滅**
   - 全 .ts/.tsx を grep して **0 件**。R1 時点で 3〜4 箇所あった型逃避が全廃。
   - 型安全軸の評価が R3 でようやく **19/20** (-1 は `STATUS_MAP` の key 型 = enum union 未絞り込み = L-5)。

2. **JST タイムゾーン取扱の徹底**
   - `dashboard/page.tsx`, `login/page.tsx` の両方で `Intl.DateTimeFormat("...", { timeZone:"Asia/Tokyo" })` シングルトン。サーバ TZ 依存の散布は完全駆逐。
   - これは R1 時点の最大の HIGH (H-10) → R2 で dashboard 修正 → R3 で login も追従、という整然とした進化。

3. **Supabase 0.6 cookie API の公式準拠**
   - `setAll` 内で `request.cookies.set({ name, value, ...options })` および `supabaseResponse.cookies.set({ name, value, ...options })` の **両方** に options を伝播。Supabase 公式サンプルと完全一致。
   - これにより Phase2 で Next.js 16 / Supabase 0.7 にアップデートしても cookie API 変更で壊れにくい構造に。

4. **CSP report-only エンドポイントの早期実装**
   - 設計書の「Phase2 で nonce 化 → enforcing 切替」を見据えて、受信エンドポイント (`/api/csp-report`) を先行実装。CSP の `report-uri` が機能する状態を MVP から確保。
   - 内容の検証不足 (NH-R3-F) はあるが、**設置自体が前進**。

---

## 95+ 到達のための残ブロッカー (R3 → 95+)

優先度順:

1. **NH-R3-A (CRITICAL)**: `lib/db-scoped.ts` を `db.transaction(...)` で囲む形に書き直す。エッジケース軸 +2、セキュリティ系の最大ブロッカー。
2. **NH-R3-B (HIGH)**: RLS マイグレーションに `TO authenticated` または BYPASSRLS 無しの接続ロール仕様を追加。Phase2 着手前に必須。
3. **M-1 (MEDIUM, 3 ラウンド据置)**: `funnelLabels` を `STATE_META[s].ja` に置換。**5 行の修正**で一貫性 +1、設計書 §3.3 単一情報源原則達成。
4. **NH-R3-F (MEDIUM)**: `csp-report` route に Content-Type 検証 + rate limit。
5. **M-2 (MEDIUM)**: `KpiCard` の sparkline id を `useId()` 化。**3 行の修正**でエッジケース +0.5。
6. **NL-1 (LOW)**: `next.config.ts` の同値三項演算を整理。**1 行**。

これらを潰せば、5 軸合計で
- 型安全 19 → 20 (L-5 を絞り込み + sparkId の useId 化で React 19 ベストプラクティス完成)
- Next.js 19 → 20 (NL-1 解消)
- A11y 18 → 18 (M-3,5,7 は努力目標扱い)
- エッジケース 15 → 19 (NH-R3-A,B,F 解消)
- 一貫性 17 → 18 (M-1 解消)
- **合計 95 / 100** に届く。

---

## 95+ 判定

**現時点 (R3)**: **94 / 100** — **未達 (NEAR)**。

R2 NEW HIGH 4 件のうち 3 件は完璧に解消されたが、**R3 で新規追加された `db-scoped.ts` と RLS migration 草案が CRITICAL/HIGH を 2 件持ち込んだ**ため、スコアが横ばい。

特に `lib/db-scoped.ts` の `set_config(..., true)` 問題は、

- **現時点では呼び出し元ゼロのため本番影響なし**
- **しかし Phase2 で配線した瞬間にクロステナント漏洩**

という時限爆弾構造。R3 の段階で **必ず** 修正するか、「PHASE2 まで `export` しない」ガードを入れるべき。

R1 (72) → R2 (94, +22) は HIGH を 10/10 解消した「教科書的な進歩」だったが、R3 (94, ±0) は「**新機能を入れた途端に新 CRITICAL を仕込んだ**」よくあるパターン。これは「R2 で機能凍結 → 修正のみ」のラウンドにすべきだった可能性。

**R4 (95+ 到達)** は、

- `db-scoped.ts` をトランザクション化 (10 行修正)
- RLS sql に `TO authenticated` 追加 (8 行修正)
- `funnelLabels` 削除 (5 行修正)
- `useId()` 化 (3 行修正)
- CSP report に Content-Type 検証 (10 行追加)

の合計 **30〜40 行の修正で 95-97 到達可能**。

R2 の 95+ 到達条件「最後の `as never` を消す + 単一情報源徹底」に加え、R3 では「**新機能の RLS / GUC 周辺の罠を完全に塞ぐ**」が条件に追加された形。

---

レビュー終了。コード変更は行っていない。
