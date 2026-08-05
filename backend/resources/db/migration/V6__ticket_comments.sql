-- Questions and discussion on a ticket.
--
-- The intake form can never anticipate everything, so most tickets need a round of
-- "what did you mean by this" before anyone can price them. Until now that happened in
-- WhatsApp and never made it back to the ticket. This is the thread.
--
-- Open to every group on purpose: Commercial asks PNS to clarify a solution, PNS asks
-- Commercial to clarify a requirement, PSP asks why a margin looks the way it does,
-- Legal asks about a contract term. Nobody is read-only here.
--
-- is_question + resolved_at is the difference between a chat log and a blocker list: a
-- ticket with unanswered questions is visibly waiting on somebody.

CREATE TABLE ticket_comments (
    id           BIGINT       NOT NULL AUTO_INCREMENT,
    ticket_id    BIGINT       NOT NULL,
    author_email VARCHAR(255) NOT NULL,
    author_name  VARCHAR(255) NOT NULL,
    author_group VARCHAR(20)  NOT NULL,               -- shown as a pill in the thread
    body         TEXT         NOT NULL,
    is_question  TINYINT(1)   NOT NULL DEFAULT 0,
    mentions     VARCHAR(1000) NULL,                  -- comma-separated emails, resolved
    resolved_at  DATETIME     NULL,                   -- questions only
    resolved_by  VARCHAR(255) NULL,
    created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_comment_ticket (ticket_id, created_at),
    KEY idx_comment_open (ticket_id, is_question, resolved_at),
    CONSTRAINT fk_comment_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;
