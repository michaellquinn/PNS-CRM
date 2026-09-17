-- Pricing is tagged Category 1/2/3 instead of carrying a margin % and discount %
-- (Michael, 2026-09-17). A tag only: approvals do not read it.
--   1  discount up to 40%
--   2  discount above 40%, margin still at or above 20%
--   3  margin below 20% (the floor is 10% for B2BR, 5% for LTL)
-- margin_pct and discount_pct are kept so figures entered before this stay readable.
ALTER TABLE pricing ADD COLUMN price_category TINYINT NULL AFTER discount_pct;
