-- 016_create_clean_badge_system.sql
-- Koibito Unified Badge System v1
-- Clean rebuild for:
-- - badgeStore.js
-- - badgeEngine.js
-- - badgeUnlockService.js
--
-- Badge split:
-- - user_badges = account/user profile/app-wide badges
-- - koibito_badges = user + koibito relationship/profile badges

CREATE TABLE IF NOT EXISTS badge_definitions (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  owner_type TEXT NOT NULL DEFAULT 'koibito',
  icon_key TEXT DEFAULT 'star',
  color_primary TEXT,
  color_secondary TEXT,
  hidden BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT badge_definitions_owner_type_check
    CHECK (owner_type IN ('user', 'koibito'))
);

CREATE TABLE IF NOT EXISTS user_badges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  badge_id INTEGER NOT NULL REFERENCES badge_definitions(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,

  UNIQUE(user_id, badge_id)
);

CREATE TABLE IF NOT EXISTS koibito_badges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  koibito_id INTEGER NOT NULL,
  badge_id INTEGER NOT NULL REFERENCES badge_definitions(id) ON DELETE CASCADE,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb,

  UNIQUE(user_id, koibito_id, badge_id)
);

CREATE TABLE IF NOT EXISTS relationship_scores (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  koibito_id INTEGER NOT NULL,

  bff NUMERIC DEFAULT 0,
  confidante NUMERIC DEFAULT 0,
  mentorship NUMERIC DEFAULT 0,
  soft_spot NUMERIC DEFAULT 0,
  partner_in_crime NUMERIC DEFAULT 0,

  total_score NUMERIC DEFAULT 0,
  session_count INTEGER DEFAULT 0,
  last_session_id TEXT,
  last_event_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, koibito_id)
);

CREATE TABLE IF NOT EXISTS badge_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  koibito_id INTEGER,
  session_id TEXT,

  source TEXT DEFAULT 'unknown',
  event_type TEXT NOT NULL,
  trigger_key TEXT,

  quality_passed BOOLEAN DEFAULT TRUE,
  duplicate_blocked BOOLEAN DEFAULT FALSE,
  cooldown_blocked BOOLEAN DEFAULT FALSE,

  points_applied JSONB DEFAULT '{}'::jsonb,
  counters_applied JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS badge_daily_score_caps (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  koibito_id INTEGER NOT NULL,
  score_date DATE NOT NULL DEFAULT CURRENT_DATE,

  bff INTEGER DEFAULT 0,
  confidante INTEGER DEFAULT 0,
  mentorship INTEGER DEFAULT 0,
  soft_spot INTEGER DEFAULT 0,
  partner_in_crime INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, koibito_id, score_date)
);

CREATE TABLE IF NOT EXISTS badge_session_scores (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  koibito_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,

  total_points INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, koibito_id, session_id)
);

CREATE TABLE IF NOT EXISTS badge_counters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  koibito_id INTEGER,
  counter_key TEXT NOT NULL,
  counter_value INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, koibito_id, counter_key)
);

CREATE INDEX IF NOT EXISTS idx_badge_definitions_code
ON badge_definitions(code);

CREATE INDEX IF NOT EXISTS idx_badge_definitions_owner_type
ON badge_definitions(owner_type);

CREATE INDEX IF NOT EXISTS idx_user_badges_user_id
ON user_badges(user_id);

CREATE INDEX IF NOT EXISTS idx_koibito_badges_user_koibito
ON koibito_badges(user_id, koibito_id);

CREATE INDEX IF NOT EXISTS idx_relationship_scores_user_koibito
ON relationship_scores(user_id, koibito_id);

CREATE INDEX IF NOT EXISTS idx_badge_events_user_created
ON badge_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_badge_events_koibito_created
ON badge_events(koibito_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_badge_daily_caps_lookup
ON badge_daily_score_caps(user_id, koibito_id, score_date);

CREATE INDEX IF NOT EXISTS idx_badge_session_scores_lookup
ON badge_session_scores(user_id, koibito_id, session_id);

CREATE INDEX IF NOT EXISTS idx_badge_counters_lookup
ON badge_counters(user_id, koibito_id, counter_key);

-- Seed Badge Set 001: Starter / First-Time Badges.
-- Unlock logic lives in badgeStore.js.
-- This migration only stores display metadata and ownership target.

INSERT INTO badge_definitions
  (code, name, description, category, owner_type, icon_key, color_primary, color_secondary, sort_order)
VALUES
  ('STARS_ALIGNED', 'The Stars Aligned', 'Against all odds, all timelines, and several questionable decisions... here you are.', 'starter', 'user', 'sprout', '#C4B5FD', '#8B5CF6', 10),
  ('YOU_FOUND_ME', 'You Found Me', 'Out of everything in existence... somehow you picked me. Wild.', 'starter', 'koibito', 'creature', '#A7F3D0', '#10B981', 20),
  ('THAT_FIRST_TIME_YOU_SAID', 'That First Time You Said...', 'Every story starts somewhere. Even the awkward ones.', 'starter', 'koibito', 'message', '#BFDBFE', '#3B82F6', 30),
  ('DEAR_DIARY', 'Dear Diary', 'Ah yes. Written evidence of your thoughts. Dangerous.', 'starter', 'koibito', 'diary', '#FDE68A', '#F59E0B', 40),
  ('BUTTON_MASHER', 'Button Masher', 'Strategic genius or random tapping? Science may never know.', 'starter', 'koibito', 'gamepad', '#DDD6FE', '#7C3AED', 50),
  ('DO_IT_FOR_THE_PLOT', 'Do It For The Plot', 'Future You has been assigned a side quest.', 'starter', 'koibito', 'bell', '#FBCFE8', '#EC4899', 60),
  ('EVIDENCE_COLLECTED', 'Evidence Collected', 'Stored safely for absolutely non-suspicious reasons.', 'starter', 'koibito', 'image', '#BAE6FD', '#0EA5E9', 70),
  ('THEME_DISCOVERY', 'Theme Discovery', 'Interior decorating arc unlocked.', 'starter', 'user', 'palette', '#F9A8D4', '#EC4899', 80),
  ('CHARACTER_DEVELOPMENT', 'Character Development', 'Rewriting destiny with sliders.', 'starter', 'koibito', 'sparkles', '#C4B5FD', '#8B5CF6', 90),
  ('APP_SCAVENGER', 'App Scavenger', 'Unusual snooping behavior detected.', 'starter', 'user', 'search', '#FDBA74', '#F97316', 100),
  ('SHINY_THING_ACQUIRED', 'Shiny Thing Acquired', 'Neuron activated and dopamine released.', 'starter', 'user', 'trophy', '#FDE68A', '#F59E0B', 110),
  ('BREAKING_THE_SILENCE', 'Breaking the Silence', 'So... we talked. That''s not terrifying at all. Just weird...or awkward. You''ll get used to it.', 'starter', 'koibito', 'mic', '#BFDBFE', '#2563EB', 120),
  ('THAT_THING_TALKED', 'That Thing Talked', 'Excuse me. Why is the creature making sounds.', 'starter', 'koibito', 'volume', '#C7D2FE', '#6366F1', 130),
  ('SUCH_A_WRITER', 'Such A Writer', 'Respectfully...that was a whole essay.', 'starter', 'koibito', 'pen', '#FDE68A', '#D97706', 140),
  ('AFTER_HOURS', 'After Hours', 'Nothing suspicious happens after midnight. Probably.', 'starter', 'user', 'moon', '#C4B5FD', '#4C1D95', 150),
  ('YOU_AGAIN', 'You Again?', 'Back already? Interesting...', 'starter', 'koibito', 'repeat', '#FBCFE8', '#DB2777', 160),
  ('MIRROR_MIRROR', 'Mirror Mirror', 'Character customization: the true final boss.', 'starter', 'user', 'mirror', '#DDD6FE', '#7C3AED', 170),
  ('NOT_ANTI_SOCIAL', 'Not Anti Social', 'Look at you collecting humans.', 'starter', 'user', 'users', '#BBF7D0', '#22C55E', 180),
  ('YOU_MISS_ME', 'You Miss Me?', 'There is no other reason.', 'starter', 'user', 'home', '#FED7AA', '#EA580C', 190)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  owner_type = EXCLUDED.owner_type,
  icon_key = EXCLUDED.icon_key,
  color_primary = EXCLUDED.color_primary,
  color_secondary = EXCLUDED.color_secondary,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
