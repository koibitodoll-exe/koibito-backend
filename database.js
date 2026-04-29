const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("./koibito.db");


db.run(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  password TEXT,
  contact_code TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS koibitos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  koibito_code TEXT UNIQUE,
  user_id INTEGER,
  name TEXT,
  avatar TEXT,
  personality TEXT,
  mood_settings TEXT,
  eq_settings TEXT,
  relationship_status TEXT,
  device_id TEXT,
  hardware_id TEXT,
  online_status TEXT,
  last_seen DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  koibito_id INTEGER,
  user_id INTEGER,
  memory_text TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

db.run(`
CREATE TABLE IF NOT EXISTS user_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE,
  display_name TEXT,
  avatar TEXT,
  bio TEXT,
  preferences TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
`);

module.exports = db;