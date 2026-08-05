-- Attach the price as a link, not just a filename.
--
-- There is no file storage behind this app, so `price_file` was only ever a label —
-- someone typed "rate-shipper.xlsx" and nobody else could open it. Ninja runs on Google
-- Workspace, so the working artefact is a Sheets or Drive URL. This adds a real place to
-- put it; price_file stays as the human label shown next to the link.
--
-- 1000 chars because Drive and Sheets URLs carry long ids and query strings.

ALTER TABLE pricing ADD COLUMN price_url VARCHAR(1000) NULL;
