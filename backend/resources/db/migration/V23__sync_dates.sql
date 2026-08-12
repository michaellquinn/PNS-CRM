-- Two dates that were being conflated into one.
--
-- submitted_on already existed but was set to "the day this row was created here",
-- which for an imported ticket is the day somebody happened to run the sync — not the
-- day Sales raised the deal. That made every backfilled ticket look like it arrived the
-- morning of the import, and a week of pipeline age vanished. It now carries Sales
-- CRM's own date and is corrected on every refresh, because Sales CRM is the record.
--
-- first_synced_at is the fact that was missing: when this app first saw the deal. It is
-- written once, on the run that creates or first links the ticket, and never touched
-- again — the gap between the two dates is how long a deal sat in Sales CRM before PNS
-- knew about it, which is only measurable if neither date moves to meet the other.
ALTER TABLE tickets
    ADD COLUMN first_synced_at DATETIME NULL,
    ADD KEY idx_tickets_first_synced (first_synced_at);

-- Tickets already imported: the best available estimate of when this app first saw them
-- is the earliest history row, which for an imported ticket is its "imported from Sales
-- CRM" entry. Backfilled rather than left NULL so the column is usable immediately, and
-- only where a history row actually exists.
UPDATE tickets t
SET first_synced_at = (SELECT MIN(h.at) FROM ticket_history h WHERE h.ticket_id = t.id)
WHERE t.opportunity_id IS NOT NULL AND t.first_synced_at IS NULL;
