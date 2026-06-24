-- db/migrations/001-flow-updated-at.sql
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'flow' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE flow ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;
