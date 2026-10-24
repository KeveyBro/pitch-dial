-- Community results. One row per shared game, with its rounds as JSON
-- ([[target Hz, answer Hz or null, instrument, cents or null], ...]) so each game costs one row
-- write. Dates only, no times, and nothing that identifies a player.
CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  mode TEXT NOT NULL,
  input TEXT,
  family TEXT NOT NULL,
  listen TEXT NOT NULL,
  time_limit INTEGER NOT NULL,
  range_key TEXT NOT NULL,
  fold INTEGER NOT NULL,
  scored INTEGER NOT NULL,
  missed INTEGER NOT NULL,
  avg_cents REAL NOT NULL,
  mean_cents REAL NOT NULL,
  rounds TEXT NOT NULL
);

-- A running histogram of each mode's game averages (bins defined in public/js/community.js),
-- so the stats endpoint reads one row per mode however many games there are.
CREATE TABLE histogram (
  mode TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  bins TEXT NOT NULL
);

-- Shared games per minute, site-wide, for the flood cap in worker/index.js.
CREATE TABLE throttle (
  minute INTEGER PRIMARY KEY,
  n INTEGER NOT NULL
);
