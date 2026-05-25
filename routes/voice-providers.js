const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const SUPPORTED_PROVIDERS = ["elevenlabs", "humeai", "fishaudio", "openai"];

function normalizeProvider(provider) {
  return String(provider || "").trim().toLowerCase();
}

function isSupportedProvider(provider) {
  return SUPPORTED_PROVIDERS.includes(normalizeProvider(provider));
}

function getLast4(value) {
  const text = String(value || "").trim();
  return text.length <= 4 ? text : text.slice(-4);
}

// GET /voice-providers
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT provider, last4, updated_at
       FROM user_api_keys
       WHERE user_id = $1`,
      [userId]
    );

    const connectedMap = new Map(
      result.rows.map((row) => [row.provider, row])
    );

    res.json({
      success: true,
      providers: SUPPORTED_PROVIDERS.map((id) => {
        const saved = connectedMap.get(id);

        return {
          id,
          connected: Boolean(saved),
          last4: saved?.last4 || null,
          updated_at: saved?.updated_at || null,
        };
      }),
    });
  } catch (err) {
    console.error("voice providers list failed:", err);
    res.status(500).json({ message: "Failed to fetch voice providers" });
  }
});

// GET /voice-providers/:provider/status
router.get("/:provider/status", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const provider = normalizeProvider(req.params.provider);

  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ message: "Unsupported provider" });
  }

  try {
    const result = await pool.query(
      `SELECT provider, last4, updated_at
       FROM user_api_keys
       WHERE user_id = $1 AND provider = $2
       LIMIT 1`,
      [userId, provider]
    );

    const saved = result.rows[0];

    res.json({
      success: true,
      provider,
      connected: Boolean(saved),
      last4: saved?.last4 || null,
      updated_at: saved?.updated_at || null,
    });
  } catch (err) {
    console.error("voice provider status failed:", err);
    res.status(500).json({ message: "Failed to fetch provider status" });
  }
});

// POST /voice-providers/:provider/api-key
router.post("/:provider/api-key", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const provider = normalizeProvider(req.params.provider);
  const { api_key, api_key_encrypted, last4 = null } = req.body;

  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ message: "Unsupported provider" });
  }

  const storedKey = api_key_encrypted || api_key;

  if (!storedKey || !String(storedKey).trim()) {
    return res.status(400).json({
      message: "api_key or api_key_encrypted is required",
    });
  }

  const safeLast4 = last4 || getLast4(api_key || storedKey);

  try {
    const result = await pool.query(
      `INSERT INTO user_api_keys
        (user_id, provider, api_key_encrypted, last4, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         api_key_encrypted = EXCLUDED.api_key_encrypted,
         last4 = EXCLUDED.last4,
         updated_at = NOW()
       RETURNING provider, last4, created_at, updated_at`,
      [userId, provider, String(storedKey).trim(), safeLast4]
    );

    res.json({
      success: true,
      message: "Provider API key saved",
      provider: result.rows[0],
    });
  } catch (err) {
    console.error("voice provider api key save failed:", err);
    res.status(500).json({ message: "Failed to save provider API key" });
  }
});

// GET /voice-providers/:provider/voices
router.get("/:provider/voices", authMiddleware, async (req, res) => {
  const provider = normalizeProvider(req.params.provider);

  if (!isSupportedProvider(provider)) {
    return res.status(400).json({ message: "Unsupported provider" });
  }

  try {
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
      source: "db_cache",
    });
  } catch (err) {
    console.error("voice provider voices failed:", err);
    res.status(500).json({ message: "Failed to fetch provider voices" });
  }
});

module.exports = router;