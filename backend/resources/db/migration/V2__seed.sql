-- Trial seed data. Safe to delete once real data is loaded.
-- Emails are placeholders — replace with real @ninjavan.co addresses before SSO goes on.

INSERT INTO users (email, name, role_group, role_level, team) VALUES
  ('dewi.anggraini@ninjavan.co',  'Dewi Anggraini', 'Commercial', 'head',  'Team1'),
  ('arif.pratama@ninjavan.co',    'Arif Pratama',   'Commercial', 'staff', 'Team1'),
  ('dimas.nugroho@ninjavan.co',   'Dimas Nugroho',  'Commercial', 'staff', 'Team1'),
  ('nadia.kusuma@ninjavan.co',    'Nadia Kusuma',   'Commercial', 'staff', 'Team2'),
  ('baskoro@ninjavan.co',         'Baskoro',        'PNS',        'head',  NULL),
  ('quinn@ninjavan.co',           'Quinn',          'PNS',        'staff', NULL),
  ('annisa@ninjavan.co',          'Annisa',         'PNS',        'staff', NULL),
  ('adilla@ninjavan.co',          'Adilla',         'PNS',        'staff', NULL),
  ('ramdhani@ninjavan.co',        'Ramdhani',       'PNS',        'staff', NULL),
  ('niko@ninjavan.co',            'Niko',           'PNS',        'staff', NULL),
  ('psp@ninjavan.co',             'PSP desk',       'PSP',        'staff', NULL),
  ('legal@ninjavan.co',           'Legal',          'Legal',      'staff', NULL),
  ('alex@ninjavan.co',            'Alex',           'CSO',        'head',  NULL),
  ('pns.admin@ninjavan.co',       'PNS Admin',      'Admin',      'head',  NULL);

INSERT INTO shippers (name, acct_type, vertical, region) VALUES
  ('PT Sinar Kencana Utama',   'Non-Strategic', 'B2B LTL Freight', 'GJ'),
  ('Berkah Sentosa Distribusi','Non-Strategic', 'B2B Regular',     'WJ'),
  ('PT Anugerah Kimia Raya',   'Strategic',     'B2B FTL',         'GJ'),
  ('Toko Mandiri Grosir',      'Non-Strategic', 'B2B Regular',     'WJ'),
  ('CV Karya Plastindo',       'Non-Strategic', 'B2B LTL Freight', 'GJ'),
  ('PT Cahaya Elektronik',     'Non-Strategic', 'Sameday',         'WJ'),
  ('Sumber Rejeki Niaga',      'Non-Strategic', 'B2C',             'GJ'),
  ('PT Global Tekstil Jaya',   'Non-Strategic', 'B2B FTL',         'WJ'),
  ('PT Harum Boga Nusantara',  'Non-Strategic', 'B2B Regular',     'GJ'),
  ('CV Lestari Agro',          'Non-Strategic', 'B2B FTL',         'EJ');

INSERT INTO tickets
  (ticket_ref, shipper_id, service_type, potential_rev, status, resp, needs_review,
   sales_email, sales_name, owner_name, reviewer_name, region, submitted_on)
VALUES
  ('SOF-1284', 1, 'LTL',         48000000,  'Pending Sales',        'Sales', 1,
   'arif.pratama@ninjavan.co',  'Arif Pratama',  NULL,       NULL, 'GJ', '2026-07-14'),
  ('SOF-1279', 2, 'B2BR',        18500000,  'Pending Sales',        'Sales', 0,
   'dimas.nugroho@ninjavan.co', 'Dimas Nugroho', NULL,       NULL, 'WJ', '2026-07-09'),
  ('SOF-1240', 3, 'FTL monthly', 124000000, 'Pending PNS',          'PNS',   0,
   'arif.pratama@ninjavan.co',  'Arif Pratama',  'Annisa',   NULL, 'GJ', '2026-06-18'),
  ('SOF-1266', 4, 'B2BR',        9200000,   'Proposal Submitted',   'Sales', 0,
   'dimas.nugroho@ninjavan.co', 'Dimas Nugroho', 'Adilla',   NULL, 'WJ', '2026-07-21'),
  ('SOF-1251', 5, 'LTL',         33000000,  'Pending Vendor',       'Sales', 1,
   'nadia.kusuma@ninjavan.co',  'Nadia Kusuma',  'Ramdhani', NULL, 'GJ', '2026-07-11'),
  ('SOF-1233', 6, 'Sameday',     27400000,  'Pending PNS',          'PNS',   0,
   'nadia.kusuma@ninjavan.co',  'Nadia Kusuma',  'Niko',     NULL, 'WJ', '2026-07-23'),
  ('SOF-1218', 7, 'B2C',         11800000,  'Proposal Accepted / Ready to Ship', 'Sales', 0,
   'arif.pratama@ninjavan.co',  'Arif Pratama',  'Adilla',   NULL, 'GJ', '2026-05-27'),
  ('SOF-1204', 8, 'FTL on-call', 41000000,  'Lost',                 'Sales', 1,
   'dimas.nugroho@ninjavan.co', 'Dimas Nugroho', 'Ramdhani', NULL, 'WJ', '2026-04-15'),
  ('SOF-1290', 9, 'B2BR',        26000000,  'Pending PSP Approval', 'Sales', 0,
   'arif.pratama@ninjavan.co',  'Arif Pratama',  'Quinn',    NULL, 'GJ', '2026-07-24'),
  ('SOF-1295', 10,'FTL on-call', 52000000,  'Pending PNS Review',   'Sales', 1,
   'nadia.kusuma@ninjavan.co',  'Nadia Kusuma',  NULL,       NULL, 'EJ', '2026-07-25');

UPDATE tickets SET outcome='accepted' WHERE ticket_ref='SOF-1218';
UPDATE tickets SET outcome='lost', loss_reason='pricing' WHERE ticket_ref='SOF-1204';

INSERT INTO pricing (ticket_id, price_file, price_size, margin_pct, priced_by) VALUES
  (4,  'rate-toko-mandiri.xlsx',     31200, 14.00, 'Dimas Nugroho'),
  (7,  'rate-sumber-rejeki.xlsx',    28800, 12.80, 'Arif Pratama'),
  (9,  'rate-harum-boga.xlsx',       44100,  8.40, 'Arif Pratama'),
  (10, 'rate-lestari-agro-v1.xlsx',  38400, 11.20, 'Nadia Kusuma');

INSERT INTO capa
  (capa_ref, shipper_name, services, issue, trid_samples, status, assignee,
   proposal, raised_by, raised_by_email, submitted_on)
VALUES
  ('CAPA-041', 'PT Sinar Kencana Utama', 'LTL > 50kg',
   'Repeated late pickup at Sidoarjo origin, 6 occurrences in June.',
   'TRID-88213, TRID-88407', 'Pending PNS', 'Annisa', NULL,
   'Arif Pratama', 'arif.pratama@ninjavan.co', '2026-07-08'),
  ('CAPA-042', 'Toko Mandiri Grosir', 'B2BR (<50kg),Same Day - Regular',
   'Parcels arriving damaged — packaging insufficient for glassware.',
   'TRID-90112', 'Submitted', 'Adilla',
   'Move to double-wall carton with bubble wrap at origin; TKBM briefed. Re-measure damage rate after 30 days.',
   'Dimas Nugroho', 'dimas.nugroho@ninjavan.co', '2026-07-15'),
  ('CAPA-039', 'Sumber Rejeki Niaga', 'FTL',
   'Driver did not follow the agreed unloading window at DC.',
   NULL, 'CAPA Closed', 'Ramdhani',
   'Driver re-briefed, DC window added to trip sheet. Verified over 3 weeks, no recurrence.',
   'Nadia Kusuma', 'nadia.kusuma@ninjavan.co', '2026-06-21');
