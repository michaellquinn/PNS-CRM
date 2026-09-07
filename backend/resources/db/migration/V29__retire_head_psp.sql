-- PSP now makes one shared team decision. The second Head PSP signature is retired.
--
-- Preserve work already in flight: a ticket at Head PSP has already been approved by
-- PSP staff, so its next real gate is Head PNS. Record that system move in the same
-- history people use to understand every other status change.
INSERT INTO ticket_history (ticket_id, status, actor, note)
SELECT id, 'Pending Review - Head PNS', 'system',
       'Head PSP gate retired; continued to Head PNS after the existing PSP approval'
FROM tickets
WHERE status = 'Pending Review - Head PSP';

UPDATE tickets
SET status = 'Pending Review - Head PNS', status_since = CURRENT_TIMESTAMP
WHERE status = 'Pending Review - Head PSP';

-- PSP has no Head-specific permission anymore. Keeping the level would advertise a
-- distinction the workflow no longer has; all PSP members retain the same PSP access.
UPDATE users
SET role_level = 'staff'
WHERE role_group = 'PSP' AND role_level <> 'staff';
