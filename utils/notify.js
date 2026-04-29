const pool = require("../db");

async function notify(userId, type, title, message, meta = {}) {
  await pool.query(
    `INSERT INTO notifications (user_id, type, title, message, meta)
     VALUES ($1,$2,$3,$4,$5)`,
    [userId, type, title, message, meta]
  );
}

module.exports = notify;