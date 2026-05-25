const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const pool = require("../db");

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

function normalizeCapabilities(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.filter(Boolean).map((item) => String(item).trim()))];
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getDefaultCapabilities(deviceType, runtime) {
  if (deviceType === "esp" || runtime === "esp32") {
    return [
      "speaker",
      "buttons",
      "battery",
      "wifi",
      "4g",
      "pir",
    ];
  }

  return [];
}

function getRuntimeLabel(deviceType, runtime) {
  if (deviceType === "esp" || runtime === "esp32") {
    return "ESP lightweight runtime";
  }

  return "Raspberry Pi full runtime";
}

// App queues Wi-Fi setup command for Pi
router.post("/:device_id/setup-wifi", authMiddleware, async (req, res) => {
  const { device_id } = req.params;
  const { ssid, password } = req.body;

  if (!ssid || !password) {
    return res.status(400).json({ message: "ssid and password are required" });
  }

  try {
    const deviceCheck = await pool.query(
      `SELECT * FROM devices WHERE device_id = $1`,
      [device_id]
    );

    if (deviceCheck.rows.length === 0) {
      return res.status(404).json({ message: "device not found" });
    }

    const payload = {
      ssid,
      password,
      source: "app_setup_wifi",
      submitted_at: new Date().toISOString(),
    };

    const result = await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [device_id, "wifi_apply", JSON.stringify(payload)]
    );

    res.json({
      success: true,
      message: "Wi-Fi setup command queued",
      command: result.rows[0],
    });
  } catch (err) {
    console.error("setup-wifi failed:", err);
    res.status(500).json({ message: "failed to queue Wi-Fi setup" });
  }
});

// Device heartbeat (Pi / ESP / future runtimes)
router.post("/device-heartbeat", async (req, res) => {
  const {
    device_id,
    online_status,
    battery_percent,
    battery_voltage,
    is_charging,
    device_type = "pi",
    runtime = "raspberry_pi",
    capabilities = [],
    firmware_version = null,
    network_type = null,
    signal_strength = null,
    sim_status = null,
    runtime_mode = null,
    heap_memory = null,
    wifi_rssi = null,
    uptime = null,
    cpu_temp = null,
    free_storage = null,
  } = req.body;

  if (!device_id) {
    return res.status(400).json({ message: "device_id is required" });
  }

  const normalizedBatteryPercent = normalizeBatteryPercent(battery_percent);
  const normalizedBatteryVoltage = normalizeBatteryVoltage(battery_voltage);
  const normalizedCharging = normalizeCharging(is_charging);
  const normalizedCapabilities = normalizeCapabilities(capabilities);

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
           device_type = COALESCE($6, device_type),
           runtime = COALESCE($7, runtime),
           capabilities = COALESCE($8::jsonb, capabilities),
           firmware_version = COALESCE($9, firmware_version),
           network_type = COALESCE($10, network_type),
           signal_strength = COALESCE($11, signal_strength),
           sim_status = COALESCE($12, sim_status),
           runtime_mode = COALESCE($13, runtime_mode),
           heap_memory = COALESCE($14, heap_memory),
           wifi_rssi = COALESCE($15, wifi_rssi),
           uptime = COALESCE($16, uptime),
           cpu_temp = COALESCE($17, cpu_temp),
           free_storage = COALESCE($18, free_storage),
           last_seen = NOW()
       WHERE device_id = $1
       RETURNING *`,
      [
        device_id,
        derivedStatus,
        normalizedBatteryPercent,
        normalizedBatteryVoltage,
        normalizedCharging,
        device_type,
        runtime,
        JSON.stringify(normalizedCapabilities),
        firmware_version,
        network_type,
        signal_strength,
        sim_status,
        runtime_mode,
        heap_memory,
        wifi_rssi,
        uptime,
        cpu_temp,
        free_storage,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "device not found" });
    }

    const device = result.rows[0];

    // Runtime capability defaults.
    // Pi behavior stays untouched. ESP gets starter capability metadata only when empty.
    const existingCapabilities = normalizeCapabilities(device.capabilities);
    const defaultCapabilities = getDefaultCapabilities(device.device_type, device.runtime);

    if (existingCapabilities.length === 0 && defaultCapabilities.length > 0) {
      await pool.query(
        `UPDATE devices
         SET capabilities = $2::jsonb
         WHERE device_id = $1`,
        [device.device_id, JSON.stringify(defaultCapabilities)]
      );

      device.capabilities = defaultCapabilities;
    } else {
      device.capabilities = existingCapabilities;
    }

    if (device.koibito_id) {
      await pool.query(
        `UPDATE koibitos
         SET battery_percent = COALESCE($2, battery_percent),
             status = COALESCE($3, status),
             updated_at = NOW()
         WHERE id = $1`,
        [device.koibito_id, normalizedBatteryPercent, derivedStatus]
      );
    }

    res.json({
      success: true,
      message: "heartbeat received",
      device,
    });
  } catch (err) {
    console.error("heartbeat failed:", err);
    res.status(500).json({ message: "heartbeat failed" });
  }
});

// App gets device status
router.get("/:device_id/status", async (req, res) => {
  const { device_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT device_id, koibito_id, online_status, battery_percent,
              battery_voltage, is_charging, device_type, runtime,
              capabilities, firmware_version,
              network_type, signal_strength,
              sim_status, runtime_mode,
              heap_memory, wifi_rssi,
              uptime, cpu_temp,
              free_storage,
              last_seen
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
    console.error("status failed:", err);
    res.status(500).json({ message: "failed to get device status" });
  }
});

// App gets device capability metadata
router.get("/:device_id/capabilities", async (req, res) => {
  const { device_id } = req.params;

  try {
    const result = await pool.query(
      `SELECT device_id, koibito_id, device_type, runtime,
              capabilities, firmware_version, network_type,
              sim_status, runtime_mode, last_seen
       FROM devices
       WHERE device_id = $1`,
      [device_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "device not found" });
    }

    const device = result.rows[0];
    const deviceType = device.device_type || "pi";
    const runtime = device.runtime || (deviceType === "esp" ? "esp32" : "raspberry_pi");
    const capabilities = normalizeCapabilities(device.capabilities);
    const defaults = getDefaultCapabilities(deviceType, runtime);
    const mergedCapabilities = normalizeCapabilities([...defaults, ...capabilities]);

    res.json({
      success: true,
      device_id: device.device_id,
      koibito_id: device.koibito_id,
      device_type: deviceType,
      runtime,
      runtime_label: getRuntimeLabel(deviceType, runtime),
      runtime_mode: device.runtime_mode || (deviceType === "esp" ? "cloud_assisted" : "standard"),
      capabilities: mergedCapabilities,
      firmware_version: device.firmware_version || null,
      network_type: device.network_type || null,
      sim_status: device.sim_status || null,
      last_seen: device.last_seen,
      feature_flags: {
        can_use_wifi: mergedCapabilities.includes("wifi"),
        can_use_4g: mergedCapabilities.includes("4g"),
        can_play_audio: mergedCapabilities.includes("speaker"),
        can_use_buttons: mergedCapabilities.includes("buttons"),
        can_use_pir: mergedCapabilities.includes("pir"),
        can_use_eyes: mergedCapabilities.includes("eyes"),
        is_cloud_assisted: deviceType === "esp" || device.runtime_mode === "cloud_assisted",
      },
    });
  } catch (err) {
    console.error("capabilities failed:", err);
    res.status(500).json({ message: "failed to get device capabilities" });
  }
});

// Pi fetches pending commands
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
      commands: result.rows,
    });
  } catch (err) {
    console.error("fetch commands failed:", err);
    res.status(500).json({ message: "failed to fetch commands" });
  }
});

// App/backend queues any device command
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

    const device = deviceCheck.rows[0];
    const deviceType = device.device_type || "pi";

    // ESP command safety gate.
    // Pi behavior stays unchanged. ESP only receives commands it can safely handle.
    if (deviceType === "esp") {
      const espAllowedCommands = [
        "setup_apply",
        "wifi_apply",
        "config_patch",
        "safe_mode",
        "soft_reset",
        "factory_reset",
        "heartbeat_ping",
        "audio_test",
        "tts_say",
        "eye_update",
      ];

      if (!espAllowedCommands.includes(command_type)) {
        return res.status(400).json({
          success: false,
          message: "command unsupported for ESP runtime",
          device_type: deviceType,
          command_type,
        });
      }
    }

    let commandPayload = payload || null;

    // ESP payload tuning.
    // Pi receives payloads unchanged. ESP gets lighter/safe defaults for supported commands.
    if (deviceType === "esp" && commandPayload && typeof commandPayload === "object") {
      commandPayload = { ...commandPayload };

      if (command_type === "eye_update") {
        commandPayload.fps = commandPayload.fps || 10;
        commandPayload.runtime_mode = commandPayload.runtime_mode || "esp_light";
      }

      if (command_type === "tts_say") {
        commandPayload.streaming = false;
        commandPayload.runtime_mode = commandPayload.runtime_mode || "cloud_assisted";
      }

      if (command_type === "audio_test") {
        commandPayload.duration_seconds = Math.min(
          Number(commandPayload.duration_seconds || 3),
          5
        );
      }

      if (command_type === "config_patch") {
        commandPayload.runtime_target = commandPayload.runtime_target || "esp";
      }

      commandPayload.device_type = commandPayload.device_type || "esp";
      commandPayload.runtime = commandPayload.runtime || (device.runtime || "esp32");
    }

    const result = await pool.query(
      `INSERT INTO device_commands (device_id, command_type, payload)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [device_id, command_type, commandPayload ? JSON.stringify(commandPayload) : null]
    );

    res.json({
      success: true,
      message: "command queued",
      command: result.rows[0],
    });
  } catch (err) {
    console.error("queue command failed:", err);
    res.status(500).json({ message: "failed to queue command" });
  }
});

// Pi marks command complete
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
      command: result.rows[0],
    });
  } catch (err) {
    console.error("complete command failed:", err);
    res.status(500).json({ message: "failed to update command" });
  }
});

module.exports = router;