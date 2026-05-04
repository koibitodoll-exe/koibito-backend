const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

router.post("/", authMiddleware, async (req, res) => {
  const { koibito_id, memory_text } = req.body;
  const userId = req.user.id;

  if (!koibito_id || !memory_text) {
    return res.status(400).json({
      message: "koibito_id and memory_text are required",
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO memories (koibito_id, user_id, memory_text)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [koibito_id, userId, memory_text]
    );

    res.json({
      message: "Memory saved",
      memory_id: result.rows[0].id,
    });
  } catch (error) {
    console.error("Save memory error:", error);
    res.status(500).json({ message: "Failed to save memory" });
  }
});

router.get("/:koibito_id", authMiddleware, async (req, res) => {
  const koibitoId = req.params.koibito_id;
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT *
       FROM memories
       WHERE koibito_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [koibitoId, userId]
    );

    res.json({ memories: result.rows });
  } catch (error) {
    console.error("Fetch memories error:", error);
    res.status(500).json({ message: "Failed to fetch memories" });
  }
});

module.exports = router;