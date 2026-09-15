-- How many goal cards /today puts on the page for this user; NULL means
-- "never chosen", and src/types.ts's todayGoalLimit() falls back to
-- TODAY_GOAL_LIMIT. Anything outside 1…9 falls back the same way.
ALTER TABLE users ADD COLUMN today_goals INTEGER;
