-- Ninja PNS — solutioning workflow schema.
-- Flyway migration, OceanBase / MySQL dialect. All DDL lives here, never in code.

-- ---------------------------------------------------------------- people
-- Identity comes from Google SSO (the platform injects x-forwarded-email).
-- This table answers the second question: what that person may do.
CREATE TABLE users (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    email       VARCHAR(255) NOT NULL,
    name        VARCHAR(255) NOT NULL,
    role_group  VARCHAR(20)  NOT NULL,                    -- Commercial|PNS|PSP|Legal|CSO|Admin
    role_level  VARCHAR(10)  NOT NULL DEFAULT 'staff',    -- staff|head
    team        VARCHAR(10)  NULL,                        -- Team1 (GJ/WJ) | Team2 (EJ/CJ)
    active      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- shippers
-- Account type lives on the shipper, not the ticket — changing it re-routes
-- every ticket for that shipper. Commercial Head only.
CREATE TABLE shippers (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    global_shipper_id VARCHAR(50)  NULL,
    name              VARCHAR(255) NOT NULL,
    acct_type         VARCHAR(20)  NOT NULL DEFAULT 'Non-Strategic',
    vertical          VARCHAR(80)  NULL,
    region            VARCHAR(10)  NULL,                  -- GJ|WJ|EJ|CJ
    status_changed_by VARCHAR(255) NULL,
    status_changed_at DATETIME     NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_shippers_name (name)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- tickets
CREATE TABLE tickets (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    ticket_ref    VARCHAR(20)  NOT NULL,                  -- SOF-1284
    request_type  VARCHAR(20)  NOT NULL DEFAULT 'solutioning',
    shipper_id    BIGINT       NOT NULL,
    service_type  VARCHAR(30)  NOT NULL,                  -- one service per ticket
    potential_rev BIGINT       NOT NULL DEFAULT 0,
    status        VARCHAR(50)  NOT NULL,
    resp          VARCHAR(10)  NOT NULL,                  -- Sales|PNS — who owes the price
    needs_review  TINYINT(1)   NOT NULL DEFAULT 0,
    below_bottom  TINYINT(1)   NOT NULL DEFAULT 0,
    sales_email   VARCHAR(255) NULL,
    sales_name    VARCHAR(255) NULL,
    owner_name    VARCHAR(255) NULL,                      -- assigned PNS member
    reviewer_name VARCHAR(255) NULL,
    region        VARCHAR(10)  NULL,
    submitted_on  DATE         NOT NULL,
    sla_days      INT          NOT NULL DEFAULT 7,
    status_since  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    outcome       VARCHAR(20)  NULL,                      -- accepted|lost|cancel
    loss_reason   VARCHAR(20)  NULL,                      -- pricing|shipper|solution|ops|no_vendor|billing|pns
    deleted_at    DATETIME     NULL,                      -- soft delete → recycle bin
    deleted_by    VARCHAR(255) NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_tickets_ref (ticket_ref),
    KEY idx_tickets_status (status),
    KEY idx_tickets_submitted (submitted_on),
    KEY idx_tickets_deleted (deleted_at),
    CONSTRAINT fk_tickets_shipper FOREIGN KEY (shipper_id) REFERENCES shippers (id)
) DEFAULT CHARSET=utf8mb4;

-- The intake payload. JSON because the field set is still settling — see
-- HANDOFF.md §13: statuses and form fields should become configuration.
CREATE TABLE ticket_input (
    ticket_id  BIGINT       NOT NULL,
    payload    JSON         NOT NULL,
    cleared_at DATETIME     NULL,                         -- ProCha is generated on clearing
    updated_by VARCHAR(255) NULL,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ticket_id),
    CONSTRAINT fk_input_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

-- price is visible to everyone; cost and margin only to PNS, PSP and CSO.
-- Separate columns, never a blended figure — the API filters them on read.
CREATE TABLE pricing (
    ticket_id     BIGINT        NOT NULL,
    is_standard   TINYINT(1)    NOT NULL DEFAULT 1,
    methodology   VARCHAR(40)   NULL,
    price_file    VARCHAR(255)  NULL,
    price_size    BIGINT        NULL,
    discount_pct  DECIMAL(5,2)  NULL,
    cost          DECIMAL(14,2) NULL,                     -- RESTRICTED
    margin_pct    DECIMAL(5,2)  NULL,                     -- RESTRICTED
    rate_card_ver VARCHAR(80)   NULL,
    priced_by     VARCHAR(255)  NULL,
    priced_at     DATETIME      NULL,
    PRIMARY KEY (ticket_id),
    CONSTRAINT fk_pricing_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE ticket_history (
    id        BIGINT       NOT NULL AUTO_INCREMENT,
    ticket_id BIGINT       NOT NULL,
    status    VARCHAR(50)  NOT NULL,
    actor     VARCHAR(255) NOT NULL,
    note      VARCHAR(500) NULL,
    at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_hist_ticket (ticket_id, at),
    CONSTRAINT fk_hist_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE approvals (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    ticket_id  BIGINT       NOT NULL,
    kind       VARCHAR(30)  NOT NULL,   -- head_ack|psp|max_rate|exception|shipper_status
    decision   VARCHAR(20)  NOT NULL,   -- approved|rejected
    actor      VARCHAR(255) NOT NULL,
    actor_role VARCHAR(30)  NOT NULL,
    note       VARCHAR(500) NULL,
    decided_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_appr_ticket (ticket_id),
    CONSTRAINT fk_appr_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- CAPA
-- Deliberately separate from solutioning: no pricing, no routing, no revenue.
CREATE TABLE capa (
    id              BIGINT       NOT NULL AUTO_INCREMENT,
    capa_ref        VARCHAR(20)  NOT NULL,
    shipper_name    VARCHAR(255) NOT NULL,
    services        VARCHAR(255) NOT NULL,                -- comma-separated, multi-select
    issue           TEXT         NOT NULL,
    trid_samples    VARCHAR(255) NULL,
    status          VARCHAR(30)  NOT NULL DEFAULT 'Pending PNS',
    assignee        VARCHAR(255) NULL,
    proposal        TEXT         NULL,
    raised_by       VARCHAR(255) NOT NULL,
    raised_by_email VARCHAR(255) NOT NULL,
    submitted_on    DATE         NOT NULL,
    closed_by       VARCHAR(255) NULL,
    closed_at       DATETIME     NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_capa_ref (capa_ref)
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- notifications
-- Each event carries an audience; a person sees it when their group, exact role
-- or name matches. Admin sees everything.
CREATE TABLE notifications (
    id         BIGINT       NOT NULL AUTO_INCREMENT,
    body       VARCHAR(500) NOT NULL,
    ticket_ref VARCHAR(20)  NULL,
    to_groups  VARCHAR(255) NULL,                         -- comma-separated
    to_roles   VARCHAR(255) NULL,
    to_people  VARCHAR(255) NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_notif_created (created_at)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE notification_reads (
    notification_id BIGINT       NOT NULL,
    user_email      VARCHAR(255) NOT NULL,
    read_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id, user_email),
    CONSTRAINT fk_read_notif FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------- audit
CREATE TABLE audit_log (
    id        BIGINT       NOT NULL AUTO_INCREMENT,
    actor     VARCHAR(255) NOT NULL,
    action    VARCHAR(60)  NOT NULL,
    entity    VARCHAR(40)  NOT NULL,
    entity_id VARCHAR(40)  NULL,
    field     VARCHAR(60)  NULL,
    old_value VARCHAR(500) NULL,
    new_value VARCHAR(500) NULL,
    at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_audit_entity (entity, entity_id)
) DEFAULT CHARSET=utf8mb4;
