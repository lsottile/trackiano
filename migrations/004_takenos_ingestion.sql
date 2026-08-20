ALTER TABLE expenses ADD COLUMN ingest_id TEXT;

CREATE UNIQUE INDEX expenses_ingest_id_unique
  ON expenses (user_id, ingest_id)
  WHERE ingest_id IS NOT NULL;

CREATE TABLE merchant_mappings (
  user_id UUID NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  budget_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, merchant),
  FOREIGN KEY (budget_id, user_id)
    REFERENCES budgets(id, user_id) ON DELETE CASCADE
);

CREATE INDEX merchant_mappings_budget_user_idx
  ON merchant_mappings (budget_id, user_id);

CREATE TABLE pending_ingestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  ingest_id TEXT NOT NULL,
  merchant TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, ingest_id)
);

ALTER TABLE merchant_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_ingestions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON merchant_mappings, pending_ingestions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON merchant_mappings, pending_ingestions FROM authenticated;
  END IF;
END
$$;
