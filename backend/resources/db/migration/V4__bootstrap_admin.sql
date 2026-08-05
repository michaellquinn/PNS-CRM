-- Bootstrap the first real account.
--
-- With Google SSO on, the auth proxy tells the app who is knocking, but the app still
-- refuses anyone who has no row here ("no role assigned"). That is a chicken-and-egg
-- problem for the very first administrator: nobody can grant a role until somebody has
-- one. This migration grants it.
--
-- Every account after this one is registered through the app itself (Administration →
-- Users), so this file should stay a single row.
--
-- Admin is a superset of PNS in can(), so this account both administers users and works
-- solutioning tickets. It is also included in the PNS assignee list, so tickets and CAPA
-- can be assigned to it.

INSERT INTO users (email, name, role_group, role_level, team, active)
VALUES ('michael.quinnfarand@ninjavan.co', 'Michael Quinnfarand', 'Admin', 'head', NULL, 1)
ON DUPLICATE KEY UPDATE role_group='Admin', role_level='head', active=1;
