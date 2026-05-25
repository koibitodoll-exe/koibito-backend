CREATE TABLE IF NOT EXISTS user_action_logs (
  id SERIAL PRIMARY KEY,

  user_id INTEGER,
  koibito_id INTEGER,
  device_id TEXT,

  actor_type TEXT DEFAULT 'user',
  source TEXT DEFAULT 'backend',

  action_type TEXT NOT NULL,

  target_type TEXT,
  target_id TEXT,

  method TEXT,
  route TEXT,
  status_code INTEGER,

  metadata JSONB DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_action_logs_user_id
ON user_action_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_user_action_logs_action_type
ON user_action_logs(action_type);

CREATE INDEX IF NOT EXISTS idx_user_action_logs_created_at
ON user_action_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_user_action_logs_user_action_time
ON user_action_logs(user_id, action_type, created_at DESC);