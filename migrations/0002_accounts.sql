-- Accounts: let people sign themselves up and get their key back later.
--
-- The gate credential does not change shape — `token_hash` stays the thing
-- /gate verifies against, in constant time, exactly as before. What is new is a
-- second, encrypted copy of the same token so a logged-in owner can *read* it
-- again. Storing only the hash meant a lost token was gone forever, which in
-- practice meant somebody had to hand out tokens by hand.
--
-- The ciphertext is AES-GCM under TOKEN_KEY, which lives in a Worker secret and
-- never touches this database. Losing the database therefore does not leak
-- anybody's token; losing both does. That is strictly weaker than a hash-only
-- design and is the deliberate price of "log in and see your key".

ALTER TABLE users ADD COLUMN email TEXT;              -- stored lowercased
ALTER TABLE users ADD COLUMN password_hash TEXT;      -- base64 PBKDF2-SHA256
ALTER TABLE users ADD COLUMN password_salt TEXT;      -- base64, 16 bytes
ALTER TABLE users ADD COLUMN password_iters INTEGER;  -- recorded so the cost can
                                                      -- be raised later without
                                                      -- invalidating old hashes
ALTER TABLE users ADD COLUMN token_cipher TEXT;       -- base64 AES-GCM ciphertext
ALTER TABLE users ADD COLUMN token_iv TEXT;           -- base64, 12 bytes

-- Partial index: rows seeded before accounts existed have a NULL email and must
-- not collide with each other.
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;

-- Login sessions. A cookie alone could carry a signed user id, but then signing
-- out everywhere (after a password reset, say) would be impossible without
-- rotating the global secret and evicting everyone at once.
CREATE TABLE sessions_web (
  id TEXT PRIMARY KEY,           -- 128-bit random, the cookie's whole value
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_web_user ON sessions_web(user_id);
