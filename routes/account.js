const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const authMiddleware = require("../middleware/authMiddleware");

const DEFAULT_PRIVACY = {
  two_factor_enabled: false,
  biometric_lock: true,
  activity_status: true,
  read_receipts: true,
  data_sharing: true,
  location_services: false,
};

function deepMerge(base = {}, patch = {}) {
  const output = { ...base };

  Object.keys(patch || {}).forEach((key) => {
    if (
      patch[key] &&
      typeof patch[key] === "object" &&
      !Array.isArray(patch[key])
    ) {
      output[key] = deepMerge(base?.[key] || {}, patch[key]);
    } else {
      output[key] = patch[key];
    }
  });

  return output;
}

// PATCH /account/email
router.patch("/email", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "email is required" });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET email = $1
       WHERE id = $2
       RETURNING id, email, contact_code, created_at`,
      [email, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      message: "Email updated",
      user: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update email" });
  }
});

// PATCH /account/password
router.patch("/password", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({
      message: "current_password and new_password are required",
    });
  }

  if (String(new_password).length < 8) {
    return res.status(400).json({
      message: "New password must be at least 8 characters",
    });
  }

  try {
    const userResult = await pool.query(
      `SELECT id, password FROM users WHERE id = $1`,
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(current_password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);

    await pool.query(
      `UPDATE users
       SET password = $1
       WHERE id = $2`,
      [hashedPassword, userId],
    );

    res.json({
      success: true,
      message: "Password updated",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update password" });
  }
});

// GET /account/privacy
router.get("/privacy", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT privacy_json, updated_at
       FROM user_privacy
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        privacy: DEFAULT_PRIVACY,
      });
    }

    res.json({
      success: true,
      privacy: deepMerge(DEFAULT_PRIVACY, result.rows[0].privacy_json || {}),
      updated_at: result.rows[0].updated_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch privacy settings" });
  }
});

// PATCH /account/privacy
router.patch("/privacy", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const patch = req.body || {};

  try {
    const existing = await pool.query(
      `SELECT privacy_json
       FROM user_privacy
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );

    const current =
      existing.rows.length > 0
        ? deepMerge(DEFAULT_PRIVACY, existing.rows[0].privacy_json || {})
        : DEFAULT_PRIVACY;

    const mergedPrivacy = deepMerge(current, patch);

    const result = await pool.query(
      `INSERT INTO user_privacy
        (user_id, privacy_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
        privacy_json = EXCLUDED.privacy_json,
        updated_at = NOW()
       RETURNING user_id, privacy_json, updated_at`,
      [userId, mergedPrivacy],
    );

    res.json({
      success: true,
      message: "Privacy settings updated",
      privacy: deepMerge(DEFAULT_PRIVACY, result.rows[0].privacy_json || {}),
      updated_at: result.rows[0].updated_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update privacy settings" });
  }
});

// POST /account/logout
router.post("/logout", authMiddleware, async (req, res) => {
  res.json({
    success: true,
    message: "Logged out",
  });
});

// DELETE /account
router.delete("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);

    res.json({
      success: true,
      message: "Account deleted",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete account" });
  }
});

module.exports = router;