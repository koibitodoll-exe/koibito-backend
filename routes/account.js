const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const authMiddleware = require("../middleware/authMiddleware");

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
      [email, userId]
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
    return res.status(400).json({ message: "current_password and new_password are required" });
  }

  try {
    const userResult = await pool.query(
      `SELECT id, password FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = userResult.rows[0];
    const isMatch = await bcrypt.compare(current_password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);

    await pool.query(
      `UPDATE users
       SET password = $1
       WHERE id = $2`,
      [hashedPassword, userId]
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
      `SELECT user_id, profile_visibility, data_permissions, updated_at
       FROM privacy_settings
       WHERE user_id = $1`,
      [userId]
    );

    res.json({
      success: true,
      privacy: result.rows[0] || {
        user_id: userId,
        profile_visibility: "friends",
        data_permissions: true,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch privacy settings" });
  }
});

// PATCH /account/privacy
router.patch("/privacy", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    profile_visibility = "friends",
    data_permissions = true,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO privacy_settings (user_id, profile_visibility, data_permissions, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         profile_visibility = EXCLUDED.profile_visibility,
         data_permissions = EXCLUDED.data_permissions,
         updated_at = NOW()
       RETURNING *`,
      [userId, profile_visibility, data_permissions]
    );

    res.json({
      success: true,
      message: "Privacy settings updated",
      privacy: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update privacy settings" });
  }
});

module.exports = router;