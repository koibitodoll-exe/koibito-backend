CREATE TABLE IF NOT EXISTS koibito_diary_ingredients (

    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL,

    koibito_id INTEGER NOT NULL,

    event_type TEXT DEFAULT '',

    importance INTEGER DEFAULT 1,

    content TEXT DEFAULT '',

    metadata JSONB DEFAULT '{}',

    created_at TIMESTAMP DEFAULT NOW()

);

CREATE INDEX IF NOT EXISTS
idx_diary_ingredients

ON koibito_diary_ingredients(
koibito_id,
created_at
);