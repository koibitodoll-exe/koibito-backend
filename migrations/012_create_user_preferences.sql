CREATE TABLE IF NOT EXISTS user_preferences (
  id SERIAL PRIMARY KEY,

  user_id INTEGER UNIQUE NOT NULL
  REFERENCES users(id)
  ON DELETE CASCADE,

  preferences_json JSONB
  NOT NULL DEFAULT '{}'::jsonb,

  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS
idx_user_preferences_user_id
ON user_preferences(user_id);