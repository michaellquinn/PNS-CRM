-- Per-person email opt-out.
--
-- Mail only goes out for things aimed at one person — you were assigned, tagged, asked a
-- question, sent a price back. Broadcast notifications stay in-app only. Even so, some
-- people will want it off, and someone who cannot turn it off just makes a filter rule
-- and then misses the ones that mattered.
--
-- Default 0: opted IN, because the whole point is to reach people who are not sitting in
-- the app all day.

ALTER TABLE users ADD COLUMN email_optout TINYINT(1) NOT NULL DEFAULT 0;
