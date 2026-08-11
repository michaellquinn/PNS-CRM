-- Data casualty of the 2026-08-11 deploy collision, not a new bug.
--
-- Baskoro's build .29/.30 was deployed directly and never reached GitHub (see the
-- Changelog entry "Deploy collision"). It used "Pending Review - PSP" as the status a
-- ticket carries once PNS sends it to PSP; this build has always used
-- "Pending PSP Approval". Deploying this build over his did not touch data already
-- written with his string, so any ticket he had pushed to PSP (SOF-2001322 confirmed,
-- there may be others) sat with a status value nothing in the current code recognises,
-- and simply stopped appearing in PSP -- Pending -- not deleted, not lost, just filed
-- under a label the running code no longer matches.
--
-- status_since is left untouched. This corrects a label, not a real transition, and the
-- SLA clock should keep counting from whenever the ticket actually reached PSP.

UPDATE tickets SET status = 'Pending PSP Approval' WHERE status = 'Pending Review - PSP';
