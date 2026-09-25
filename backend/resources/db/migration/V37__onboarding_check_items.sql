-- Readiness is confirmed point by point, not card by card (Michael, 2026-09-25).
--
-- A team used to answer one question per card ("Pickup fleet readiness: ready?"), which
-- is the wrong grain: a fleet can have the truck and not the driver, and "not ready"
-- said nothing about which half. Each card now carries its own points, every point is
-- confirmed on its own, and a point the team cannot own is handed to another team with a
-- note -- it LEAVES their count and joins the other team's.
--
-- owner_group moves on a hand-off; origin_group remembers where it started, so the
-- history reads "Sort confirmed a point that began with 4W".
CREATE TABLE onboarding_check_items (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 ticket_id BIGINT NOT NULL,
 check_key VARCHAR(80) NOT NULL,
 item_key VARCHAR(80) NOT NULL,
 label VARCHAR(255) NOT NULL,
 owner_group VARCHAR(40) NOT NULL,
 origin_group VARCHAR(40) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending',
 note TEXT NULL,
 moved_note TEXT NULL,
 confirmed_by VARCHAR(120) NULL,
 confirmed_name VARCHAR(120) NULL,
 confirmed_at DATETIME NULL,
 fingerprint VARCHAR(64) NOT NULL,
 revision INT NOT NULL,
 UNIQUE KEY uq_onboarding_item(ticket_id, check_key, item_key),
 KEY idx_onboarding_item_owner(ticket_id, owner_group),
 CONSTRAINT fk_item_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;
