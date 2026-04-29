const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /voices
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, voice_key, label, provider
       FROM voice_profiles
       ORDER BY label ASC`
    );

    res.json({
      success: true,
      voices: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch voices" });
  }
});

module.exports = router;