-- Rename the four review statuses to the "Pending Review - <who>" scheme (Baskoro,
-- 2026-08-11), so every approval gate reads uniformly and names who owes the decision.
-- History rows are renamed too: the timeline should read in today's vocabulary.

UPDATE tickets SET status = 'Pending Review - Head PNS'   WHERE status = 'Pending PNS Review';
UPDATE tickets SET status = 'Pending Review - Head Sales' WHERE status = 'Pending Head Review';
UPDATE tickets SET status = 'Pending Review - PSP'        WHERE status = 'Pending PSP Approval';
UPDATE tickets SET status = 'Pending Review - C-level'    WHERE status = 'Pending Exec Sign-off';

UPDATE ticket_history SET status = 'Pending Review - Head PNS'   WHERE status = 'Pending PNS Review';
UPDATE ticket_history SET status = 'Pending Review - Head Sales' WHERE status = 'Pending Head Review';
UPDATE ticket_history SET status = 'Pending Review - PSP'        WHERE status = 'Pending PSP Approval';
UPDATE ticket_history SET status = 'Pending Review - C-level'    WHERE status = 'Pending Exec Sign-off';
