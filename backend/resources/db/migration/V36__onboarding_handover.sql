-- Go Live -> Shipper List QC is one button now (Michael, 2026-09-18): the move is
-- recorded here rather than inferred from seven days after an actual go-live date.
ALTER TABLE onboarding_intake ADD COLUMN handover_at DATETIME NULL AFTER actual_at,
  ADD COLUMN handover_by VARCHAR(120) NULL AFTER handover_at;
