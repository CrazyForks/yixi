-- 一息 initial schema.
-- Multi-user from day one: a token IS an identity. No registration, no email.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,   -- SHA-256 hex; plaintext shown once at creation
  is_owner INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE user_apps (
  user_id INTEGER NOT NULL,
  app TEXT NOT NULL,                 -- short key, e.g. "xhs"
  label TEXT NOT NULL,               -- display name, e.g. 小红书
  scheme TEXT NOT NULL,              -- e.g. "xhsdiscover://" — must be probed on-device first
  wait_seconds INTEGER NOT NULL DEFAULT 10,
  grace_seconds INTEGER NOT NULL DEFAULT 90,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, app)
);

-- One interception session. The sid doubles as a one-shot bearer credential for
-- /b and /resolve, so those routes never carry the user's long-lived token.
CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  app TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER                -- NULL = still undecided
);

-- kind: attempt | grace_pass | proceeded | abandoned
--
-- grace_pass is the iOS automation re-firing as we hand control back to the
-- target app. It is machine noise, not an impulse — never count it as an
-- attempt, and never use it as the denominator of any ratio.
--
-- grace_pass rows carry `sid = ''`: there is no interception session behind
-- them. Anything joining events to sessions must filter them out rather than
-- assume the join always lands.
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sid TEXT NOT NULL,
  app TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts INTEGER NOT NULL,               -- epoch ms
  date TEXT NOT NULL                 -- Asia/Shanghai local day, YYYY-MM-DD
);

CREATE INDEX idx_events_user_date ON events(user_id, date);
CREATE INDEX idx_events_user_sid ON events(user_id, sid);
CREATE INDEX idx_events_user_app_ts ON events(user_id, app, ts);

CREATE TABLE grace (
  user_id INTEGER NOT NULL,
  app TEXT NOT NULL,
  until INTEGER NOT NULL,            -- epoch ms
  PRIMARY KEY (user_id, app)
);
