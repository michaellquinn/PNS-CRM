-- The 2026-08-11 process decisions, in one migration.
--
-- 1. Must Win joins the tiering, but at a different level from the other two.
--    Hypercare and Strategic describe an ACCOUNT (and are inherited from the parent
--    group), so they live on shippers. Must Win describes ONE DEAL — the same account
--    can have a must-win opportunity and five ordinary ones — so it lives on the ticket.
--    Modelling it on the account would have quietly promoted every other opportunity
--    that account holds.
ALTER TABLE tickets
    ADD COLUMN must_win TINYINT(1) NOT NULL DEFAULT 0,
    ADD KEY idx_tickets_must_win (must_win);

-- 2. "Non-Strategic" becomes "Standard". Same tier, a name that says what it is rather
--    than what it is not — and it now reads as one of four alongside Must Win.
UPDATE shippers SET acct_type = 'Standard' WHERE acct_type = 'Non-Strategic';

-- 3. Two new statuses, both of which describe a real waiting state the board could not
--    express before.
--
--    "Pending CRM ID" — a ticket raised here with no Sales CRM opportunity behind it.
--    Sales CRM is the system of record; without its id the sync cannot find the deal, so
--    the ticket cannot be kept in step with the commercial reality and must not proceed.
--
--    "Open" — intake complete, nothing owed by Sales, and nobody has picked it up yet.
--    Previously these sat in "Pending PNS", which reads as "someone is working on it"
--    and hid the difference between work in progress and work nobody has started.
--
--    Existing tickets are not moved: "Pending PNS" tickets may genuinely be in progress
--    and this migration cannot tell which. The new states apply from here on.
