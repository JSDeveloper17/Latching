ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS total_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS success_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failed_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_filename text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS error_details jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_counts_non_negative'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_counts_non_negative CHECK (
        total_count >= 0
        AND processed_count >= 0
        AND success_count >= 0
        AND failed_count >= 0
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS jobs_user_status_created_at_idx ON jobs (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_user_report_filename_idx ON jobs (user_id, report_filename) WHERE report_filename IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_logs_user_id_fk
    FOREIGN KEY (user_id)
    REFERENCES users (id)
    ON DELETE SET NULL,
  CONSTRAINT audit_logs_action_not_blank CHECK (length(trim(action)) > 0),
  CONSTRAINT audit_logs_entity_type_not_blank CHECK (length(trim(entity_type)) > 0)
);

CREATE INDEX IF NOT EXISTS audit_logs_user_id_created_at_idx ON audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_created_at_idx ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id);