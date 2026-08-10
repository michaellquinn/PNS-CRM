-- Who is allowed to reach PSP at all.
--
-- PSP does not review every thin margin. It reviews the ones Alex (CSalesO) has granted
-- an exception for. Strategic and Hypercare accounts carry that exception by virtue of
-- being managed, so they need no flag. Anything else reaches PSP only when Alex has said
-- so verbatim in a meeting, and only the PNS Head may record that.
--
-- The note is not optional in the API: an exception whose reason is not written down is
-- indistinguishable, three months later, from someone having clicked the wrong button.

ALTER TABLE tickets
    ADD COLUMN psp_allowed      TINYINT(1)   NOT NULL DEFAULT 0 AFTER psp_ready,
    ADD COLUMN psp_allowed_by   VARCHAR(255) NULL AFTER psp_allowed,
    ADD COLUMN psp_allowed_note VARCHAR(500) NULL AFTER psp_allowed_by,
    ADD COLUMN psp_allowed_at   DATETIME     NULL AFTER psp_allowed_note;
