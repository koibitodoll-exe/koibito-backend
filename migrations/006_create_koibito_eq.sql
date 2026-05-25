CREATE TABLE IF NOT EXISTS user_koibito_eq (
 id SERIAL PRIMARY KEY,

 user_id INTEGER NOT NULL,
 koibito_id INTEGER NOT NULL,

 comfort INTEGER DEFAULT 0,
 trust INTEGER DEFAULT 0,
 chaos INTEGER DEFAULT 0,
 romance INTEGER DEFAULT 0,
 mentorship INTEGER DEFAULT 0,
 dependency INTEGER DEFAULT 0,
 jealousy INTEGER DEFAULT 0,

 relationship_xp INTEGER DEFAULT 0,
 relationship_level INTEGER DEFAULT 1,

 relationship_label TEXT DEFAULT 'Familiar',

 updated_at TIMESTAMP DEFAULT NOW(),

 UNIQUE(user_id, koibito_id)
);