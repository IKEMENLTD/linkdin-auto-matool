# LinkdInside — LinkedIn 自動営業 SaaS

日本語 B2B に最適化された、レビュー必須・安全モード搭載の LinkedIn 自動営業 SaaS。
設計書（`docs/ui-ux/UI_UX_Design.md` v1.3）に従い、Next.js 15 + Supabase + Drizzle で実装中。

## 技術スタック

- **Frontend**: Next.js 15 (App Router) / React 19 / TypeScript / Tailwind v4
- **Design**: 自前 shadcn 互換 UI / lucide-react / Manrope + Geist + Noto Sans JP
- **Backend**: Server Actions / Drizzle ORM / Postgres (Supabase)
- **Auth**: Supabase Auth（マジックリンク）
- **State**: TanStack Query / Zustand
- **Realtime**: SSE（実装予定 Phase2）

## デザインコンセプト — Refined Hydro Minimalism

- 白基調 + 水色グラデ（sky → cyan → teal）
- 大型エディトリアル数値（KPI を雑誌風に大きく / kpi-numeral）
- Subtle grain + 上部 gradient mesh（`.hydro-canvas`）
- Tinted shadow `0 12px 32px -16px rgba(14,165,233,0.20)`
- 状態 chip は **アイコン + 色 + 文字** の三重表現（カラーブラインド対応）

## ディレクトリ

```
app/
  layout.tsx                    フォント / メタ
  page.tsx                      ダッシュボードへリダイレクト
  globals.css                   Tailwind v4 + デザイントークン
  login/                        サインイン
  (app)/
    layout.tsx                  サイドバー + ヘッダーつきの認証エリア
    dashboard/                  S03 ダッシュボード
components/
  ui/                           Button / Card / Badge / StateChip / Skeleton
  app/                          Sidebar / Header
  brand/                        Logo
  dashboard/                    NsmHero / KpiCard / Funnel / AttentionList / ActivityChart / RecentCampaigns
lib/
  utils.ts / formatters.ts / state-machine.ts
  supabase/                     server / client
db/
  schema.ts                     Drizzle スキーマ（organizations / users / leads / messages / audit_log 等）
  client.ts
server/
  queries/dashboard.ts          ダッシュボード集計 (DB 未接続時はモック)
  actions/auth.ts               マジックリンク認証
docs/
  ui-ux/UI_UX_Design.md         UI/UX 設計書 v1.3
  ui-ux/reviews/                Round1〜3 並列レビュー記録
LinkedIn自動営業SaaS構築設計書.docx
```

## セットアップ

```bash
# 依存をインストール
npm install

# .env.local を作成（.env.example を参考）
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, DATABASE_URL を埋める

# DB スキーマを反映
npm run db:push

# 開発サーバ起動
npm run dev
```

`http://localhost:3000` でダッシュボードが起動します。
DB / Supabase の環境変数を設定しないと、ダッシュボードは **mock モード** でサンプルデータを表示します。

## 主要画面（実装ロードマップ）

| # | 画面 | パス | 状態 |
| --- | --- | --- | --- |
| S03 | ダッシュボード | `/dashboard` | ✓ MVP |
| S04 | キャンペーン一覧 | `/campaigns` | 次 |
| S05 | キャンペーン作成 Wizard | `/campaigns/new` | 次 |
| S07 | リード一覧 | `/leads` | 次 |
| S09 | 受信箱 | `/inbox` | 次 |
| S10 | 会話画面 | `/inbox/:id` | 次 |
| S11 | LinkedIn 接続 | `/connections/linkedin` | 次 |

## 設計書ハイライト

5 観点並列レビューを 3 ラウンド実施し、平均 95.0/100 で APPROVED：

| 観点 | R1 | R2 | R3 |
| --- | --- | --- | --- |
| Designer (UX) | 78 | 91 | **94** |
| PM | 73 | 89 | **96** |
| CTO | 71 | 89 | **94** |
| Security | 64 | 86 | **96** |
| SRE | 62 | 87 | **95** |
| **平均** | 69.6 | 88.4 | **95.0** |

詳細は `docs/ui-ux/UI_UX_Design.md` を参照。

## 実装コードレビュー

実装したコードを 5 観点で 4 ラウンド並列レビューを実施：

| 観点 | R1 | R2 | R3 | R4 |
| --- | --- | --- | --- | --- |
| Designer (UX) | 86 | **96** | — | — |
| CTO | 72 | 93 | 94 | **96** |
| Security | 44 | 74 | **96** | — |
| SRE | 62 | 84 | 89 | **96** |
| Code-Review | 72 | 94 | 94 | **96** |
| **平均** | 67.2 | 88.2 | 93.8 | **96.0** |

最終 R4 で **5 観点全てが 96/100 で PASS**。MVP 本番投入水準に到達。
詳細は `docs/reviews/code-r{1,2,3,4}/` を参照。

## セキュリティ機構

- **認証**: Supabase Auth (Magic Link / PKCE) + middleware による自動セッション更新
- **マルチテナント**: `users.auth_user_id` ベース（email 突合は禁止、§17 ABAC）
- **RLS**: `db/migrations/0001_rls_phase2.sql` で全テーブルに `FORCE ROW LEVEL SECURITY` + `TO authenticated`
- **DB Scope**: `lib/db-scoped.ts` の `withScopedDb()` で `set_config('app.org_id', ..., is_local=true)` を transaction 内で発行
- **監査**: `lib/audit.ts` で SHA-256 hash chain (append-only)
- **CSP**: Report-Only モード + `/api/csp-report` で違反観測（Phase2 で nonce 化 → enforcing 移行）
- **Rate Limit**: `lib/rate-limit.ts` (MVP は memory bucket、Phase2 で Upstash Ratelimit)
- **Headers**: HSTS / X-Frame-Options DENY / Permissions-Policy / Referrer-Policy
