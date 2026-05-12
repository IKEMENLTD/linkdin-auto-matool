-- 0002_messages_metadata.sql
-- AI 分類結果や DLP メタデータを格納する jsonb 列を messages に追加する。
-- - 既存行は NULL のまま (jsonb NULL は領域コストほぼゼロ)
-- - GIN index は「ai_classification.classification」フィルタを高速化

ALTER TABLE "messages"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb;

-- 分類カテゴリ別の集計クエリ用
-- 例: WHERE metadata->'ai_classification'->>'classification' = 'positive'
CREATE INDEX IF NOT EXISTS "msg_metadata_gin_idx"
  ON "messages" USING gin ("metadata" jsonb_path_ops);

-- 既存 RLS ポリシー (0001) の対象に metadata は含まれるため追加変更不要。
