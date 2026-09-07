-- The onboarding phase (Baskoro, 2026-09-07).
--
-- Highest migration before this was V27. Two people deploy into this database from
-- separate clones, so check the highest V*.sql before adding another -- Flyway will not
-- warn about a collision, it will just behave unpredictably, and that has now happened
-- three times on this repo. V27 was taken five days ago while this was being designed.
--
-- Solutioning ends when the shipper accepts. Onboarding begins there and asks a
-- different question -- can Ops actually take this on, and is QC ready to inherit it.
--
-- These are TABLES, not statuses. TRANSITIONS in main.py is the one status map and it
-- governs the pricing approval chain; putting QC and Ops states into it would mean the
-- map deciding who signs off a below-floor Hypercare deal also decides whether QC has
-- taken a shipper over. Two different questions. The ticket stays at
-- 'Proposal Accepted / Ready to Ship' throughout, and onboarding runs beside it, free to
-- slip, restart or fail without the ticket lying about itself.

-- One onboarding per ticket, because one ticket is one shipper ID (Baskoro, 2026-09-07,
-- reversing his own earlier answer in the same conversation). A corporate going live as
-- several branch shippers is several tickets, not one ticket with several onboardings --
-- and since tickets are keyed to Sales CRM opportunities, that means several
-- opportunities. parentShipperId and branchId stay on the intake as descriptive context,
-- so the relationship is still visible; it is the SPLITTING that becomes Sales' job.
CREATE TABLE onboarding (
    id                BIGINT       NOT NULL AUTO_INCREMENT,
    ticket_id         BIGINT       NOT NULL,
    -- Denormalised from the intake payload deliberately. The intake is editable and this
    -- is the identity the pickup, the monitoring and QC's own system all key on: it must
    -- read the same next year as it did the day onboarding started.
    shipper_id        VARCHAR(64)  NOT NULL,
    target_golive     DATE         NOT NULL,
    -- When the shipper ACTUALLY started shipping, which is a different fact from the
    -- date Sales promised. The gray-period clock runs from this and only this: a target
    -- that passed proves nothing, and starting the clock on it would hand QC a shipper
    -- that never shipped.
    actual_golive     DATE         NULL,
    -- Which of the two doors it came through: 'sales' (Sales confirmed first shipment)
    -- or 'qc_ack' (the target passed untouched and QC acknowledged it). Recorded because
    -- a QC-acknowledged date is an inference and a Sales-confirmed one is a report, and
    -- reading them as the same thing is how a "live" shipper turns out not to be.
    golive_source     VARCHAR(16)  NULL,
    golive_by         VARCHAR(120) NULL,
    golive_at         DATETIME     NULL,
    -- The two general readiness ticks, taken before go-live. Ops and QC each say "we are
    -- ready for this one". Missing ticks at the target date are flagged loudly and block
    -- nothing (Baskoro): the shipper ships whether or not a tick exists, and blocking
    -- would only make the record lie about what happened.
    ops_ready_at      DATETIME     NULL,
    ops_ready_by      VARCHAR(120) NULL,
    qc_ready_at       DATETIME     NULL,
    qc_ready_by       VARCHAR(120) NULL,
    -- Only the ENDINGS THAT NEED SAYING. 'did_not_start' and 'cancelled' are decisions
    -- somebody made. The ordinary ending -- ran its gray week and became QC's -- is NOT
    -- stored: it is derived from actual_golive + 7 days, every time it is read.
    --
    -- That is not tidiness. This app serves from MORE THAN ONE REPLICA (confirmed
    -- 2026-08-28), so a phase written into a row by whichever pod noticed first is a
    -- fact that can be wrong, late, or written twice. A phase computed from two dates is
    -- the same answer on every pod forever, and needs no scheduler to stay true.
    outcome           VARCHAR(24)  NULL,
    outcome_note      VARCHAR(500) NULL,
    outcome_at        DATETIME     NULL,
    outcome_by        VARCHAR(120) NULL,
    started_by        VARCHAR(120) NOT NULL,
    started_by_name   VARCHAR(120) NULL,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- One per ticket. The shipper ID is deliberately NOT unique: the same shipper can be
    -- onboarded again on a later deal, which PNS must authorise explicitly -- see the
    -- duplicate check in start_onboarding. A UNIQUE key here would refuse it outright
    -- and leave no way to say yes.
    UNIQUE KEY uq_onboarding_ticket (ticket_id),
    KEY idx_onboarding_shipper (shipper_id),
    KEY idx_onboarding_target (target_golive),
    CONSTRAINT fk_onboarding_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

-- The OPV2 identifiers, which arrive after the trigger and go on arriving. Sales fill
-- them in as they get confirmation, so this is a list that grows, not a field that is
-- filled once -- which is exactly why it is a table and not four more keys in the intake
-- JSON blob. Each row carries who added it and when, so an id that turns out to be wrong
-- has a name against it instead of appearing by magic.
--
-- Sales CRM has NONE of these. It holds reservation_person_lookup -- the PIC -- and no
-- reservation, MPS or tracking id anywhere. They are OPV2 artifacts and this is the only
-- place they are written down.
CREATE TABLE onboarding_ids (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    onboarding_id BIGINT       NOT NULL,
    -- 'reservation' (OPV2 pickup, all numeric), 'mps' or 'tracking'. Sales say which
    -- before pasting: MPS and tracking ids are both "a monitoring id" to look at and
    -- mean different things to the people monitoring them.
    kind          VARCHAR(16)  NOT NULL,
    value         VARCHAR(64)  NOT NULL,
    note          VARCHAR(255) NULL,
    added_by      VARCHAR(120) NOT NULL,
    added_by_name VARCHAR(120) NULL,
    added_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    -- Pasting the same list twice is one list, not two. Sales will paste from a sheet
    -- and re-paste it when they add three more to the bottom.
    UNIQUE KEY uq_onboarding_id_value (onboarding_id, kind, value),
    KEY idx_onboarding_ids_value (value),
    CONSTRAINT fk_onboarding_ids FOREIGN KEY (onboarding_id)
        REFERENCES onboarding (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

-- What is far from standard about this deal, per operational area, raised by PNS only.
--
-- On the TICKET rather than the onboarding, because it is a fact about the solution --
-- true from the moment PNS designs it, before anybody sets a go-live date. It surfaces
-- in two places from this one table: as sections in the Operations tab on the ticket,
-- and as the acknowledgements owed on the onboarding record. Written once, read in both.
--
-- Ops are NOT asked to tick a box on every standard shipper. No requirement raised for
-- their area means nothing is owed -- they are pulled in only when something needs them
-- (Baskoro, 2026-09-07).
CREATE TABLE ticket_requirements (
    id            BIGINT       NOT NULL AUTO_INCREMENT,
    ticket_id     BIGINT       NOT NULL,
    -- rdo | fm | mmsort | lm | claims | parcels. The area decides WHO acknowledges:
    -- claims is QC's, the other five are Ops'. See REQ_AREAS in main.py, which is the
    -- one definition -- the labels and the routing are generated from it.
    area          VARCHAR(24)  NOT NULL,
    body          TEXT         NOT NULL,
    raised_by     VARCHAR(120) NOT NULL,
    raised_by_name VARCHAR(120) NULL,
    raised_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Acknowledged by the team the area routes to, against THIS requirement -- not a
    -- general "seen it". A name and a timestamp against a specific instruction is the
    -- part that makes the handover real.
    acked_at      DATETIME     NULL,
    acked_by      VARCHAR(120) NULL,
    acked_by_name VARCHAR(120) NULL,
    PRIMARY KEY (id),
    KEY idx_req_ticket (ticket_id, area),
    CONSTRAINT fk_req_ticket FOREIGN KEY (ticket_id)
        REFERENCES tickets (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;
