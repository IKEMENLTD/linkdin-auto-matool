-- =============================================================================
-- Row-Level Security (RLS) Policies — Phase2 で適用
-- 設計書 §17 ABAC / §26 脅威モデル「テナント分離」
--
-- 適用方法:
--   1) drizzle-kit push でテーブル作成後にこの SQL を順に実行
--   2) Supabase の Auth JWT に `org_id` を embed（auth hook で users テーブル参照）
--   3) すべてのアプリ書込みは `lib/db-scoped.ts` の `withScopedDb` 経由で行う
--      (set_config('app.org_id', ..., is_local=true) を transaction 内で発行)
-- =============================================================================

-- すべてのテーブルで RLS を有効化
ALTER TABLE organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_accounts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns          ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads              ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;

-- 強制 (BYPASSRLS 属性のないロールがバイパスできない)
ALTER TABLE organizations      FORCE ROW LEVEL SECURITY;
ALTER TABLE users              FORCE ROW LEVEL SECURITY;
ALTER TABLE linkedin_accounts  FORCE ROW LEVEL SECURITY;
ALTER TABLE campaigns          FORCE ROW LEVEL SECURITY;
ALTER TABLE leads              FORCE ROW LEVEL SECURITY;
ALTER TABLE messages           FORCE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics      FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log          FORCE ROW LEVEL SECURITY;

-- 現在の org_id を取得する関数（GUC ベース、SECURITY INVOKER）
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE SQL STABLE SECURITY INVOKER AS $$
    SELECT NULLIF(current_setting('app.org_id', true), '')::uuid;
$$;

-- ロール: Supabase の `authenticated` を主対象にし、anon は明示的に拒否
-- (公開エンドポイントは無いため)
REVOKE ALL ON organizations, users, linkedin_accounts, campaigns,
              leads, messages, daily_metrics, audit_log
       FROM anon;

-- 共通: org_id 一致のみ参照・更新可能
CREATE POLICY orgs_isolation ON organizations
  FOR ALL TO authenticated
  USING (id = app_current_org())
  WITH CHECK (id = app_current_org());

CREATE POLICY users_isolation ON users
  FOR ALL TO authenticated
  USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());

CREATE POLICY linkedin_accounts_isolation ON linkedin_accounts
  FOR ALL TO authenticated
  USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());

CREATE POLICY campaigns_isolation ON campaigns
  FOR ALL TO authenticated
  USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());

CREATE POLICY leads_isolation ON leads
  FOR ALL TO authenticated
  USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());

-- messages: lead 経由で org_id を辿る (USING / WITH CHECK 両方必要)
CREATE POLICY messages_isolation ON messages
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM leads l WHERE l.id = messages.lead_id AND l.org_id = app_current_org())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM leads l WHERE l.id = messages.lead_id AND l.org_id = app_current_org())
  );

CREATE POLICY daily_metrics_isolation ON daily_metrics
  FOR ALL TO authenticated
  USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());

-- audit_log: append-only。SELECT/INSERT のみ。UPDATE/DELETE は完全禁止 (Owner も不可)
CREATE POLICY audit_log_select ON audit_log
  FOR SELECT TO authenticated
  USING (org_id = app_current_org());

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT TO authenticated
  WITH CHECK (org_id = app_current_org());

-- UPDATE / DELETE を RESTRICTIVE で明示拒否 (任意のロール)
CREATE POLICY audit_log_no_update ON audit_log AS RESTRICTIVE
  FOR UPDATE TO authenticated USING (false);
CREATE POLICY audit_log_no_delete ON audit_log AS RESTRICTIVE
  FOR DELETE TO authenticated USING (false);
