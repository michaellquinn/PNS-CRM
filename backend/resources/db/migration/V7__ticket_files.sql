-- Photos of the goods, and documents attached to a ticket.
--
-- The intake has asked for "cargo knowledge — attached picture" since the first draft,
-- and it was never built: the only attachment anywhere was a filename typed into a text
-- box. A photo of the actual pallet answers half the questions PNS would otherwise have
-- to ask, so it belongs on the ticket.
--
-- Bytes live in the database because this platform gives us OceanBase and nothing else —
-- there is no object store to point at. That is fine at this volume (a handful of photos
-- per ticket) but it is the reason for the hard size cap in the API: every upload has to
-- fit through a single MySQL-protocol packet. Images are downscaled in the browser
-- before they are sent, so a phone photo arrives as a few hundred KB rather than 5 MB.
--
-- MEDIUMBLOB tops out at 16 MB, comfortably above the 5 MB the API accepts.

CREATE TABLE ticket_files (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    ticket_id      BIGINT       NOT NULL,
    kind           VARCHAR(20)  NOT NULL DEFAULT 'document',   -- goods_photo | document
    filename       VARCHAR(255) NOT NULL,
    content_type   VARCHAR(120) NOT NULL,
    size_bytes     INT          NOT NULL,
    caption        VARCHAR(500) NULL,
    data           MEDIUMBLOB   NOT NULL,
    uploaded_email VARCHAR(255) NOT NULL,
    uploaded_name  VARCHAR(255) NOT NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_files_ticket (ticket_id, kind, created_at),
    CONSTRAINT fk_files_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;
