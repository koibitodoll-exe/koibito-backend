ALTER TABLE users
ADD COLUMN IF NOT EXISTS contact_code TEXT UNIQUE;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'human';


ALTER TABLE koibitos
ADD COLUMN IF NOT EXISTS koibito_code TEXT UNIQUE;

ALTER TABLE koibitos
ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'koibito';


CREATE UNIQUE INDEX IF NOT EXISTS users_contact_code_idx
ON users(contact_code);

CREATE UNIQUE INDEX IF NOT EXISTS koibitos_code_idx
ON koibitos(koibito_code);