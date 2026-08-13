-- Discussion posts become editable and deletable by their author.
--
-- edited_at is shown next to the post rather than kept quiet: a thread is a record of
-- what was agreed, and a message that changed after people replied to it is a different
-- thing from one that did not. Nobody needs the old text — they need to know it moved.
--
-- Deletion is a real delete, not a tombstone. A tombstone in a discussion ("message
-- removed") is noise that never goes away, and the audit log already records who
-- deleted what and when, which is where that question actually gets answered.
ALTER TABLE ticket_comments
    ADD COLUMN edited_at DATETIME NULL AFTER created_at;
