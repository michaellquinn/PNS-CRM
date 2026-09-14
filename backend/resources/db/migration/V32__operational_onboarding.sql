-- Separate operational intake and history; no commercial input/status mutations.
CREATE TABLE onboarding_intake (
 ticket_id BIGINT NOT NULL PRIMARY KEY, payload JSON NOT NULL,
 released_payload JSON NULL, revision INT NOT NULL DEFAULT 0,
 submitted_at DATETIME NULL, submitted_by VARCHAR(120) NULL,
 actual_golive DATE NULL, actual_by VARCHAR(120) NULL, actual_at DATETIME NULL,
 qc_accepted_by VARCHAR(120) NULL, qc_accepted_at DATETIME NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_intake_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id)
) DEFAULT CHARSET=utf8mb4;
CREATE TABLE onboarding_checks (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, ticket_id BIGINT NOT NULL,
 check_key VARCHAR(80) NOT NULL, label VARCHAR(160) NOT NULL,
 owner_group VARCHAR(40) NOT NULL, fingerprint VARCHAR(64) NOT NULL,
 revision INT NOT NULL, status VARCHAR(24) NOT NULL DEFAULT 'pending', note TEXT NULL,
 confirmed_by VARCHAR(120) NULL, confirmed_name VARCHAR(120) NULL, confirmed_at DATETIME NULL,
 exception_reason TEXT NULL, workaround TEXT NULL, feasible_by VARCHAR(120) NULL,
 feasible_at DATETIME NULL, approved_by VARCHAR(120) NULL, approved_at DATETIME NULL,
 UNIQUE KEY uq_onboarding_check(ticket_id,check_key),
 CONSTRAINT fk_check_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id)
) DEFAULT CHARSET=utf8mb4;
CREATE TABLE onboarding_events (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, ticket_id BIGINT NOT NULL,
 actor VARCHAR(120) NOT NULL, body TEXT NOT NULL, at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_onboarding_event(ticket_id),
 CONSTRAINT fk_event_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id)
) DEFAULT CHARSET=utf8mb4;
CREATE TABLE onboarding_documents (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, ticket_id BIGINT NOT NULL,
 kind VARCHAR(40) NOT NULL, filename VARCHAR(255) NOT NULL, content_type VARCHAR(120) NOT NULL,
 data LONGBLOB NOT NULL, uploaded_by VARCHAR(120) NOT NULL,
 at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_onboarding_document(ticket_id),
 CONSTRAINT fk_document_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id)
) DEFAULT CHARSET=utf8mb4;
CREATE TABLE operational_master (
 ticket_id BIGINT NOT NULL PRIMARY KEY, global_id VARCHAR(64) NOT NULL,
 opportunity_name VARCHAR(500) NOT NULL, service VARCHAR(40) NOT NULL,
 pickup_function VARCHAR(40) NOT NULL, delivery_function VARCHAR(40) NOT NULL,
 source VARCHAR(40) NOT NULL, updated_by VARCHAR(120) NOT NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_master_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id)
) DEFAULT CHARSET=utf8mb4;
