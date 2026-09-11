ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS is_extraordinary BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE expenses AS e
SET is_extraordinary = TRUE
FROM budgets AS b
WHERE e.budget_id = b.id
  AND e.user_id = b.user_id
  AND e.deleted_at IS NULL
  AND lower(b.name) = 'investments';
