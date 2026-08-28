-- Baskoro, 2026-08-28. Three things, one migration, because they ship together.
--
-- V25 was the highest before this. Two people deploy into this database from separate
-- clones, so check the highest V*.sql before adding another -- Flyway will not warn
-- about a collision, it will just behave unpredictably, and that has happened three
-- times on this repo already.

-- 1. The import queue. Sales submit the Sales CRM opportunity ids they want worked,
--    in bulk, and the automatic sync imports THOSE and nothing else. Before this the
--    sweep imported every opportunity it could map from the last two days, so the board
--    filled with deals nobody had asked PNS to look at and the real work was buried.
--
--    This governs IMPORTS ONLY. Tickets already held are still refreshed on every run
--    whatever is in here (Baskoro, asked and answered) -- a deal that is on the board
--    must keep learning that it was won, lost or repriced in Sales CRM, and stopping
--    that to honour a queue would trade one kind of staleness for a worse one.
CREATE TABLE sync_queue (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    opportunity_id VARCHAR(40)  NOT NULL,
    -- Who asked for it and why, so a queue entry that turns out to be wrong has a name
    -- against it rather than appearing by magic.
    added_by       VARCHAR(120) NOT NULL,
    added_by_name  VARCHAR(120) NULL,
    note           VARCHAR(255) NULL,
    -- pending -> imported | failed | skipped. Kept after the import rather than deleted:
    -- "did my request go through?" is the question Sales will actually ask, and a row
    -- that vanishes on success cannot answer it.
    state          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    -- Why it is not pending any more. The sync's own words, so the reason Sales reads
    -- here is the reason the sweep recorded.
    detail         VARCHAR(500) NULL,
    ticket_ref     VARCHAR(20)  NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at    DATETIME     NULL,
    PRIMARY KEY (id),
    -- One row per opportunity. Two salespeople asking for the same deal is one request,
    -- not two, and without this the sweep would import it once and leave the second row
    -- pending forever.
    UNIQUE KEY uq_sync_queue_opp (opportunity_id),
    KEY idx_sync_queue_state (state, created_at)
) DEFAULT CHARSET=utf8mb4;

-- 2. Settings the owner can change without a deploy.
--
--    These were env vars read once at import into module globals. That is wrong here for
--    a reason that is not obvious: this app serves from MORE THAN ONE REPLICA (confirmed
--    2026-08-28 -- two consecutive reads of /api/sync/auto returned different run
--    counters). A module global is per-pod, so changing one in the portal needs a
--    restart of every replica, and a value set at runtime would apply to whichever pod
--    happened to serve the request. In the database it is one answer for the fleet.
--
--    Values are stored as text and parsed on read. A settings table with a column per
--    setting needs a migration every time a setting is added, on a shared database, from
--    two clones -- which is the cost this table exists to avoid.
CREATE TABLE app_settings (
    name       VARCHAR(64)  NOT NULL,
    value      VARCHAR(500) NULL,
    updated_by VARCHAR(120) NULL,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (name)
) DEFAULT CHARSET=utf8mb4;

-- Seeded to today's env-var defaults so behaviour does not change on deploy. An absent
-- row means "use the env var", so this is belt and braces rather than load-bearing.
INSERT INTO app_settings (name, value, updated_by) VALUES
    ('sync.auto_enabled',    '1',          'V26 default'),
    ('sync.every_minutes',   '5',          'V26 default'),
    ('sync.days',            '2',          'V26 default'),
    ('sync.min_date',        '2026-08-01', 'V26 default'),
    ('sync.queue_only',      '0',          'V26 default'),
    ('sync.watched_only',    '0',          'V26 default');

-- 3. Which discussion thread a notification is about.
--
--    Notifications already carry ticket_ref, so clicking one could always have opened
--    the ticket. Being tagged in a THREAD and landing on the ticket with no idea which
--    of eight threads wanted you is the actual complaint, and the thread was never
--    recorded. NULL means the ticket as a whole, which is every notification raised
--    before this and most of them after.
ALTER TABLE notifications
    ADD COLUMN thread_key VARCHAR(40) NULL AFTER ticket_ref;
