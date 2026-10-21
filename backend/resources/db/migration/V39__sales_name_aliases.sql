-- Salespeople whose tickets carry a short or alternative name (Michael, 2026-10-21).
-- Users were renamed to their full Sales CRM names so a deal links to its salesperson;
-- these tickets still carried the old form. Sandrina's were raised by hand before the
-- rename; "Ari" (Bayu) and "Kelvin" are how Sales CRM itself names the owner on two
-- deals. The sync translates those two from now on (SALES_NAME_ALIASES in main.py).
-- A no-op on any database that holds none of them.
UPDATE tickets SET sales_name = 'Sandrina Oktiana' WHERE sales_name = 'Sandrina';
UPDATE tickets SET sales_name = 'Bayu Bakhriansyah Bachruddin' WHERE sales_name = 'Ari';
UPDATE tickets SET sales_name = 'Kelvin Sitinjak' WHERE sales_name = 'Kelvin';
