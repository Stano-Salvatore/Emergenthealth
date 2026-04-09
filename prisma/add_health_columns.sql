-- Run this in your Neon SQL Editor (console.neon.tech → SQL Editor)
-- Adds coffee, water, and mood columns to HealthLog
-- After running, re-deploy to Vercel and sync from exist.io

ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "coffee"  INTEGER;
ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "water"   INTEGER;
ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "mood"    INTEGER;

-- coffee: cups of coffee per day (from exist.io attribute "coffee")
-- water:  ml of water per day (from exist.io attribute "water")
-- mood:   mood score 1–9 (from exist.io attribute "mood")
