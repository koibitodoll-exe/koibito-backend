const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

// GET /usage
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT user_id, token_limit, token_used, tts_limit, tts_used, updated_at
       FROM usage_limits
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      usage: result.rows[0] || {
        user_id: userId,
        token_limit: 0,
        token_used: 0,
        tts_limit: 0,
        tts_used: 0,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch usage" });
  }
});

// PATCH /usage/limits
router.patch("/limits", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    token_limit = 0,
    token_used = 0,
    tts_limit = 0,
    tts_used = 0,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO usage_limits (user_id, token_limit, token_used, tts_limit, tts_used, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         token_limit = EXCLUDED.token_limit,
         token_used = EXCLUDED.token_used,
         tts_limit = EXCLUDED.tts_limit,
         tts_used = EXCLUDED.tts_used,
         updated_at = NOW()
       RETURNING *`,
      [userId, token_limit, token_used, tts_limit, tts_used]
    );

    res.json({
      success: true,
      message: "Usage limits updated",
      usage: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update usage limits" });
  }
});

// POST /usage/log
router.post("/log", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    usage_type,
    amount,
    source = null,
    related_koibito_id = null,
  } = req.body;

  if (!usage_type || amount == null) {
    return res.status(400).json({ message: "usage_type and amount are required" });
  }

  if (!["token", "tts"].includes(usage_type)) {
    return res.status(400).json({ message: "usage_type must be 'token' or 'tts'" });
  }

  try {
    const logResult = await pool.query(
      `INSERT INTO usage_logs (user_id, usage_type, amount, source, related_koibito_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, usage_type, amount, source, related_koibito_id]
    );

    if (usage_type === "token") {
      await pool.query(
        `INSERT INTO usage_limits (user_id, token_used, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           token_used = usage_limits.token_used + EXCLUDED.token_used,
           updated_at = NOW()`,
        [userId, amount]
      );
    }

    if (usage_type === "tts") {
      await pool.query(
        `INSERT INTO usage_limits (user_id, tts_used, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           tts_used = usage_limits.tts_used + EXCLUDED.tts_used,
           updated_at = NOW()`,
        [userId, amount]
      );
    }

    res.json({
      success: true,
      message: "Usage logged",
      log: logResult.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to log usage" });
  }
});

module.exports = router;