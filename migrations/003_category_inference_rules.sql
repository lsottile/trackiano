CREATE TABLE category_inference_rules (
  user_id UUID NOT NULL
    REFERENCES users(id) ON DELETE CASCADE,
  description_fingerprint BYTEA NOT NULL
    CHECK (octet_length(description_fingerprint) = 32),
  budget_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, description_fingerprint),
  FOREIGN KEY (budget_id, user_id)
    REFERENCES budgets(id, user_id) ON DELETE CASCADE
);

CREATE INDEX category_inference_rules_budget_user_idx
  ON category_inference_rules (budget_id, user_id);

ALTER TABLE category_inference_rules ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON category_inference_rules FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON category_inference_rules FROM authenticated;
  END IF;
END
$$;
