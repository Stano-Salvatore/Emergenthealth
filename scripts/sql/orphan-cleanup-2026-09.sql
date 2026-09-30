-- One-off: rows left behind by accounts deleted before 3.7.0.
--
-- These six tables carry a userId with no foreign key to "User", so deleting
-- a user never reached them. 3.7.0's account deletion removes them by hand;
-- this clears what earlier deletions left. HabitSkip, HabitCompletion and
-- ExperimentDay also lack a user key but cascade from their parent row, so
-- they cannot be orphaned this way.
--
-- Run in the Neon SQL editor. Step 1 only reads. Step 2 deletes, inside a
-- transaction, and prints the counts again before COMMIT — if they don't
-- match step 1, ROLLBACK instead.

-- ── Step 1: how many orphans each table holds ──
SELECT 'BodyMeasurementLog' AS "table", count(*) FROM "BodyMeasurementLog" WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'PushSubscription',     count(*) FROM "PushSubscription"     WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'TagAlias',             count(*) FROM "TagAlias"             WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'GocardlessConnection', count(*) FROM "GocardlessConnection" WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'SaltedgeConnection',   count(*) FROM "SaltedgeConnection"   WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'TruelayerToken',       count(*) FROM "TruelayerToken"       WHERE "userId" NOT IN (SELECT id FROM "User");

-- ── Step 2: delete them ──
BEGIN;
DELETE FROM "BodyMeasurementLog"   WHERE "userId" NOT IN (SELECT id FROM "User");
DELETE FROM "PushSubscription"     WHERE "userId" NOT IN (SELECT id FROM "User");
DELETE FROM "TagAlias"             WHERE "userId" NOT IN (SELECT id FROM "User");
DELETE FROM "GocardlessConnection" WHERE "userId" NOT IN (SELECT id FROM "User");
DELETE FROM "SaltedgeConnection"   WHERE "userId" NOT IN (SELECT id FROM "User");
DELETE FROM "TruelayerToken"       WHERE "userId" NOT IN (SELECT id FROM "User");
-- Every count here should now be 0.
SELECT 'BodyMeasurementLog' AS "table", count(*) FROM "BodyMeasurementLog" WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'PushSubscription',     count(*) FROM "PushSubscription"     WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'TagAlias',             count(*) FROM "TagAlias"             WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'GocardlessConnection', count(*) FROM "GocardlessConnection" WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'SaltedgeConnection',   count(*) FROM "SaltedgeConnection"   WHERE "userId" NOT IN (SELECT id FROM "User")
UNION ALL SELECT 'TruelayerToken',       count(*) FROM "TruelayerToken"       WHERE "userId" NOT IN (SELECT id FROM "User");
COMMIT;
