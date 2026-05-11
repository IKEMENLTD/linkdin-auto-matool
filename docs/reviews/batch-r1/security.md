# Batch R1 — Security Review (S15 / S14 / S17 / S19 / S24 / S21 / S25 / S26)

レビュアー: security-design-agent
日時: 2026-05-11 JST
スコープ: 直近 8 画面の **コード実装** に対する STRIDE + OWASP Top10 観点レビュー
目標: 各画面 88+ / 100

---

## TL;DR

| 画面 | スコア | 判定 | 主な指摘 |
| --- | ---: | --- | --- |
| S14 プラン/請求 | **92** | APPROVED | Stripe 連携 Phase2 なので攻撃面小。`session` を表示分岐に使うのは適切 |
| **S15 メンバー/権限** | **78** | **NEEDS_REVISION** | RoleChanger 即時送信 / `lead.assigned` action 流用 / IP・UA 未記録 / Owner 唯一性チェック未検証 |
| S17 通知センター | **90** | APPROVED | モックのみだが構造は安全。XSS 経路なし、href 全て内部固定 |
| **S19 監査ログ** | **94** | APPROVED | ABAC ゲート OK · orgId スコープ徹底 · 横断漏洩なし |
| S21 利用上の注意 | **96** | APPROVED | 公開静的、攻撃面ほぼゼロ |
| S24 /status | **89** | APPROVED (1件 minor) | `/api/health` は noindex・region 露出は許容範囲。SERVICES がハードコード `operational` でステータス偽装リスクは低 |
| S25 ジョブ/DLQ | **88** | APPROVED | 全 disabled で実装攻撃面ゼロ。Phase2 時の payload 表示ポリシー要設計 |
| **S26 Break-Glass** | **82** | NEEDS_REVISION (運用) | 静的ページ自体は OK だが **ミドルウェアの PUBLIC_PATHS に未登録** で SSO ロックアウト時にアクセス不能 |

**Blocker (必修)** … 3 件 (S15 × 2、S26 × 1)
**Suggestion (任意)** … 9 件

---

## 1. S15 メンバー / 権限 — Score 78 / 100 — **NEEDS_REVISION**

### Files
- `app/(app)/settings/team/page.tsx`
- `components/settings/members-table.tsx`
- `server/actions/members.ts`
- `server/queries/members.ts`

### STRIDE
| 観点 | 評価 | メモ |
| --- | --- | --- |
| Spoofing | ◯ | `getSession` → `auth_user_id` で突合、email 突合は禁止と明記 |
| Tampering | △ | role change が `prev_hash` chain には乗るが action 名が嘘 |
| Repudiation | × | actor IP / UA / correlationId が audit に **記録されていない** |
| Info Disclosure | △ | エラー時 `incidentId` のみ返すのは ◯。ただし `console.error` が本番非依存で出ない設計 OK |
| DoS | △ | rateLimit はメモリ実装、サーバレスでは効かない (本人もコメント済) |
| Elev. of Privilege | △ | Owner 唯一性チェック (最低1Owner) のロジックが弱い |

### Blockers (must fix before merge)

**B-S15-1 [HIGH] Select onChange での `requestSubmit()` 即時送信は誤操作 + クリックジャック攻撃面**
`components/settings/members-table.tsx:189-193`
```tsx
onChange={(e) => {
  // 即時送信
  const form = e.currentTarget.form;
  if (form) form.requestSubmit();
}}
```
問題:
1. **誤操作リスク**: キーボード操作の Tab→矢印キーで意図せず Owner→Viewer 等の権限降格が発火する。ユーザーが「確認ダイアログ無しで Owner 降格できる」唯一の UI 経路。
2. **クリックジャック**: select に CSS で重ねた iframe からの操作で同一発火可。CSP/`X-Frame-Options` がリポジトリで確認できない (今後の同タスク CTO レビューで確認)。
3. **トースト誤認**: `useActionState` で来る state を `reported.current` で参照同値比較しているため、同じ role に再度変更しようとした際に Pending UI が出ず、ユーザーは「変更が走ったかどうか」を視認しづらい。

修正案:
```tsx
// Option A: 別ボタンで確定 (推奨)
<Select … defaultValue={currentRole} onChange={onLocalChange} />
{pending && <span>変更中…</span>}
{dirty && <Button type="submit">適用</Button>}

// Option B: 確認ダイアログ
onChange={(e) => {
  const next = e.currentTarget.value;
  if (!confirm(`ロールを ${next} に変更します。よろしいですか？`)) {
    e.currentTarget.value = currentRole;
    return;
  }
  e.currentTarget.form?.requestSubmit();
}}
```
**特に Owner → 他ロールへの降格は 4-eye 承認 (Phase2) もしくは別 Owner 同意必須にすべき**。設計書 §6.9 / §17 と整合。

---

**B-S15-2 [HIGH] `audit.action = "lead.assigned"` での流用は監査ログの検索性・コンプライアンス整合性を壊す**
`server/actions/members.ts:68, 124`
```ts
await writeAudit({
  …,
  action: "lead.assigned",    // ← role 変更なのに lead.assigned
  targetType: "user",
  purpose: "role_change",
  diff: { role: { to: parsed.data.role } },
});
```
問題:
1. **監査ログ検索性**: GDPR / SOC2 監査で「過去 13ヶ月の権限変更履歴を出して」と言われた時、`action = "lead.assigned" AND target_type = "user"` というクエリを書く必要がある。`purpose = "role_change"` も自由文字列で書式保証なし。
2. **集計 / アラート阻害**: `event:role.changed` のような SIEM ルールが書けない。「Owner 昇格が短時間に複数回」のような検知ができない。
3. **将来の改修コスト**: 後で action enum を整備して既存ログを変換するマイグレーションは hash chain を壊しかねない (or 別カラムで補正する必要)。

修正:
`lib/audit.ts` の `AuditAction` 型に以下を追加し、`writeAudit` 呼び出しを差し替える:
```ts
| "user.role_changed"
| "user.deactivated"
| "user.invited"        // Phase2
| "user.reactivated"    // Phase2
```
そして migration で `audit_action_enum` 制約を更新。enum が DB 側 check 制約なら ALTER 必要。

**この変更は今すぐ実施可能** (新規 enum 追加は既存 hash chain に影響しない)。Blocker 扱い。

---

### Suggestions (応急処置不要だが今 sprint 内で)

**S-S15-1 [MED] audit に `fromIp`, `fromUa`, `correlationId` を渡していない**
`server/actions/members.ts` 全体で `writeAudit({…})` の引数に IP / UA / correlationId を一切渡しておらず、schema 上は NULL になる。Server Action 内でも `headers()` から `x-forwarded-for` / `user-agent` を取得して渡すべき。これがないと「権限変更を誰が何処からやったか」という最重要監査項目が空欄になる。

```ts
import { headers } from "next/headers";
const h = await headers();
const fromIp = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
const fromUa = h.get("user-agent") ?? null;
const correlationId = h.get("x-request-id") ?? crypto.randomUUID();
```

**S-S15-2 [MED] Owner 唯一性チェックがロジックバグ**
`members.ts:46-48`
```ts
if (parsed.data.userId === session.userId && parsed.data.role !== "owner" && session.role === "owner") {
  return { ok: false, message: "自身の Owner 権限は降格できません" };
}
```
これは「自分が Owner なら自分を降格できない」だけで、**「他人を最後の Owner から降格させる」ケースを防げない**。例: Owner A・Admin B の組織で、A が休暇中に B (Admin) が A を Operator に降格 → 組織全体 Owner 0 で復旧不能。

実装:
```ts
// Owner 数チェック (降格時のみ)
if (currentRole === "owner" && parsed.data.role !== "owner") {
  const remainingOwners = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(and(eq(schema.users.orgId, session.orgId), eq(schema.users.role, "owner"), eq(schema.users.isActive, true)));
  if ((remainingOwners[0]?.c ?? 0) <= 1) {
    return { ok: false, message: "Owner は最低 1 名残す必要があります" };
  }
}
```
同様に `deactivateMember` でも最後の Owner 無効化を拒否すべき。

**S-S15-3 [LOW] `confirmingId` state が `useState` で各行に対し排他ではない**
1 つのコンポーネント内で `confirmingId` を 1 つだけ持っているので排他は OK。ただし `currentUserId` が null の場合 (DEMO モード) は全員 `isSelf = false` 扱いとなり、自分自身を操作可能になる。DEMO では DB no-op なので実害ゼロだが、本番接続時の境界として注意。

**S-S15-4 [LOW] `rateLimit("role:${session.userId}:${parsed.data.userId}", 5, 60_000)` のキー設計**
攻撃者は対象ユーザを変えれば回避可能。`role:${session.userId}` (actor 単位) と `role:${session.orgId}` (組織単位) の 2 軸両方で leaky bucket すべき。

---

## 2. S14 プラン / 請求 — Score 92 / 100 — APPROVED

### Files
- `app/(app)/settings/plan/page.tsx`

### Threats
- Stripe 連携 / カード更新 / 請求書ダウンロードは全て `disabled title="Phase2"`。**攻撃面ゼロ**。
- `USAGE` は静的モック。SSRF / IDOR 経路なし。
- `getSession()` の `!session` フラグで DEMO バナーを出すだけ。session 自体は (app) group の middleware で保護済み。

### Findings
- **Suggestion**: Phase2 で実装する Stripe Webhook は **署名検証必須** (`stripe-signature` header)。エンドポイントは raw body を verifyRawBody で扱う必要あり (Next.js Edge では特に注意)。
- **Suggestion**: 「上限到達時の挙動は既定で自動停止」と書いているが、上限突破ロジックの **server-side 強制** (DB トリガー or query gate) を Phase2 で必ず入れること。クライアント側だけだと改竄リスク。
- **Suggestion**: 「Owner の 2FA 再認証 + 月次上限金額の指定」は本文に書いてあるが、Stripe Quotas 連動の **金額 cap (例: ¥300k/月)** を必須に。Meta 広告の `spend_cap` 運用 (MEMORY.md `feedback_meta_spend_cap_rule.md`) と同じ事故 (¥1.2M/日暴走) を引き起こさないこと。

---

## 3. S17 通知センター — Score 90 / 100 — APPROVED

### Files
- `app/(app)/notifications/page.tsx`

### Threats
- データは `mockNotifications()` の静的固定。XSS なし、JSON.parse なし。
- `n.href` は内部固定 (`/connections/linkedin`, `/inbox/l1` 等) で `Link` に渡る。外部 URL 注入なし。
- `searchParams.level` は `ALLOWED` Set でフィルタ済 → 不正値はデフォルトに fallback。

### Findings
- **Suggestion [MED]**: Phase2 で永続化 + SSE 実装時、`n.description` に **外部入力 (返信本文等) が乗る** はず。その時点で React の autoescape に頼るだけでなく、description は plain text (HTML 非許可) を確定し、 `dangerouslySetInnerHTML` は絶対に使わないこと。
- **Suggestion [LOW]**: `n.href` を Phase2 で動的化する際、**`/` 始まりのパスのみ許可** する URL バリデータを噛ませる。`javascript:` / `data:` / `//evil.com` を弾く。
- **Suggestion [LOW]**: 「Critical を Owner が読了すると監査ログに記録」(設計書 §6.11.5) の挙動が現在実装されていない。Phase2 で `markNotificationRead` Server Action 時に `writeAudit({ action: "notification.critical_acked" })` を追加。

---

## 4. S19 監査ログ — Score 94 / 100 — APPROVED

### Files
- `app/(app)/audit/page.tsx`
- `server/queries/audit.ts`
- `lib/audit.ts`

### Threats
- **横断漏洩**: `listAuditLog` は `eq(schema.auditLog.orgId, orgId)` で必ず scope。`page.tsx:37` で `session?.orgId ?? null` を渡し、null 時は mock 返却。**OK**。
- **ABAC ゲート**: `page.tsx:23` で `!hasAtLeastRole(session.role, "admin")` で 403 表示。Manager/Operator/Viewer は監査ログ閲覧不可。**設計書 §6.9 と一致**。
- **改竄耐性**: `lib/audit.ts` で SHA-256 hash chain 実装済。`pg_advisory_xact_lock(hashtext(org_id))` で並行書込み race 防止。**実装ベストプラクティス通り**。
- **時刻情報**: `Asia/Tokyo` 固定で表示。UA / IP は表示するが、これは Admin+ にのみ見せる前提なので OK。

### Findings
- **Suggestion [MED]**: `verified: true` がハードコード (`server/queries/audit.ts:79`)。本来は **日次 cron で末尾エントリの hash を二重保管 (S3 worm bucket / Cloud KMS) と照合** する処理が必要 (Phase2)。今は警告にもならないので「✓ 検証済」が無条件に出るのは UX 上ミスリーディング。せめて `verified: false` 既定にして「未検証 (Phase2 で日次照合)」と出すべき。
- **Suggestion [MED]**: 「CSV エクスポート (権限要)」が page.tsx には実装されていない (設計書 6.11.6 では存在)。エクスポート機能を実装する際は: (a) CSV インジェクション対策 (`=`, `+`, `-`, `@` 始まりセルに `'` 接頭辞) (b) エクスポート自体を `audit.csv.exported` action として記録。
- **Suggestion [LOW]**: `e.diff` を `JSON.stringify` でテーブルに表示 (page.tsx:127)。PII (email / 個人名) が diff に混入する可能性。一覧では `diff: …` を伏字 (`diff:{3 fields}`) にして、ドロワーでのみ全文表示にするとリーク面を減らせる。
- **Suggestion [LOW]**: ページャ最大 `clamp(p, 1, 1000)` で 1000 ページまで。1000×50=50,000 件。これを超える組織では深いページにアクセスできなくなる。Phase2 で cursor-based pagination + 期間フィルタを必須に。

---

## 5. S21 利用上の注意 — Score 96 / 100 — APPROVED

### Files
- `app/legal/usage-policy/page.tsx`

### Threats
- 完全静的、入力なし、第三者 link なし (mailto: のみ)。
- メールアドレスが 2 箇所ハードコード (`dpo@`, `support@linkdinside.example`)。

### Findings
- **Suggestion [LOW]**: `mailto:` リンクのアドレスを `lib/contact.ts` 等で一元管理。今後変更時の漏れ防止。
- **Suggestion [LOW]**: Public route で `noindex` 不要だが、SEO 対策で title / description / `og:image` メタを揃えると good。

---

## 6. S24 /status — Score 89 / 100 — APPROVED (1件 minor)

### Files
- `app/status/page.tsx`
- `app/api/health/route.ts`

### Threats
- **公開ページに細粒度情報** (質問):
  - サービス名 6 つ (Web/API/DB/Unipile/LLM/Webhook) を出している
  - **ベンダー名を完全に晒している**: "Supabase Postgres", "Unipile Bridge", "LLM (Anthropic)"
  - これは **攻撃面情報の漏洩** に該当する可能性

### Findings

- **Suggestion [MED, 検討要]**: 公開ステータスページにベンダー固有名 (Supabase, Unipile, Anthropic) を出すことは業界標準的には許容範囲だが、攻撃者にとっては「このサービスは LinkedIn を Unipile で叩く / Anthropic API key を持っている」と即座に確定情報となる。代替案:
  - レベル1 (現状維持 OK): "Database", "LinkedIn Bridge", "AI Engine" のような **抽象名**で表示
  - レベル2 (上級): ベンダー名は status.linkdinside.example の (signed-in) 内部用と切り分け
  - 本決定はビジネス判断 (透明性 vs 攻撃面) なので **PM / Designer と相談**。
- **`/api/health` review** (`app/api/health/route.ts`):
  - `region` (`process.env.NEXT_PUBLIC_REGION`) と `version` を返している → version 露出はあまり望ましくない (脆弱性スキャナの絞り込みに使える)。**`X-Robots-Tag: noindex` は付いているが、誰でも GET 可**。Phase2 で version は内部 metric にだけ載せて、公開フィードからは外す。
  - `latencyMs` も公開している → サーバ負荷の推測に使われ得る。MVP は許容、本番では集計値 (P50/P95) のみ。
- **Suggestion [LOW]**: `STATUS` がコンパイル時定数 `OVERALL_STATUS = "operational"` で固定。これは「常に operational」を返すため **障害時に手動で deploy が必要** で、SLO 上の透明性が損なわれる。Phase2 で `/api/health` の結果を `force-dynamic` で読みに行く構成 (Suspense streaming) にすると良い。
- **🟢 GOOD**: ベル popup / Critical 表示等の認証情報はなく、PII リーク経路なし。
- **🟢 GOOD**: 過去インシデント欄が空でも「報告されたインシデントはありません」と明示。情報秘匿で攻撃者を欺くより透明性側に倒している点が GDPR/SOC2 monitorability に整合。

質問に対する直接回答: **「公開なのに細粒度情報を出していないか」→ 業界標準内、ただしベンダー名露出は要検討**。スコア -1 ベンダー名 / -2 version&latency 露出 / -8 OVERALL_STATUS 静的 → 89/100。

---

## 7. S25 ジョブ / DLQ — Score 88 / 100 — APPROVED

### Files
- `app/(app)/jobs/page.tsx`

### Threats
- 再試行 / DLQ 廃棄ボタンは全て `disabled title="Phase2 で実装予定"`。**現状の攻撃面ゼロ**。
- 表示データは `mockJobs()` のみ。
- `searchParams.status` は `ALLOWED` Set で限定。

### Findings
- **Suggestion [HIGH for Phase2]**: ジョブ `payload` を一覧に出している (`j.payload` = `"lead=l1, account=hayashi"`)。Phase2 で実装する時、**payload に PII (lead 氏名・メール) が含まれる**ことが必至。一覧表示では payload を `lead=l*** account=h***` のような短縮表示 / `id` のみに留め、詳細ドロワーで Manager+ にのみ全文を見せる ABAC を必須に。
- **Suggestion [HIGH for Phase2]**: `errorMessage` も一覧出力。Unipile 5xx のような generic は OK だが、**「Recipient is no longer a 1st connection」** のような対象人物が特定されるメッセージは PII 隣接情報。同様に詳細ドロワーに退避。
- **Suggestion [MED for Phase2]**: 再試行ボタン (Manager+) / DLQ 廃棄ボタン (Owner) は `formData.get("jobId")` を信用せず、必ず `eq(jobs.id, jobId) AND eq(jobs.orgId, session.orgId)` で scope 検証。これは IDOR の最大の罠。
- **Suggestion [MED for Phase2]**: DLQ 廃棄は **不可逆** なので 4-eye (Owner 1 名要請 + Admin 1 名承認) もしくは `confirm "DISCARD-DLQ"` テキスト入力フォームに。S15 deactivate と同じ UX パターンを再利用すべき。
- **Suggestion [LOW]**: `correlationId` を一覧出力 (slice 8 chars)。ログ漁り経路として正当 (デバッグ用) だが、本番 IP / 内部サービス推測には使えないので OK。

`disabled` ボタンが多いので現状の攻撃面は最小 → 88 点。

---

## 8. S26 Break-Glass — Score 82 / 100 — **NEEDS_REVISION (運用要修正)**

### Files
- `app/recovery/break-glass/page.tsx`
- `lib/supabase/middleware.ts`

### Threats
- ページ自体は完全静的 (フォーム実装 Phase2)、攻撃面ほぼゼロ。
- **だが**: ミドルウェアの `PUBLIC_PATHS` は以下の通り:
```ts
const PUBLIC_PATHS = ["/login", "/auth/callback", "/legal", "/api/health", "/api/csp-report", "/_next", "/favicon"];
```
**`/recovery` も `/status` も含まれていない**。

### Blocker

**B-S26-1 [HIGH 運用クリティカル] Break-Glass ページが未ログイン状態でアクセス不能**

`lib/supabase/middleware.ts:42-58`:
```ts
const PUBLIC_PATHS = ["/login", "/auth/callback", "/legal", "/api/health", "/api/csp-report", "/_next", "/favicon"];
const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
if (!user && !isPublic && pathname !== "/login") {
  // → /login へリダイレクト
}
```
これは Break-Glass の**前提**を破壊する:
- SSO ロックアウト時 → Supabase Auth session を持たない → middleware が `/login` にリダイレクト
- `/login` は SSO ボタンを表示 → IDP 障害なので SSO 通らない → **永遠の loop**

修正:
```ts
const PUBLIC_PATHS = [
  "/login",
  "/auth/callback",
  "/legal",
  "/recovery",      // ← 追加 (Break-Glass)
  "/status",        // ← 追加 (公開ステータスページ)
  "/api/health",
  "/api/csp-report",
  "/_next",
  "/favicon",
];
```

**同じ問題**: `/status` も middleware を通る ((app) group 外だが匹配パターンに引っかかる)。サインアウト状態の顧客が `/status` を見られない → 障害時に Twitter で「ステータスページ見れない」と言われる典型パターン。

**ただし注意**:
- `/recovery` を public にした上で、Phase2 のフォーム実装時に以下を必須:
  - レート制限: メール送信 5 回/IP/時間
  - CAPTCHA: メール送信前
  - 監査ログ: `BREAK_GLASS.attempt`, `BREAK_GLASS.granted` を必ず記録
  - 通知: 全 Owner にメール (現状ページにも記載済 ✓)
  - Idle Timeout: 5 分 (ページに記載済 ✓)
  - 4-eye 承認: 別人 Owner/Admin 承認 (ページに記載済 ✓)

**「Phase2 で実装」を明示している今のページはそのままで OK**。ただしルーティングを直さないと「設計書に書いた緊急復旧経路が物理的に到達不能」というコンプライアンス問題になる。

### Suggestions
- **Suggestion [MED]**: ページ下部の `support@linkdinside.example` mailto を **電話番号** 併記 (オペレーション SLA で「24h 以内 CSM 折り返し」と書いているが、メールサーバ自体が落ちていたら届かない)。Enterprise 向けは Hotline 電話番号必須。
- **Suggestion [LOW]**: ページ上部に大きな赤いバナーで「**現在 Phase2 実装中。緊急時は phone: +81-...**」を出す。今のページは UI 仕様の可視化が目的なので、緊急復旧経路を実際に必要とするユーザーが「ボタン押せないんだけど…」となる可能性。

---

## 補足: 横断観点

### 全画面 共通の弱点

**X-1 [LOW] DEMO 表示の境界**
複数の画面 (S14/S15/S17/S19/S25) で「DB 未接続 → mock 表示」のフォールバックが入っている。本番接続後にこのコードパスが残ると **「DB 障害時にダミー組織情報を表示する」** リスク。Phase1 完了時に環境変数 `NEXT_PUBLIC_DEMO_MODE` を導入して、本番では `mockMembers()` 呼び出しを `throw` させる安全装置を入れること。

**X-2 [MED] Server Action 全体で `headers()` を読まないため audit から IP/UA が抜ける**
S15 のみ指摘したが、他の Server Action (`campaigns.ts`, `connections.ts`, `leads.ts`, `wizard.ts`, `conversation.ts`, `auth.ts`) も同様の可能性。Batch-r2 で `server/actions/**/*.ts` の `writeAudit` 呼び出しを横断確認すべき。

**X-3 [LOW] `rateLimit` のメモリ実装**
全画面で利用 (今回は S15 のみ呼び出し) だが、Vercel Edge / マルチプロセスでは効かない。設計書に「Phase2 で Upstash Redis に置換」とコメント済だが、Phase1 ローンチ時には MVP 上等として明文化要 (cf. `lib/rate-limit.ts:7`)。

**X-4 [LOW] CSP / X-Frame-Options 未確認**
`middleware.ts` には CSP / X-Frame-Options ヘッダの設定なし。`next.config.ts` でヘッダ追加されているか別ファイル要確認 (今回スコープ外)。S15 RoleChanger 即時送信のクリックジャック対策として `X-Frame-Options: DENY` 必須。

---

## OWASP Top10 (2021) 照合

| # | 項目 | 該当画面 | 状態 |
| --- | --- | --- | --- |
| A01 Broken Access Control | S15 / S19 / S25 (Phase2) | △ S15 owner 唯一性 / IDOR scope (S25 Phase2) |
| A02 Cryptographic Failures | S26 (Phase2 KYC 画像 / Audit hash chain) | ◯ SHA-256 chain + advisory lock OK |
| A03 Injection | 全画面 | ◯ Zod 検証 + Drizzle parameterized |
| A04 Insecure Design | S15 RoleChanger 即時送信 | × B-S15-1 |
| A05 Security Misconfig | middleware PUBLIC_PATHS | × B-S26-1 |
| A06 Vulnerable Components | Out of scope | — |
| A07 Auth Failures | S15 Owner 唯一性 | △ S-S15-2 |
| A08 Data Integrity | Audit chain | ◯ |
| A09 Logging Failures | S15 audit action 流用 / IP UA 抜け | × B-S15-2, S-S15-1 |
| A10 SSRF | N/A (公開 status は静的) | ◯ |

---

## 次アクション提案

1. **今回 Phase1 ブロッカー (必修)**
   - B-S15-1: RoleChanger 即時送信を確認ステップ付きに変更
   - B-S15-2: AuditAction enum に `user.role_changed` / `user.deactivated` 追加 + 既存呼び出し差し替え
   - B-S26-1: `lib/supabase/middleware.ts` PUBLIC_PATHS に `/recovery`, `/status` を追加
2. **Phase1 中に対応 (推奨)**
   - S-S15-1: Server Action 全般で IP/UA/correlationId を audit に渡す共通 helper
   - S-S15-2: 最後の Owner 降格 / 無効化を tx 内でカウントチェック
3. **Phase2 必須**
   - S25 payload PII マスキング + IDOR scope テスト
   - S19 audit verified の本実装 (S3 worm bucket と日次照合)
   - S14 Stripe Webhook 署名検証 + spend cap

---

レビュアー署名: security-design-agent
target: docs/reviews/batch-r1/security.md
