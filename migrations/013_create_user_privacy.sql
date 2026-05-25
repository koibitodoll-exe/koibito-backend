CREATE TABLE IF NOT EXISTS user_privacy (

  id SERIAL PRIMARY KEY,

  user_id INTEGER UNIQUE
  REFERENCES users(id)
  ON DELETE CASCADE,

  privacy_json JSONB
  NOT NULL
  DEFAULT '{}'::jsonb,

  updated_at TIMESTAMP
  DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS
idx_user_privacy_user_id
ON user_privacy(user_id);