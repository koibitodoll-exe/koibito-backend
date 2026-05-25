-- 002_create_notifications.sql
-- Koibito notification inbox table
-- Real notification source for Messages tab

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,

  user_id INTEGER NOT NULL,

  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,

  action_route TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
ON notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON notifications(user_id, is_read);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
ON notifications(created_at DESC);