const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const pool = require("../db");

let deviceSetupState = {
  status: "setup_mode",
  ssid: null,
  ip: null,
  success: false
};

function normalizeBatteryPercent(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  if (num < 0) return 0;
  if (num > 100) return 100;
  return Math.round(num);
}

function normalizeBatteryVoltage(value) {
  if (value === undefined || value === null || value === "") return null;
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return num;
}

function normalizeCharging(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "charging"].includes(lowered)) return true;
    if (["false", "0", "no", "not_charging"].includes(lowered)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return null;
}

router.post("/setup-wifi", authMiddleware, (req, res) => {
  const { ssid, password } = req.body;

  if (!ssid || !password) {
    return res.status(400).json({ message: "ssid and password are required" });
  }

  deviceSetupState = {
    status: "connected",
    ssid,
    ip: "192.168.1.20",
    success: true
  };

  res.json({
    success: true,
    ip: deviceSetupState.ip,
    message: "Connected to Wi-Fi"
  });
});

router.get("/setup-status", authMiddleware, (req, res) => {
  res.json(deviceSetupState);
});

router.post("/device-heartbeat", async (req, res) => {
  const {
    device_id,
    online_status,
    battery_percent,
    battery_voltage,
    is_charging
  } = req.body;

  if (!device_id) {
    return res.status(400).json({ message: "device_id is required" });
  }

  const normalizedBatteryPercent = normalizeBatteryPercent(battery_percent);
  const normalizedBatteryVoltage = normalizeBatteryVoltage(battery_voltage);
  const normalizedCharging = normalizeCharging(is_charging);

  let derivedStatus = online_status || "online";
  if (!online_status && normalizedCharging === true) {
    derivedStatus = "charging";
  }

  try {
    const result = await pool.query(
      `UPDATE devices
       SET online_status = COALESCE($2, online_status, 'online'),
           battery_percent = COALESCE($3, battery_percent),
           battery_voltage = COALESCE($4, battery_voltage),
           is_charging = COALESCE($5, is_charging),
           last_seen = NOW()
       WHERE device_id = $1
       RETURNING *`,
      [
        device_id,
        derivedStatus,
        normalizedBatteryPercent,
        normalizedBatteryVoltage,
        normalizedCharging
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "device not found" });
    }

    const device = result.rows[0];

    if (device.koibito_id) {
      await pool.query(
        `UPDATE koibitos
         SET battery_percent = COALESCE($2, battery_percent),
             status = COALESCE($3, status),
             updated_at = NOW()
         WHERE id = $1`,
        [
          device.koibito_id,
          normalizedBatteryPercent,
          derivedStatus
        ]
      );
    }

    res.json({
      success: true,
      message: "heartbeat received",
      device,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "heartbeat failed" });
  }
});

router.get("/:device_id/status", async (req, res) => {
  const { device_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT device_id, koibito_id, online_status, battery_percent, battery_voltage, is_charging, last_seen
       FROM devices
       WHERE device_id = $1`,
      [device_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "device not found" });
    }

    res.json({
      success: true,
      device: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "failed to get device status" });
  }
});

router.get("/:device_id/commands", async (req, res) => {
  const { device_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM device_commands
       WHERE device_id = $1 AND status = 'pending'
       ORDER BY created_at ASC`,
      [device_id]
    );

    res.json({
      success: true,
      commands: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "failed to fetch commands" });
  }
});

router.post("/:device_id/command", async (req, res) => {
  const { device_id } = req.params;
  const { command_type, payload } = req.body;

  if (!command_type) {
    return res.status(400).json({ message: "command_type is required" });
  }

  try {
    const deviceCheck = await pool.query(
      `SELECT * FROM devices WHERE device_id = $1`,
      [device_id]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ message: "device not found" });
    }

    const result = await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [device_id, command_type, payload ? JSON.stringify(payload) : null]
    );

    res.json({
      success: true,
      message: "command queued",
      command: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "failed to queue command" });
  }
});

router.post("/command/:command_id/complete", async (req, res) => {
  const { command_id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE device_commands
       SET status = 'completed'
       WHERE id = $1
       RETURNING *`,
      [command_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "command not found" });
    }

    res.json({
      success: true,
      message: "command marked completed",
      command: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "failed to update command" });
  }
});

module.exports = router;