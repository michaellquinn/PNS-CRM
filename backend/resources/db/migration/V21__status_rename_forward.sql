-- Re-applies the status rename after V20, and settles the direction for good.
--
-- The two clones disagreed about the name of one status and both wrote to the same
-- database. V15 (this side) renamed the four review statuses to "Pending Review - X".
-- V20 (Michael's) renames "Pending Review - PSP" back to "Pending PSP Approval",
-- because from his build's point of view the new string was the unrecognised one.
--
-- Both were right locally and cannot both be right here. The rename is the decision on
-- record (Baskoro, 2026-08-11: name each gate for who decides), so this build's
-- vocabulary wins and V20 gets undone. That is what a merge is: one of the two has to
-- lose, out loud, in a file someone can read.
--
-- Deliberately a NEW migration rather than an edit to V20. V20 may or may not have been
-- applied to the shared database already — the evidence is ambiguous, and rewriting an
-- applied migration is a checksum failure that blocks every future deploy. Running
-- after it is safe either way: if V20 ran, this reverses it; if it never ran, this is a
-- no-op against rows that already carry the new name.
--
-- The WHERE clauses also catch rows written by the older build directly (SOF-2001423 was
-- created with "Pending PSP Approval" after V15 had already run), which is the same
-- orphaning Michael's diagnostic was built to surface, pointed the other way.

UPDATE tickets SET status = 'Pending Review - Head PNS'   WHERE status = 'Pending PNS Review';
UPDATE tickets SET status = 'Pending Review - Head Sales' WHERE status = 'Pending Head Review';
UPDATE tickets SET status = 'Pending Review - PSP'        WHERE status = 'Pending PSP Approval';
UPDATE tickets SET status = 'Pending Review - C-level'    WHERE status = 'Pending Exec Sign-off';

UPDATE ticket_history SET status = 'Pending Review - Head PNS'   WHERE status = 'Pending PNS Review';
UPDATE ticket_history SET status = 'Pending Review - Head Sales' WHERE status = 'Pending Head Review';
UPDATE ticket_history SET status = 'Pending Review - PSP'        WHERE status = 'Pending PSP Approval';
UPDATE ticket_history SET status = 'Pending Review - C-level'    WHERE status = 'Pending Exec Sign-off';
