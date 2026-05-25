CREATE TABLE IF NOT EXISTS interaction_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  koibito_id INTEGER,
  event_type TEXT NOT NULL,
  source TEXT DEFAULT 'app',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_user_id ON interaction_events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_koibito_id ON interaction_events(koibito_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON interaction_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON interaction_events(created_at);