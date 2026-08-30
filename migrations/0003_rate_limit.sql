-- Fixed-window counters for the unauthenticated endpoints.
--
-- Open registration means /register, /login, /claim and /recover are reachable
-- by anyone, and PBKDF2 is capped at 100k rounds by the Worker CPU budget — so
-- the password is the weakest link in the chain and must not be guessable at
-- machine speed. This is also the only thing standing between a loop script and
-- a D1 full of junk accounts.
--
-- A fixed window (rather than a sliding one) lets a burst straddle a boundary
-- and get roughly double the allowance for a moment. That is fine here: the
-- point is to make sustained abuse cost real time, not to police a single
-- second precisely.
CREATE TABLE rate_limit (
  bucket TEXT NOT NULL,          -- which endpoint
  subject TEXT NOT NULL,         -- CF-Connecting-IP, set by the edge
  window_start INTEGER NOT NULL, -- epoch ms
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, subject)
);
