-- Two things, both asked for on 2026-08-11.

-- 1. Discussion becomes threads instead of one flat list.
--
-- A ticket rarely has one open question; it has three or four, each needing a different
-- person, each closing at a different time. In one list they interleave and the only way
-- to know what is still open is to read the whole thing. A thread groups the posts that
-- are about the same point, so "still open" is a property of the point, not of the
-- ticket. thread_key NULL keeps every existing comment where it is: the general thread.
--
-- The title is denormalised onto each row rather than living in a threads table. There
-- is no independent life-cycle for a thread — it exists because someone posted in it and
-- dies with the ticket — so a table would only add a join and a way for the two to
-- disagree.
ALTER TABLE ticket_comments
    ADD COLUMN thread_key   VARCHAR(40)  NULL AFTER field_key,
    ADD COLUMN thread_title VARCHAR(200) NULL AFTER thread_key,
    ADD KEY idx_comment_thread (ticket_id, thread_key, resolved_at);

-- 2. The sales reporting line, so Sales can filter to their own people.
--
-- Until now a salesperson was a name on a ticket and nothing more, which meant a Sales
-- Manager had no way to ask "what is my team sitting on" — they had to know every name
-- and select them one at a time. These two columns are the line: who this person reports
-- to, and which Head that rolls up to. Both are emails pointing back at this table, and
-- both are nullable, because the tool has to keep working for the people whose line
-- nobody has filled in yet.
--
-- Not a foreign key on purpose: a manager can leave and be deactivated while their
-- reports are still on tickets, and a hard constraint would make that a data migration
-- rather than a Tuesday.
ALTER TABLE users
    ADD COLUMN manager_email VARCHAR(255) NULL AFTER team,
    ADD COLUMN head_email    VARCHAR(255) NULL AFTER manager_email,
    ADD KEY idx_users_manager (manager_email),
    ADD KEY idx_users_head (head_email);
