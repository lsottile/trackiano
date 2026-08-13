ALTER TABLE expenses
  ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'expense',
  ALTER COLUMN budget_id DROP NOT NULL,
  ADD CONSTRAINT expenses_entry_type_check
    CHECK (entry_type IN ('expense', 'income')),
  ADD CONSTRAINT expenses_entry_shape_check
    CHECK (
      (entry_type = 'expense' AND budget_id IS NOT NULL) OR
      (entry_type = 'income' AND budget_id IS NULL)
    ),
  ADD CONSTRAINT expenses_income_amount_check
    CHECK (entry_type <> 'income' OR amount > 0);
