-- A user's chosen UI language ('zh' | 'en'); NULL means "never chosen",
-- and src/i18n/index.ts's localeOf() falls through to the next signal.
ALTER TABLE users ADD COLUMN locale TEXT;
