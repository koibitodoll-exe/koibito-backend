const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

// GET /connections
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const wifiResult = await pool.query(
      `SELECT id, user_id, device_id, ssid, is_preferred, last_used_at, created_at, updated_at
       FROM device_network_profiles
       WHERE user_id = $1
       ORDER BY is_preferred DESC, updated_at DESC`,
      [userId]
    );

    const apiKeysResult = await pool.query(
      `SELECT provider, last4, created_at, updated_at
       FROM user_api_keys
       WHERE user_id = $1
       ORDER BY provider ASC`,
      [userId]
    );

    res.json({
      success: true,
      wifi_profiles: wifiResult.rows,
      api_keys: apiKeysResult.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch connection settings" });
  }
});

// POST /connections/wifi
router.post("/wifi", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    device_id = null,
    koibito_id = null,
    ssid,
    password,
    password_encrypted,
    is_preferred = true,
    queue_connect = false,
  } = req.body;

  if (!ssid || (!password && !password_encrypted)) {
    return res.status(400).json({
      message: "ssid and password are required",
    });
  }

  try {
    let resolvedDeviceId = device_id;

    if (!resolvedDeviceId && koibito_id) {
      const deviceResult = await pool.query(
        `SELECT d.device_id
         FROM devices d
         JOIN koibitos k ON k.id = d.koibito_id
         WHERE k.id = $1 AND k.user_id = $2
         LIMIT 1`,
        [koibito_id, userId]
      );

      if (deviceResult.rows.length > 0) {
        resolvedDeviceId = deviceResult.rows[0].device_id;
      }
    }

    if (is_preferred) {
      await pool.query(
        `UPDATE device_network_profiles
         SET is_preferred = FALSE
         WHERE user_id = $1`,
        [userId]
      );
    }

    const storedPassword = password_encrypted || password;

    const result = await pool.query(
      `INSERT INTO device_network_profiles
       (user_id, device_id, ssid, password_encrypted, is_preferred, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, user_id, device_id, ssid, is_preferred, last_used_at, created_at, updated_at`,
      [userId, resolvedDeviceId, ssid, storedPassword, is_preferred]
    );

    if (queue_connect && resolvedDeviceId) {
      await pool.query(
        `INSERT INTO device_commands (device_id, command_type, payload)
         VALUES ($1, 'wifi_apply', $2)`,
        [
          resolvedDeviceId,
          JSON.stringify({
            profile_id: result.rows[0].id,
            ssid,
            password_encrypted: storedPassword,
          }),
        ]
      );
    }

    res.json({
      success: true,
      message: resolvedDeviceId && queue_connect
        ? "Wi-Fi profile saved and connect command queued"
        : "Wi-Fi profile saved for later pairing",
      wifi_profile: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save Wi-Fi profile" });
  }
});

// POST /connections/wifi/connect
router.post("/wifi/connect", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { profile_id } = req.body;

  if (!profile_id) {
    return res.status(400).json({ message: "profile_id is required" });
  }

  try {
    const profileResult = await pool.query(
      `SELECT id, user_id, device_id, ssid, password_encrypted
       FROM device_network_profiles
       WHERE id = $1 AND user_id = $2`,
      [profile_id, userId]
    );

    if (profileResult.rows.length === 0) {
      return res.status(404).json({ message: "Wi-Fi profile not found" });
    }

    const profile = profileResult.rows[0];

    await pool.query(
      `UPDATE device_network_profiles
       SET last_used_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [profile_id]
    );

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, 'wifi_apply', $2)`,
      [
        profile.device_id,
        JSON.stringify({
          profile_id: profile.id,
          ssid: profile.ssid,
          password_encrypted: profile.password_encrypted,
        }),
      ]
    );

    res.json({
      success: true,
      message: "Wi-Fi connect command queued",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to queue Wi-Fi connect command" });
  }
});

// POST /connections/api-key
router.post("/api-key", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { provider, api_key_encrypted, last4 = null, koibito_id = null } = req.body;

  if (!provider || !api_key_encrypted) {
    return res.status(400).json({ message: "provider and api_key_encrypted are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO user_api_keys (user_id, provider, api_key_encrypted, last4, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, provider)
       DO UPDATE SET
         api_key_encrypted = EXCLUDED.api_key_encrypted,
         last4 = EXCLUDED.last4,
         updated_at = NOW()
       RETURNING id, user_id, provider, last4, created_at, updated_at`,
      [userId, provider, api_key_encrypted, last4]
    );

    if (koibito_id) {
      await pool.query(
        `INSERT INTO device_commands (device_id, command_type, payload)
         SELECT d.device_id, 'setup_apply', $2
         FROM devices d
         JOIN koibitos k ON k.id = d.koibito_id
         WHERE k.id = $1 AND k.user_id = $3`,
        [
          koibito_id,
          JSON.stringify({
            provider,
            api_key_encrypted,
            last4,
          }),
          userId,
        ]
      );
    }

    res.json({
      success: true,
      message: "API key saved",
      api_key: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save API key" });
  }
});

// GET /connections/api-key/status
router.get("/api-key/status", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT provider, last4, created_at, updated_at
       FROM user_api_keys
       WHERE user_id = $1
       ORDER BY provider ASC`,
      [userId]
    );

    res.json({
      success: true,
      api_keys: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch API key status" });
  }
});

// GET /connections/bluetooth
router.get("/bluetooth", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, device_id, name, type, battery_level, paired, created_at, updated_at
       FROM bluetooth_devices
       ORDER BY paired DESC, updated_at DESC`
    );

    res.json({
      success: true,
      bluetooth_devices: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch bluetooth devices" });
  }
});

// POST /connections/bluetooth/pair
router.post("/bluetooth/pair", authMiddleware, async (req, res) => {
  const { device_id, name, type = "unknown", battery_level = null } = req.body;

  if (!device_id || !name) {
    return res.status(400).json({ message: "device_id and name are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO bluetooth_devices
       (device_id, name, type, battery_level, paired, updated_at)
       VALUES ($1, $2, $3, $4, TRUE, NOW())
       ON CONFLICT (device_id)
       DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         battery_level = EXCLUDED.battery_level,
         paired = TRUE,
         updated_at = NOW()
       RETURNING *`,
      [device_id, name, type, battery_level]
    );

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, 'bluetooth_pair', $2)`,
      [
        device_id,
        JSON.stringify({
          device_id,
          name,
          type,
        }),
      ]
    );

    res.json({
      success: true,
      message: "Bluetooth pair queued",
      bluetooth_device: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to pair bluetooth device" });
  }
});

// POST /connections/bluetooth/unpair
router.post("/bluetooth/unpair", authMiddleware, async (req, res) => {
  const { device_id } = req.body;

  if (!device_id) {
    return res.status(400).json({ message: "device_id is required" });
  }

  try {
    const result = await pool.query(
      `UPDATE bluetooth_devices
       SET paired = FALSE,
           updated_at = NOW()
       WHERE device_id = $1
       RETURNING *`,
      [device_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Bluetooth device not found" });
    }

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, 'bluetooth_unpair', $2)`,
      [
        device_id,
        JSON.stringify({
          device_id,
        }),
      ]
    );

    res.json({
      success: true,
      message: "Bluetooth unpair queued",
      bluetooth_device: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to unpair bluetooth device" });
  }
});

// POST /connections/bluetooth/reconnect
router.post("/bluetooth/reconnect", authMiddleware, async (req, res) => {
  const { device_id } = req.body;

  if (!device_id) {
    return res.status(400).json({ message: "device_id is required" });
  }

  try {
    const deviceResult = await pool.query(
      `SELECT * FROM bluetooth_devices WHERE device_id = $1`,
      [device_id]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ message: "Bluetooth device not found" });
    }

    await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, 'bluetooth_reconnect', $2)`,
      [
        device_id,
        JSON.stringify({
          device_id,
        }),
      ]
    );

    res.json({
      success: true,
      message: "Bluetooth reconnect queued",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to reconnect bluetooth device" });
  }
});

module.exports = router;