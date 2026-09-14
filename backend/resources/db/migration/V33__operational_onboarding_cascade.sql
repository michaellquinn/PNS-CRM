-- Preserve the existing Admin recycle-bin purge contract. No data is deleted
-- by this migration; dependent operational records cascade only on ticket purge.
ALTER TABLE onboarding_intake DROP FOREIGN KEY fk_intake_ticket;
ALTER TABLE onboarding_intake ADD CONSTRAINT fk_intake_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE onboarding_checks DROP FOREIGN KEY fk_check_ticket;
ALTER TABLE onboarding_checks ADD CONSTRAINT fk_check_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE onboarding_events DROP FOREIGN KEY fk_event_ticket;
ALTER TABLE onboarding_events ADD CONSTRAINT fk_event_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE onboarding_documents DROP FOREIGN KEY fk_document_ticket;
ALTER TABLE onboarding_documents ADD CONSTRAINT fk_document_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
ALTER TABLE operational_master DROP FOREIGN KEY fk_master_ticket;
ALTER TABLE operational_master ADD CONSTRAINT fk_master_ticket FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE;
