const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const SUPPORTED_PROVIDERS = ["elevenlabs", "humeai", "fishaudio", "openai"];

function isSupportedProvider(provider) {
  return SUPPORTED_PROVIDERS.includes(String(provider || "").toLowerCase());
}

// GET /voice-providers
router.get("/", authMiddleware, async (req, res) => {
  res.json({
    success: true,
    providers: SUPPORTED_PROVIDERS.map((id) => ({
      id,
      connected: false,
    })),
  });
});

// GET /voice-providers/:provider/status
router.get("/:provider/status", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const provider = String(req.params.provider || "").toLowerCase();

  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ message: "Unsupported provider" });
  }

  try {
    const result = await pool.query(
      `SELECT id
       FROM user_api_keys
       WHERE user_id = $1 AND provider = $2
       LIMIT 1`,
      [userId, provider]
    );

    res.json({
      success: true,
      provider,
      connected: result.rows.length > 0,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch provider status" });
  }
});

// POST /voice-providers/:provider/api-key
router.post("/:provider/api-key", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const provider = String(req.params.provider || "").toLowerCase();
  const { api_key } = req.body;

  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ message: "Unsupported provider" });
  }

  if (!api_key || !String(api_key).trim()) {
    return res.status(400).json({ message: "api_key is required" });
  }

  try {
    await pool.query(
      `INSERT INTO user_api_keys (user_id, provider, api_key, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         api_key = EXCLUDED.api_key,
         updated_at = NOW()`,
      [userId, provider, String(api_key).trim()]
    );

    res.json({
      success: true,
      message: "API key saved",
      provider,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save API key" });
  }
});

// GET /voice-providers/:provider/voices
router.get("/:provider/voices", authMiddleware, async (req, res) => {
  const provider = String(req.params.provider || "").toLowerCase();

  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ message: "Unsupported provider" });
  }

  try {
    // phase 1: pull from local DB
    const result = await pool.query(
      `SELECT id, voice_key, label, provider
       FROM voice_profiles
       WHERE provider = $1
       ORDER BY label ASC`,
      [provider]
    );

    res.json({
      success: true,
      provider,
      voices: result.rows,
      source: "db",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch provider voices" });
  }
});

module.exports = router;