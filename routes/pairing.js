const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const pool = require("../db");
const { processEvent } = require("../services/eventProcessor");

// POST /pairing/start
router.post("/start", authMiddleware, async (req, res) => {
  const user_id = req.user?.id;

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
      `SELECT device_id,
              online_status,
              last_seen,
              device_type,
              runtime,
              capabilities,
              firmware_version
       FROM devices
       WHERE online_status = 'online'
       ORDER BY last_seen DESC`
    );

    res.json({
      success: true,
      devices: devices.rows.map((d, index) => {
        const deviceType = d.device_type || "pi";
        const runtime = d.runtime || (deviceType === "esp" ? "esp32" : "raspberry_pi");

        return {
          device_id: d.device_id,
          name: `Koibito ${index + 1}`,
          claimed: false,
          pairing_mode: true,
          online_status: d.online_status,
          last_seen: d.last_seen,

          // ESP/Pi runtime metadata
          device_type: deviceType,
          runtime,
          capabilities: Array.isArray(d.capabilities) ? d.capabilities : [],
          firmware_version: d.firmware_version || null,
        };
      }),
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
  const userId = req.user.id;

  if (!device_id || !app_device_id || !app_name) {
    return res.status(400).json({
      message: "device_id, app_device_id, and app_name are required",
    });
  }

  const client = await pool.connect();

  try {
    // 1. Validate session
    const sessionCheck = await client.query(
      `SELECT * FROM pairing_sessions
       WHERE id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [session_id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        message: "pairing session not found or expired",
      });
    }

    // 2. Validate device
    const deviceCheck = await client.query(
      `SELECT * FROM devices WHERE device_id = $1`,
      [device_id]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ message: "device not found" });
    }

    const device = deviceCheck.rows[0];

    const device_type =
      device.device_type || "pi";

    const runtime =
      device.runtime ||
      (device_type === "esp" ? "esp32" : "raspberry_pi");

    const capabilities =
      Array.isArray(device.capabilities)
      ? device.capabilities
      : [];

    await client.query("BEGIN");

    // 3. Create Koibito
    const koibitoResult = await client.query(
      `INSERT INTO koibitos (
         user_id,
         name,
         paired_at,
         created_at,
         updated_at
       )
       VALUES ($1, $2, NOW(), NOW(), NOW())
       RETURNING *`,
      [userId, "My Koibito"]
    );

    const koibito = koibitoResult.rows[0];

    // 4. Link device → koibito
    await client.query(
      `UPDATE devices
       SET koibito_id = $1
       WHERE device_id = $2`,
      [koibito.id, device_id]
    );

// after linking device

// push latest wifi
await client.query(`
  INSERT INTO device_commands (device_id, command_type, payload)
  SELECT $1, 'wifi_apply', json_build_object(
    'ssid', ssid,
    'password_encrypted', password_encrypted
  )
  FROM device_network_profiles
  WHERE user_id = $2 AND is_preferred = true
  LIMIT 1
`, [device_id, userId]);

// push API key
await client.query(`
  INSERT INTO device_commands (device_id, command_type, payload)
  SELECT $1, 'setup_apply', json_build_object(
    'provider', provider,
    'api_key_encrypted', api_key_encrypted
  )
  FROM user_api_keys
  WHERE user_id = $2
  LIMIT 1
`, [device_id, userId]);

    // 5. Queue setup_apply for Pi
    await client.query(
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

    // 6. Mark session claimed
    await client.query(
      `UPDATE pairing_sessions
       SET status = 'claimed', claimed_device_id = $2
       WHERE id = $1`,
      [session_id, device_id]
    );

    await client.query("COMMIT");

    // Badge/event bridge: pairing succeeded, so emit the normal Event Language event.
    // This runs after COMMIT so badge failures never roll back a successful pairing.
    try {
      await processEvent({
        user_id: userId,
        koibito_id: koibito.id,
        event_type: "koibito.paired",
        source: "pairing_claim",
        metadata: {
          device_id,
          pairing_session_id: session_id,
        },
      });
    } catch (eventErr) {
      console.error("[pairing] failed to process koibito.paired event", eventErr);
    }

    res.json({
      success: true,
      message: "device claimed and koibito created",
      koibito,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "failed to complete pairing" });
  } finally {
    client.release();
  }
});

module.exports = router;