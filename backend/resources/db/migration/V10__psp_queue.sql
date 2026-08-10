-- PSP gets its own PIC and a two-stage return path.
--
-- psp_assignee: who in PSP is handling this ticket. Flat, not head-gated — PSP has no
-- staff/head distinction in this app, so any PSP member may self-assign or hand it to a
-- teammate, the same way any PSP member may already approve or reject.
--
-- psp_ready: PSP approved a margin that did NOT also need PNS review, so the ticket went
-- back to whoever priced it (Pending PNS / Pending Sales) for a final, explicit submit —
-- not a re-price. This flag is what tells Awaiting Price to show "Submit proposal"
-- instead of the normal price-attach form. It is cleared the moment either happens: the
-- final submit is used, or a fresh price is attached (a new pricing cycle starts).
--
-- PSP's approve/reject decisions are already recorded in `approvals` (kind='psp'); no new
-- table needed for the "Finished" queue — it reads the latest one per ticket.

ALTER TABLE tickets ADD COLUMN psp_assignee VARCHAR(255) NULL;
ALTER TABLE tickets ADD COLUMN psp_ready TINYINT(1) NOT NULL DEFAULT 0;
