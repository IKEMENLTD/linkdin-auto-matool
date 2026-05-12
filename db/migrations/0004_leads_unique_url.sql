-- =============================================================================
-- 0004_leads_unique_url.sql
-- (org_id, linkedin_url) の複合 UNIQUE インデックスを追加。
-- - CSV bulk import (POST /api/leads/import) の ON CONFLICT DO NOTHING で参照
-- - org スコープにすることでテナント間衝突を避ける (RLS §17 と整合)
-- =============================================================================

BEGIN;

-- 1) 事前正規化: 既存 leads.linkedin_url を `https://www.linkedin.com/in/{id}` 形へ揃える
UPDATE leads
SET linkedin_url = lower(
  regexp_replace(
    split_part(split_part(linkedin_url, '?', 1), '#', 1),
    '/+$', ''
  )
)
WHERE linkedin_url IS NOT NULL;

-- 2) (org_id, linkedin_url) で重複している行があれば、新しい方を残し古い方を消す
DELETE FROM leads l
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY org_id, linkedin_url
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM leads
) dup
WHERE l.id = dup.id
  AND dup.rn > 1;

-- 3) UNIQUE インデックス
CREATE UNIQUE INDEX IF NOT EXISTS leads_org_linkedin_url_uniq
  ON leads (org_id, linkedin_url);

COMMIT;
