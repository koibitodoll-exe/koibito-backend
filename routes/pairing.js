const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const pool = require("../db");

// POST /pairing/start
router.post("/start", authMiddleware, async (req, res) => {
  const user_id = req.user?.id || req.body.user_id;

  if (!user_id) {
    return res.status(400).json({ message: "user_id is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO pairing_sessions (user_id, status, expires_at)
       VALUES ($1, 'pending', NOW() + INTERVAL '5 minutes')
       RETURNING *`,
      [user_id]
    );

    res.json({
      success: true,
      session_id: result.rows[0].id,
      expires_in: 300,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "failed to start pairing session" });
  }
});

// GET /pairing/:session_id/devices
router.get("/:session_id/devices", authMiddleware, async (req, res) => {
  const { session_id } = req.params;

  try {
    const sessionCheck = await pool.query(
      `SELECT * FROM pairing_sessions
       WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [session_id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ message: "pairing session not found or expired" });
    }

    const devices = await pool.query(
      `SELECT device_id, koibito_id, online_status, last_seen
       FROM devices
       WHERE online_status = 'online'
       ORDER BY last_seen DESC`
    );

    res.json({
      success: true,
      devices: devices.rows.map((d) => ({
        device_id: d.device_id,
        name: d.koibito_id || "Koibito",
        claimed: false,
        pairing_mode: true,
        online_status: d.online_status,
        last_seen: d.last_seen,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "failed to fetch pairable devices" });
  }
});

// POST /pairing/:session_id/claim
router.post("/:session_id/claim", authMiddleware, async (req, res) => {
  const { session_id } = req.params;
  const { device_id, app_device_id, app_name } = req.body;

  if (!device_id || !app_device_id || !app_name) {
    return res.status(400).json({ message: "device_id, app_device_id, and app_name are required" });
  }

  try {
    const sessionCheck = await pool.query(
      `SELECT * FROM pairing_sessions
       WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [session_id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({ message: "pairing session not found or expired" });
    }

    const deviceCheck = await pool.query(
      `SELECT * FROM devices WHERE device_id = $1`,
      [device_id]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ message: "device not found" });
    }

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, $2, $3)`,
      [
        device_id,
        "setup_apply",
        JSON.stringify({
          app: {
            device_id: app_device_id,
            name: app_name,
            claim: true,
          },
        }),
      ]
    );

    await pool.query(
      `UPDATE pairing_sessions
       SET status = 'claimed', claimed_device_id = $2
       WHERE id = $1`,
      [session_id, device_id]
    );

    res.json({
      success: true,
      message: "device claim queued",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "failed to claim device" });
  }
});

module.exports = router;