-- The provisional "FTL" service line is retired (Michael, 2026-10-22). A truck deal is
-- FTL on-call or FTL monthly; Sales CRM cannot say which, so FTL deals are no longer
-- imported and Sales raise them on the right line. The tickets still on "FTL" move to
-- FTL monthly, which keeps them with PNS exactly as "FTL" did; PNS switches the on-call
-- ones on the Input tab. Each one says so in its history.
INSERT INTO ticket_history (ticket_id, status, actor, note)
SELECT id, status, 'System',
       'FTL line retired (2026-10-22): moved to FTL monthly. If this deal is on-call, set FTL on-call on the Input tab.'
FROM tickets WHERE service_type = 'FTL';
UPDATE tickets SET service_type = 'FTL monthly' WHERE service_type = 'FTL';
UPDATE operational_master SET service = 'FTL monthly' WHERE service = 'FTL';
