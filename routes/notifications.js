const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

// GET /notifications
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT id, user_id, type, title, body, related_device_id, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      notifications: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch notifications" });
  }
});

// POST /notifications/read
router.post("/read", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { notification_id } = req.body;

  if (!notification_id) {
    return res.status(400).json({ message: "notification_id is required" });
  }

  try {
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [notification_id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    res.json({
      success: true,
      message: "Notification marked as read",
      notification: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update notification" });
  }
});

// POST /notifications/read-all
router.post("/read-all", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );

    res.json({
      success: true,
      message: "All notifications marked as read",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update notifications" });
  }
});

module.exports = router;