-- Comments against a single intake field.
--
-- Until now the discussion was one thread per ticket, so "what did you mean by the
-- pickup window" and "is the weight declared or DWS" landed in the same list and had to
-- be read in full to work out which field each referred to. PNS reads the charter field
-- by field, so the question belongs next to the field.
--
-- field_key is the intake payload key (pickSlot, wt, dest …). NULL keeps the existing
-- behaviour: a comment on the ticket as a whole, which is what the recap posts.
ALTER TABLE ticket_comments
    ADD COLUMN field_key VARCHAR(40) NULL AFTER ticket_id,
    ADD KEY idx_comment_field (ticket_id, field_key, resolved_at);

-- Sales must supply these before a go-live date means anything: Ops cannot onboard a
-- shipper they cannot identify in the account systems. They live in the intake payload
-- rather than as columns because the whole intake field set is still settling.
