-- Attachments and a reference link on a CAPA.
--
-- A corrective action is usually reported with evidence — a photo of the damaged carton,
-- a screenshot of the tracking page, a link to the shipper's complaint thread. Without
-- somewhere to put it that evidence stayed in WhatsApp and the CAPA record was just an
-- assertion.
--
-- Deliberately a separate table from ticket_files rather than a generalised one: both
-- keep a real foreign key, so deleting the parent still takes its attachments with it.
-- The alternative — one polymorphic table with entity/entity_id — buys a little less
-- duplication and loses referential integrity, which is the wrong trade here.

ALTER TABLE capa ADD COLUMN link_url VARCHAR(1000) NULL;

CREATE TABLE capa_files (
    id             BIGINT       NOT NULL AUTO_INCREMENT,
    capa_id        BIGINT       NOT NULL,
    kind           VARCHAR(20)  NOT NULL DEFAULT 'document',   -- evidence | document
    filename       VARCHAR(255) NOT NULL,
    content_type   VARCHAR(120) NOT NULL,
    size_bytes     INT          NOT NULL,
    caption        VARCHAR(500) NULL,
    data           MEDIUMBLOB   NOT NULL,
    uploaded_email VARCHAR(255) NOT NULL,
    uploaded_name  VARCHAR(255) NOT NULL,
    created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_capafiles_capa (capa_id, created_at),
    CONSTRAINT fk_capafiles_capa FOREIGN KEY (capa_id) REFERENCES capa (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;
