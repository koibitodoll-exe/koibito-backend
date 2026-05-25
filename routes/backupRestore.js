const express = require("express");
const router = express.Router();

const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const DEFAULT_BACKUP_SETTINGS = {
  auto_backup: true,
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

async function getBackupSettings(userId) {
  const result = await pool.query(
    `SELECT settings_json, updated_at
     FROM backup_settings
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );

  if (result.rows.length === 0) {
    return {
      settings: DEFAULT_BACKUP_SETTINGS,
      updated_at: null,
    };
  }

  return {
    settings: deepMerge(
      DEFAULT_BACKUP_SETTINGS,
      result.rows[0].settings_json || {},
    ),
    updated_at: result.rows[0].updated_at,
  };
}

async function getOwnedKoibito(userId, koibitoId) {
  const result = await pool.query(
    `SELECT
       k.id,
       k.name,
       k.user_id,
       d.device_id
     FROM koibitos k
     LEFT JOIN devices d
       ON d.koibito_id = k.id
     WHERE k.id = $1
       AND k.user_id = $2
     LIMIT 1`,
    [koibitoId, userId],
  );

  return result.rows[0] || null;
}

async function getLatestBackup(userId, koibitoId) {
  const result = await pool.query(
    `SELECT
       id,
       user_id,
       koibito_id,
       backup_json,
       created_at,
       restored_at
     FROM koibito_backups
     WHERE user_id = $1
       AND koibito_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, koibitoId],
  );

  return result.rows[0] || null;
}

async function queueRestoreCommand(deviceId, koibitoId, backupId, backupJson) {
  if (!deviceId) return null;

  const result = await pool.query(
    `INSERT INTO device_commands
       (device_id, command_type, payload)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [
      deviceId,
      "restore_koibito",
      JSON.stringify({
        koibito_id: koibitoId,
        backup_id: backupId,
        backup_json: backupJson,
        overwrite: true,
      }),
    ],
  );

  return result.rows[0];
}

// GET /backup
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const backupSettings = await getBackupSettings(userId);

    const koibitosResult = await pool.query(
      `SELECT
         k.id,
         k.name,
         k.updated_at,
         latest_backup.id AS latest_backup_id,
         latest_backup.created_at AS last_backup_at
       FROM koibitos k
       LEFT JOIN LATERAL (
         SELECT id, created_at
         FROM koibito_backups kb
         WHERE kb.koibito_id = k.id
           AND kb.user_id = $1
         ORDER BY created_at DESC
         LIMIT 1
       ) latest_backup ON TRUE
       WHERE k.user_id = $1
       ORDER BY k.updated_at DESC`,
      [userId],
    );

    return res.json({
      success: true,
      settings: backupSettings.settings,
      updated_at: backupSettings.updated_at,
      koibitos: koibitosResult.rows,
    });
  } catch (err) {
    console.error("GET backup failed:", err);
    return res.status(500).json({
      message: "Failed to fetch backup data",
    });
  }
});

// PATCH /backup/settings
router.patch("/settings", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const patch = req.body || {};

  try {
    const current = await getBackupSettings(userId);
    const mergedSettings = deepMerge(current.settings, patch);

    const result = await pool.query(
      `INSERT INTO backup_settings
         (user_id, settings_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET
         settings_json = EXCLUDED.settings_json,
         updated_at = NOW()
       RETURNING settings_json, updated_at`,
      [userId, mergedSettings],
    );

    return res.json({
      success: true,
      settings: deepMerge(
        DEFAULT_BACKUP_SETTINGS,
        result.rows[0].settings_json || {},
      ),
      updated_at: result.rows[0].updated_at,
    });
  } catch (err) {
    console.error("PATCH backup settings failed:", err);
    return res.status(500).json({
      message: "Failed to save backup settings",
    });
  }
});

// POST /backup/koibitos/:koibito_id/create
router.post("/koibitos/:koibito_id/create", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { koibito_id } = req.params;
  const { backup_json = null } = req.body || {};

  try {
    const koibito = await getOwnedKoibito(userId, koibito_id);

    if (!koibito) {
      return res.status(404).json({
        message: "Koibito not found",
      });
    }

    const snapshot =
      backup_json ||
      {
        koibito: {
          id: koibito.id,
          name: koibito.name,
        },
        note: "Manual backend backup snapshot placeholder",
      };

    const result = await pool.query(
      `INSERT INTO koibito_backups
         (user_id, koibito_id, backup_json, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [userId, koibito_id, snapshot],
    );

    return res.json({
      success: true,
      message: "Koibito backup created",
      backup: result.rows[0],
    });
  } catch (err) {
    console.error("Create koibito backup failed:", err);
    return res.status(500).json({
      message: "Failed to create Koibito backup",
    });
  }
});

// GET /backup/koibitos
router.get("/koibitos", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT
         k.id,
         k.name,
         latest_backup.id AS latest_backup_id,
         latest_backup.created_at AS last_backup_at,
         latest_backup.restored_at AS last_restored_at
       FROM koibitos k
       LEFT JOIN LATERAL (
         SELECT id, created_at, restored_at
         FROM koibito_backups kb
         WHERE kb.koibito_id = k.id
           AND kb.user_id = $1
         ORDER BY created_at DESC
         LIMIT 1
       ) latest_backup ON TRUE
       WHERE k.user_id = $1
       ORDER BY k.name ASC`,
      [userId],
    );

    return res.json({
      success: true,
      koibitos: result.rows,
    });
  } catch (err) {
    console.error("GET backup koibitos failed:", err);
    return res.status(500).json({
      message: "Failed to fetch Koibito backup list",
    });
  }
});

// POST /backup/restore/:koibito_id
router.post("/restore/:koibito_id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { koibito_id } = req.params;

  try {
    const koibito = await getOwnedKoibito(userId, koibito_id);

    if (!koibito) {
      return res.status(404).json({
        message: "Koibito not found",
      });
    }

    const latestBackup = await getLatestBackup(userId, koibito_id);

    if (!latestBackup) {
      return res.status(404).json({
        message: "No backup available for this Koibito",
      });
    }

    const command = await queueRestoreCommand(
      koibito.device_id,
      koibito.id,
      latestBackup.id,
      latestBackup.backup_json,
    );

    await pool.query(
      `UPDATE koibito_backups
       SET restored_at = NOW()
       WHERE id = $1`,
      [latestBackup.id],
    );

    return res.json({
      success: true,
      message: `${koibito.name} restore queued`,
      koibito_id: koibito.id,
      backup_id: latestBackup.id,
      pi_sync_queued: Boolean(command),
    });
  } catch (err) {
    console.error("Restore koibito failed:", err);
    return res.status(500).json({
      message: "Failed to restore Koibito",
    });
  }
});

// POST /backup/restore-all
router.post("/restore-all", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const koibitosResult = await pool.query(
      `SELECT
         k.id,
         k.name,
         d.device_id
       FROM koibitos k
       LEFT JOIN devices d
         ON d.koibito_id = k.id
       WHERE k.user_id = $1`,
      [userId],
    );

    const restored = [];
    const skipped = [];

    for (const koibito of koibitosResult.rows) {
      const latestBackup = await getLatestBackup(userId, koibito.id);

      if (!latestBackup) {
        skipped.push({
          koibito_id: koibito.id,
          name: koibito.name,
          reason: "no_backup",
        });
        continue;
      }

      const command = await queueRestoreCommand(
        koibito.device_id,
        koibito.id,
        latestBackup.id,
        latestBackup.backup_json,
      );

      await pool.query(
        `UPDATE koibito_backups
         SET restored_at = NOW()
         WHERE id = $1`,
        [latestBackup.id],
      );

      restored.push({
        koibito_id: koibito.id,
        name: koibito.name,
        backup_id: latestBackup.id,
        pi_sync_queued: Boolean(command),
      });
    }

    return res.json({
      success: true,
      message: "Restore all completed",
      restored,
      skipped,
    });
  } catch (err) {
    console.error("Restore all failed:", err);
    return res.status(500).json({
      message: "Failed to restore all Koibitos",
    });
  }
});

module.exports = router;