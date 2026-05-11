# S07 リード一覧画面 — Security レビュー (r1)

- **Reviewer**: security-design-agent
- **Date**: 2026-05-11
- **Scope**: `app/(app)/leads/page.tsx`, `server/queries/leads.ts`, `server/actions/leads.ts`, `components/leads/*`
- **Cross-cuts**: `lib/utils.ts` (escapeLikePattern, clamp), `lib/auth.ts` (getSession / hasAtLeastRole), `lib/audit.ts` (writeAudit), `db/schema.ts` (leads)

---

## 総合スコア: **94 / 100**  ✅ 90+ 判定: PASS

| # | 評価軸                                              | 配点 | 得点 | 主要根拠 |
|---|---------------------------------------------------|----:|----:|---|
| 1 | テナント分離 (leads + campaigns join での orgId 強制) |  20 |  19 | listLeads / getLeadById / bulkDisqualify いずれも `eq(leads.orgId, session.orgId)` 必須。leftJoin 経路に orgId 二重バインドの形跡なしだがクロスチェックは妥当 |
| 2 | 認可 (bulkDisqualifyLeads Operator+、ID UUID 検証) |  20 |  20 | Operator+ チェック、Zod による UUID array + 上限 500、AUTH_REQUIRED と FORBIDDEN の応答が分離 |
| 3 | 入力検証 (state ホワイトリスト, ilike escape, score 範囲, page クランプ) |  20 |  20 | `ALLOWED_STATES` Set による厳密ホワイトリスト、`escapeLikePattern` で `%/_/\\` 無効化、`clamp` で score/page を [0,100] / [1,2000] に制限 |
| 4 | 監査ログ (lead.disqualified の結線)                 |  20 |  18 | 影響を受けた行のみ `writeAudit` を loop 発火、hash chain 続行。診断は OK だが N+1 とログ-DB トランザクション境界が分離している点を Medium で減点 |
| 5 | XSS / Open Redirect / コード匂い                    |  20 |  17 | React 自動エスケープ＋`Link` 経路のみ、外部 URL なし。`?lead=` のキャスト緩さ・degraded 経路でユーザー文言に incidentId をそのまま埋める箇所だけ Low |

---

## 1. テナント分離 (19/20)

### 評価
- `listLeads` (queries/leads.ts L67): `conditions` 配列の **先頭で必ず** `eq(schema.leads.orgId, orgId)` を AND。さらに、`db || !orgId` 時はモックへフォールバックするため、未認証で実 DB クエリが走る経路は無い。
- `getLeadById` (L183): `and(eq(leads.id, leadId), eq(leads.orgId, orgId))` の合成キーで取得。レコードが他テナント所有なら `row` が undefined になり `null` が返るため、enumerate 攻撃でも所有者しかドロワーを開けない。
- `bulkDisqualifyLeads` (actions/leads.ts L57): `and(eq(orgId, session.orgId), inArray(id, ids))` で UPDATE 範囲を制限。`.returning()` の戻り値（実際に更新された行のみ）でカウントと監査が確定するため、**他テナントの id を混ぜても無視される** (silent ignore)。
- `campaigns` / `users` への `leftJoin` は表示専用列 (campaignName / ownerName)。`leads.orgId = orgId` が確定している以上、leads.campaignId → campaigns.id は本来同一テナントの FK。Postgres FK と複合 idx (`leads_org_idx`) で実害なし。

### Medium (-1)
- **MED-1**: `leftJoin(campaigns, eq(campaigns.id, leads.campaignId))` および `users` への join に **`AND campaigns.org_id = leads.org_id` を明示していない**。現状は FK で同一テナント前提だが、将来的に campaigns 側で「組織移動」「アーカイブ後の orgId 再割当」のような運用が入った瞬間に cross-tenant な campaignName 露出のリスクが生まれる。defense-in-depth として `eq(campaigns.orgId, leads.orgId)` を join 条件に追加するのが望ましい。

---

## 2. 認可 (20/20)

### 評価
- `requireOperatorSession`: `getSession()` → null なら `AUTH_REQUIRED`, role が operator 未満なら `FORBIDDEN`。**先に Zod パースして UUID 形式を確認してから auth を見る順** は意図的に DoS にならない (Zod は軽量、認証 short-circuit より早い)。
- `IdsSchema = z.array(z.string().uuid()).min(1).max(500)`: 上限 500 で **payload 量と監査ログ N+1 を抑制**、CSRF を伴う massive disqualify を予防。
- `formData.getAll("ids").map(String)`: `String()` でプリミティブ化 → Zod の `z.string()` で **`File` などの非文字列を排除**。良い慣行。
- セッション null 戻し時のメッセージは「サインインが必要です」「権限がありません」と分離。**ユーザー存在/役割いずれかの enumeration には繋がらない** (どちらも自分のセッション情報経由)。
- `hasAtLeastRole(session.role, "operator")`: `ROLE_RANK[viewer]=1, operator=2, ...` の単純比較。`Role` 型ガードで未知 role は型レベル弾き。
- **role 昇格レース**: operator 解除後にフォーム送信したケースでも、毎リクエストで `getSession()` → DB から最新 role を取得しているため OK。

特に減点なし。

---

## 3. 入力検証 (20/20)

### 評価
- `state` ホワイトリスト (page.tsx L22, L37): `ALLOWED_STATES = new Set(["", ...STATE_ORDER])`。`STATE_ORDER` は state-machine.ts の `LeadState` リテラル和。**Set#has で O(1)**、ヒットしなければ `""` に折りたたむ。これにより `state=DROP TABLE` などは到達不能。
- `q` (page.tsx L39): `.slice(0, 120)`。queries 側でも `Q_MAX_LEN=120` で二重に制限 → defense-in-depth。
- `escapeLikePattern` (utils.ts):
  ```ts
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  ```
  **順序が正しい**。先に `\` をエスケープしてから `%`/`_` を扱うので二重エスケープが発生しない。Postgres デフォルトの escape char (`\`) が前提なので OK。
- `like = '%${escapeLikePattern(safeQ)}%'` の外側 `%` は **アプリ側の意図** であり、ユーザー入力ではない。これも適切。
- `sql\`(... ILIKE ${like} OR ...)\``: タグ付きテンプレートに **drizzle のパラメータバインドが効く**。`${schema.leads.fullName}` は column 識別子、`${like}` はリテラル → prepared statement の placeholder に乗る。**SQLi は構造上不可能**。
- `scoreMin`: `clamp(Math.floor(Number(scoreMin) || 0), 0, 100)`。`NaN || 0 → 0`、負値は 0 へ、>100 は 100 へ。`gte` に乗るためインデックス利用も阻害しない。
- `page`: `clamp(Math.floor(Number(page) || 1), 1, 2000)` で **巨大 offset 攻撃 (DoS via OFFSET) を抑止**。`perPage` は **クライアントから受け取らず固定 50** (page.tsx L42)。これは攻撃面を一気に小さくする良い設計。queries 側は 10〜100 で受け入れているが、page.tsx が呼び出し点を絞っているため実害なし。
- `campaignId` の検証: 文字列のまま `eq(leads.campaignId, campaignId)` に流れる。drizzle が **uuid 型カラムに対して非 UUID 文字列を渡すと bind error** で例外、queries 側の try/catch で degraded に落ちる。SQLi / 他テナント露出には繋がらない。
- `?lead=` (drawerLeadId): `getLeadById` 側で `and(eq(leads.id, leadId), eq(leads.orgId, orgId))` を投げる。drizzle が uuid キャストに失敗すれば throw、catch で `null` を返す。**フォーマット事前検証は厳密には不要**だが、ノイズログとパース失敗時のレイテンシ削減を考えると Zod uuid を一段噛ませても良い (=> Low サジェスト)。

特に減点なし。

---

## 4. 監査ログ — `lead.disqualified` 結線 (18/20)

### 評価
- `.returning({ id: schema.leads.id })` の戻り値 `updated` を **ループして 1 ID = 1 audit エントリ** を書き出す (actions/leads.ts L65-74)。
- audit.ts L60-72: `prevHash` を直前エントリから読み hash chain。`SHA-256(prev || normalized JSON)` で改竄耐性。`orgId` で scoped されているため **テナント越境による hash 汚染なし**。
- 監査 action = `lead.disqualified` は `AuditAction` 型に列挙済み。`diff: { state: { to: "DISQUALIFIED" } }` は最小限。**from 側 (旧 state) が欠落**しているのは設計判断 (UI 設計書 §17 で「DISQUALIFY は idempotent、from は audit 対象外」と読める) なので減点しない。
- actor: `session.userId` (public.users.id, UUID)。authUserId ではなく user table id を使うのは **テナント内 actor 識別として正しい**。

### Medium (-2)
- **MED-2 (Atomicity)**: UPDATE と writeAudit が **同一トランザクションに入っていない**。`updated` が確定した後 audit ループ中に DB が落ちると「DISQUALIFIED にはなったが audit ログが欠落」する状況が発生し、§17 改竄耐性監査の前提が崩れる。Drizzle の `db.transaction(async (tx) => { ... })` で update + writeAudit を包むのが本来の形。
- **MED-2b (N+1 / hash chain serialization)**: 500 件まで許容しているが、各 audit は **直前エントリの hash を SELECT → INSERT** で逐次実行。500 件で 500 SELECT + 500 INSERT になり、(a) 応答時間が秒オーダーに伸びる (b) 同時に他の audit 書込みが走ると **hash chain の prev_hash が race する** (実装は last-row を読むだけで lock 取らない)。`SELECT ... FOR UPDATE` または single-flight キューで直列化する設計が必要。
- 軽め: `fromIp` / `fromUa` / `correlationId` が未セット。これは S07 単独というより `writeAudit` 呼び出し側全体の設計課題で、本レビューでは情報共有のみ。

---

## 5. XSS / Open Redirect / コード匂い (17/20)

### 評価
- **XSS**: lead-drawer.tsx と leads-table.tsx の表示はすべて **React 子要素として補間** (`{lead.name}`, `{row.headline}` 等)。`dangerouslySetInnerHTML` の使用ゼロ、`innerHTML` 操作ゼロ。LinkedIn 由来の `fullName` / `headline` / `company` も React のテキストエスケープが効くため XSS 不能。
- **Open Redirect**: `Link href={\`/leads?lead=${row.id}\`}` / `\`/campaigns/${row.campaignId}\``。いずれも **絶対 URL でなく相対パス**、外部ドメインに飛ぶ経路なし。`hrefFor(p)` も同様にローカル URL のみ生成。
- **CSRF**: bulkDisqualifyLeads は **Server Action**。Next.js 15 系の Server Action は **同一オリジン + Origin/Host 検証 + action ID 署名** が標準で効く。GET ではないため CSRF 表面は限定的。
- **Confirm dialog**: `window.confirm` は UX 上の確認だけで、サーバー側で再判定しているため security gate ではない (これで十分)。
- **`row.score - 56` (lead-drawer L155)**: `Engagement` の max 25 棒グラフだが、`row.score` が 0-100 の整数で `score - 56` が **負になり得る**。`Math.max(0, ...)` で clip しており不正な width にはならないが、デモ表示として「Engagement: 0/25」が突然出るのは UX 警告。security 上は無害。

### Low (-3)
- **LOW-1 (`?lead=` の事前バリデーション欠如)**: page.tsx L43 で `drawerLeadId = sp.lead ?? ""` をそのまま `getLeadById` に渡す。queries 側の try/catch が拾うので **情報漏えいには繋がらない**が、(a) Postgres へ毎回 invalid uuid を送って bind error を起こすコストが発生、(b) error log がノイズ化する。`z.string().uuid().safeParse(sp.lead)` を 1 行噛ませれば、不正値は即 `null` に折りたためる。
- **LOW-2 (`degraded` ブランチでの incidentId)**: page.tsx L93-100 で `incidentId` を `<code>` ノードにそのまま埋め込む。incidentId は `INC-2026-A1B2C3` 形式の自前生成で外部入力ではないため XSS 表面ではないが、**ユーザー宛 UI 文字列にサーバー内部識別子を露出する以上、format バリデーション** (`/^INC-\d{4}-[0-9A-F]{6}$/`) を 1 行入れるのが堅い。`incident.ts` 生成元が信頼でき現状は無害なので Low 扱い。
- **LOW-3 (cache header)**: `dynamic = "force-dynamic"` / `fetchCache = "force-no-store"` でサーバー側は OK だが、**HTML レスポンスに `Cache-Control: no-store` を強制している保証は middleware 側になし**。CDN/SW にリード一覧が乗ると個人情報 (PII: 氏名/会社/役職) が漏れる。middleware.ts または next.config.ts 側で `/leads` を private/no-store にする確認推奨。

---

## HIGH / MEDIUM / LOW サマリ

### HIGH
*なし*

### MEDIUM
1. **MED-1 (Cross-Tenant Hardening / DiD)**: `leftJoin(campaigns, ...)` および `leftJoin(users, ...)` に **`AND campaigns.org_id = leads.org_id`** を追加して防御深化する。
   - 影響: 将来の org 操作で cross-tenant campaign name が露出する潜在リスク
   - 修正案 (queries/leads.ts L97-98 + L181-182):
     ```ts
     .leftJoin(
       schema.campaigns,
       and(
         eq(schema.campaigns.id, schema.leads.campaignId),
         eq(schema.campaigns.orgId, schema.leads.orgId),
       ),
     )
     ```

2. **MED-2 (Atomicity: UPDATE + audit log)**: `bulkDisqualifyLeads` の UPDATE と `writeAudit` ループを **`db.transaction`** で囲い、audit 書込み失敗で UPDATE をロールバックする。
   - 影響: 部分書込み (DISQUALIFIED 済だが audit 欠落) で改竄耐性監査要件 §17 に違反する可能性
   - 修正案 (actions/leads.ts L52-74):
     ```ts
     const updated = await db.transaction(async (tx) => {
       const rows = await tx.update(schema.leads)...returning(...);
       for (const r of rows) {
         await writeAudit({ ...(tx を渡せるよう要シグネチャ拡張) });
       }
       return rows;
     });
     ```

3. **MED-2b (Audit hash-chain race / N+1)**: 500 件まで許容しているのに **prev_hash 取得を毎回 SELECT** している。`audit_log` テーブルへ `(org_id) WHERE rownum = MAX` の SELECT FOR UPDATE か、advisory lock (`pg_advisory_xact_lock(hashtext(org_id))`) で **同一 org の audit 書込みを直列化** する。
   - 影響: 同時バルク操作で hash chain が分岐し、後段の検証で「prevHash mismatch」を起こす

### LOW
1. **LOW-1**: `?lead=` を `getLeadById` に渡す前に `z.string().uuid().safeParse` で事前検証して、不正値で DB error を撒かない。
2. **LOW-2**: incidentId を UI へ出す箇所で `/^INC-\d{4}-[0-9A-F]{6}$/` の正規表現バリデーションを噛ませる (現状は信頼できる自前生成元なので予防策)。
3. **LOW-3**: `/leads` ルートの HTTP レスポンスに `Cache-Control: private, no-store` が出ているか middleware 経由で確認。CDN/SW へ PII が乗る経路を遮断。

---

## チェック対象の個別ベリディクト

| 設問 | 結論 |
|---|---|
| `listLeads` の `sql\`\`` 内 ILIKE 注入対策 | ✅ 安全。`escapeLikePattern` で LIKE メタ文字を中和、`${like}` は drizzle のパラメータバインドに乗るため SQLi 不能 |
| `bulkDisqualifyLeads` の ids が他テナント混入時の挙動 | ✅ 安全。`and(eq(orgId), inArray(ids))` により他テナント id は WHERE で除外され、`.returning()` の戻り値ベースで監査も発火するため silent ignore される |
| `?lead=` UUID 検証 (getLeadById で形式チェック必要か) | ⚠ Low 推奨。現状は drizzle の uuid バインド失敗 + try/catch で実害なしだが、Zod uuid 事前検証でログノイズと DB ラウンドトリップを節約できる |
| ドロワー XSS 表面 (React 自動エスケープで安全のはず) | ✅ 安全。`dangerouslySetInnerHTML` 不使用、全フィールドが React 子テキストとして補間される |

---

## 修正優先度 (実装着手順)

1. **MED-2**: `db.transaction` で UPDATE + writeAudit を atomic に → 1 PR で完結
2. **MED-1**: join 条件に `eq(campaigns.orgId, leads.orgId)` を追加 (queries/leads.ts 2 箇所) → 同 PR
3. **MED-2b**: audit hash-chain 直列化 → audit.ts 側を `FOR UPDATE` 化 (横断改修なので別 PR)
4. **LOW-1〜3**: 追加でまとめて 1 PR

---

## 結論

**APPROVED with Medium-priority hardening recommended.**

総合 94/100 で 90+ ライン通過。HIGH 級の脆弱性は確認されず、テナント分離・認可・入力検証は本番運用に耐える水準。Medium は **正常系では実害が出ないが、運用変更やバルク同時操作で顕在化する設計上のハードニング** であり、S07 リリース前に MED-2 だけはトランザクション化を強く推奨 (audit 改竄耐性が §17 の核なので)。Low は次イテレーションでまとめて対応で十分。
