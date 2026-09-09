-- The sync rules, as Baskoro set them on 2026-09-09.
--
-- Highest migration before this was V29. Two people deploy into this database from
-- separate clones, so check the highest V*.sql before adding another -- Flyway will not
-- warn about a collision, it will just behave unpredictably, and that has happened on
-- this repo four times now.
--
-- This migration exists ONLY because these rows already exist. V26 seeded them, and
-- SETTING_DEFAULTS in main.py is consulted only when a row is ABSENT -- so changing the
-- default there does nothing at all to a database that already has an answer. Without
-- this file the new behaviour would be live on a fresh database and silently absent on
-- the one that matters.

-- 1. The queue governs imports.
--
--    Sales queue the opportunity ids they want PNS to work, and the sweep imports those
--    and nothing else. Discovering deals on its own is now the admin's deliberate full
--    import, not something the five-minute timer does.
--
--    This has been the intended shape since V26 and was left off so that deploy changed
--    nothing. It is on now.
UPDATE app_settings SET value = '1', updated_by = 'V30'
 WHERE name = 'sync.queue_only';

-- 2. No import floor.
--
--    The floor existed to stop a date-window sweep dragging in years of history nobody
--    had asked for. With the queue governing imports the sweep is not guessing any more:
--    every ticket it creates was explicitly asked for, and a date test on top of an
--    explicit request is just a second place a deal can quietly fail to arrive.
--
--    Queued and explicitly named ids ALREADY bypassed this floor (see `over_floor` in
--    sync_salescrm), so for the queue path this changes nothing -- it removes the floor
--    from the admin's full import, which is the run that needs to reach old deals.
UPDATE app_settings SET value = '', updated_by = 'V30'
 WHERE name = 'sync.min_date';

-- 3. Out-of-scope product lines become admin toggles.
--
--    Cold chain, cross-border and air freight are lines PNS does not price. That is a
--    SCOPE decision, not a fact about the data, and it was hard-coded in PRODUCT_SKIP --
--    so covering cold chain one day meant editing Python and redeploying.
--
--    Seeded OFF, which is exactly today's behaviour: all three stay excluded until an
--    administrator switches one on. Keyed by scope rather than by spelling, so
--    "Cold Chain" and "Cold-chain" cannot end up half-enabled.
--
--    INSERT IGNORE, not INSERT: this migration must be safe to land on a database where
--    somebody has already written these rows through the settings screen.
INSERT IGNORE INTO app_settings (name, value, updated_by) VALUES
    ('sync.scope.cold_chain',   '0', 'V30 default'),
    ('sync.scope.cross_border', '0', 'V30 default'),
    ('sync.scope.air_freight',  '0', 'V30 default');

-- 4. How far the last full import reached.
--
--    The sweep's own bookmark, not a preference -- deliberately absent from
--    SETTING_RULES so it cannot be set through the settings API. A full import walks
--    pages from here, stops when the run's time budget is spent, and writes back where
--    it got to; the next press carries on rather than re-reading the same pages. 0 means
--    "start from the newest", and the run resets it to 0 when it reaches the end of the
--    book.
--
--    A DRY RUN never moves it. Previewing a full import must not cause the real one to
--    skip the stretch it previewed.
INSERT IGNORE INTO app_settings (name, value, updated_by) VALUES
    ('sync.full_cursor', '0', 'V30 default');
