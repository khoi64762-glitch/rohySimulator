-- 0038: the registration approval queue — the missing half of `approval` mode.
--
-- `approval` has been one of the four REGISTRATION_MODES since the policy landed:
-- an admin could select it in Platform → Users, and the public probe advertised
-- `approval_required: true`. But POST /auth/register had no branch for it. After
-- the `closed` and `invite` checks, an approval-mode signup fell straight through
-- to the plain-student INSERT and came back 201 with a token and auth cookies. An
-- admin who chose "anyone may request; an admin approves" got `open`: everybody in,
-- unreviewed, immediately. This migration is the storage that closes that gap.
--
-- WHY A TABLE AND NOT `users.status = 'pending'`:
--   users.status carries a CHECK constraint — CHECK(status IN ('active',
--   'inactive','suspended')) — and SQLite cannot ALTER a CHECK. Adding 'pending'
--   means rebuilding the users table: the most FK-referenced table in the schema,
--   for a feature that does not need a user row to exist. That is precisely the
--   kind of change MANIFEST.md calls destructive.
--
--   It is also the wrong shape. A pending applicant is NOT a user: they cannot log
--   in, hold no session, own nothing. Half a user in the users table is a row every
--   roster query, analytics sweep, auto-enrolment and CSV export would have to
--   remember to exclude — and each one that forgot would be a leak. Keeping the
--   applicant outside `users` until an admin says yes means "a row in users" keeps
--   meaning "someone who may sign in", which is an invariant worth protecting.
--
-- The password is hashed at REQUEST time, not at approval time: a plaintext
-- password must never rest in a table, not even briefly, and approving must not
-- require the admin to invent one. On approval the hash is moved into the new
-- users row as-is, so the applicant signs in with the password they chose.
--
-- Strictly additive: one new table. Behaviour is unchanged until an admin selects
-- `approval` mode.

CREATE TABLE IF NOT EXISTS registration_requests (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id     INTEGER NOT NULL DEFAULT 1,
    username      TEXT NOT NULL,
    name          TEXT,
    email         TEXT NOT NULL,
    password_hash TEXT NOT NULL,             -- hashed on request; moved to users on approval
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'approved', 'rejected')),
    requested_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address    TEXT,
    decided_at    DATETIME,
    decided_by    INTEGER REFERENCES users(id),
    decision_note TEXT,                      -- the admin's reason, shown to nobody but admins
    user_id       INTEGER REFERENCES users(id)   -- the account created on approval
);

-- One live request per username, and one per email. A partial index (live rows
-- only) is what lets a REJECTED applicant apply again later, while a second
-- simultaneous request for the same username is refused by the database rather
-- than by a check-then-insert race in the route.
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_requests_pending_username
    ON registration_requests(tenant_id, username) WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_requests_pending_email
    ON registration_requests(tenant_id, email) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_registration_requests_queue
    ON registration_requests(tenant_id, status, requested_at);
