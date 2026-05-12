-- =============================================================================
-- 0003: global halt + incident_log
--   設計書 §12.3 安全層 / §17 監査基盤 / §24 監視
--
-- 目的:
--   1) organizations.global_halt_at  — 全 LinkedIn アクションを即時停止する flag
--   2) incident_log                  — URN mismatch 等のインシデントを append-only に保存
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1) organizations.global_halt_at
-- -----------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS global_halt_at timestamptz;

COMMENT ON COLUMN organizations.global_halt_at IS
  'NOT NULL の場合、この org の LinkedIn 送信系アクションを全停止する (cron / API gate)';

CREATE INDEX IF NOT EXISTS organizations_global_halt_idx
  ON organizations (global_halt_at)
  WHERE global_halt_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2) incident_log
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS incident_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id  varchar(32) NOT NULL,
  severity     varchar(16) NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incident_log_severity_chk
    CHECK (severity IN ('critical', 'warning', 'info'))
);

COMMENT ON TABLE incident_log IS
  'URN mismatch / break-glass / circuit breaker 等のインシデント記録 (append-only)';
COMMENT ON COLUMN incident_log.incident_id IS 'INC-YYYY-XXXXXXXX (lib/incident.ts)';

CREATE UNIQUE INDEX IF NOT EXISTS incident_log_incident_id_uidx
  ON incident_log (incident_id);

CREATE INDEX IF NOT EXISTS incident_log_org_created_idx
  ON incident_log (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS incident_log_severity_idx
  ON incident_log (severity)
  WHERE severity = 'critical';

-- append-only: UPDATE / DELETE を rule で禁止
CREATE OR REPLACE RULE incident_log_no_update AS
  ON UPDATE TO incident_log DO INSTEAD NOTHING;
CREATE OR REPLACE RULE incident_log_no_delete AS
  ON DELETE TO incident_log DO INSTEAD NOTHING;

-- -----------------------------------------------------------------------------
-- 3) RLS (0001_rls_phase2.sql と整合)
-- -----------------------------------------------------------------------------
ALTER TABLE incident_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_log       FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON incident_log FROM anon;

CREATE POLICY incident_log_isolation ON incident_log
  FOR ALL TO authenticated
  USING (org_id = app_current_org())
  WITH CHECK (org_id = app_current_org());

COMMIT;
