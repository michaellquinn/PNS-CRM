-- Two additions from the 2026-08-13 process review.
--
-- 1. PSP gains a head, and the below-floor path gains a step.
--
--    A below-floor price on a watched account now runs PSP -> Head of PSP -> Head of PNS
--    -> Head of Sales -> C-level. PSP staff form the opinion; the Head of PSP owns it.
--    That is a second signature inside PSP, not a replacement for the first, so it needs
--    its own status: "Pending Review - Head PSP". Nothing needs to move, because no
--    ticket has ever held it.
--
-- 2. A sync whitelist, so test and junk opportunities stop arriving.
--
--    "Test Ninja Biz - 1" has come through every import since the first one and been
--    manually ignored every time. An id listed here is skipped by the sync with a stated
--    reason, which is different from being silently dropped — the skip still appears in
--    the run's report so nobody wonders where a deal went.
CREATE TABLE salescrm_ignored (
    opportunity_id VARCHAR(40)  NOT NULL,
    reason         VARCHAR(255) NULL,
    added_by       VARCHAR(255) NOT NULL,
    added_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (opportunity_id)
) DEFAULT CHARSET=utf8mb4;
