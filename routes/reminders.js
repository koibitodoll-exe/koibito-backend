const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const notify = require("../utils/notify");
const jwt = require("jsonwebtoken");

let reminderColumnsCache = null;

async function getReminderColumns() {
  if (reminderColumnsCache) return reminderColumnsCache;

  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'reminders'`
  );

  reminderColumnsCache = new Set(result.rows.map((row) => row.column_name));
  return reminderColumnsCache;
}

function hasColumn(columns, name) {
  return columns.has(name);
}

function buildSelectClause(columns) {
  const wanted = [
    "id",
    "user_id",
    "title",
    "date",
    "time",
    "place",
    "notes",
    "bell_enabled",
    "created_by",
    "created_by_name",
    "koibito_id",
    "koibito_note",
    "completed",
    "created_at",
    "updated_at",
  ];

  return wanted.filter((name) => hasColumn(columns, name)).join(", ");
}

function mapReminderRow(row) {
  return {
    ...row,
    bell_enabled:
      typeof row.bell_enabled === "boolean" ? row.bell_enabled : true,
    created_by_name: row.created_by_name || null,
    koibito_note: row.koibito_note || null,
    place: row.place || null,
    notes: row.notes || null,
  };
}

async function resolveKoibitoName(koibitoId, fallbackName = null) {
  if (fallbackName) return fallbackName;
  if (!koibitoId) return null;

  const koibitoResult = await pool.query(
    `SELECT name FROM koibitos WHERE id = $1 LIMIT 1`,
    [koibitoId]
  );

  return koibitoResult.rows[0]?.name || null;
}

// GET /reminders
router.get("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;

  try {
    const columns = await getReminderColumns();
    const selectClause = buildSelectClause(columns);

    const result = await pool.query(
      `SELECT ${selectClause}
       FROM reminders
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      reminders: result.rows.map(mapReminderRow),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch reminders" });
  }
});

// POST /reminders
router.post("/", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const {
    title,
    date = null,
    time = null,
    place = null,
    notes = null,
    bell_enabled,
    bellEnabled,
    created_by = "user",
    created_by_name = null,
    koibito_id = null,
    koibito_note = null,
  } = req.body;

  if (!title || !String(title).trim()) {
    return res.status(400).json({ message: "title is required" });
  }

  try {
    const columns = await getReminderColumns();
    const insertColumns = ["user_id", "title", "date", "time", "created_by", "koibito_id"];
    const values = [userId, String(title).trim(), date, time, created_by, koibito_id];

    if (hasColumn(columns, "place")) {
      insertColumns.push("place");
      values.push(place ? String(place).trim() : null);
    }

    if (hasColumn(columns, "notes")) {
      insertColumns.push("notes");
      values.push(notes ? String(notes).trim() : null);
    }

    if (hasColumn(columns, "bell_enabled")) {
      insertColumns.push("bell_enabled");
      values.push(
        typeof bell_enabled === "boolean"
          ? bell_enabled
          : typeof bellEnabled === "boolean"
          ? bellEnabled
          : true
      );
    }

    let resolvedKoibitoName = null;
    if (created_by === "koibito") {
      resolvedKoibitoName = await resolveKoibitoName(
        koibito_id,
        created_by_name ? String(created_by_name).trim() : null
      );
    }

    if (hasColumn(columns, "created_by_name")) {
      insertColumns.push("created_by_name");
      values.push(
        created_by === "koibito"
          ? resolvedKoibitoName
          : created_by_name
          ? String(created_by_name).trim()
          : null
      );
    }

    if (hasColumn(columns, "koibito_note")) {
      insertColumns.push("koibito_note");
      values.push(koibito_note ? String(koibito_note).trim() : null);
    }

    const placeholders = insertColumns.map((_, idx) => `$${idx + 1}`).join(", ");
    const selectClause = buildSelectClause(columns);

    const result = await pool.query(
      `INSERT INTO reminders (${insertColumns.join(", ")})
       VALUES (${placeholders})
       RETURNING ${selectClause}`,
      values
    );

    const reminder = mapReminderRow(result.rows[0]);

    if (created_by === "koibito") {
      const koibitoName = resolvedKoibitoName || "Your Koibito";
      await notify(
        userId,
        "reminder",
        "New Reminder",
        `${koibitoName} posted a reminder for you. You can see it in your reminders.`,
        {
          reminder_id: reminder.id,
          koibito_id,
          created_by_name: koibitoName,
          koibito_note: reminder.koibito_note,
        }
      );
    }

    res.json({
      success: true,
      message: "Reminder created",
      reminder,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to create reminder" });
  }
});

// POST /reminders/device-create
router.post("/device-create", async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Invalid token format" });
  }

  const {
    title,
    date = null,
    time = null,
    place = null,
    notes = null,
    koibito_note = null,
  } = req.body;

  if (!title) {
    return res.status(400).json({ message: "title is required" });
  }

  try {
    const decoded = jwt.verify(token, "supersecretkey");

    const deviceId =
      decoded.device_id ||
      decoded.deviceId ||
      decoded.id;

    if (!deviceId) {
      return res.status(401).json({ message: "Token missing device id" });
    }

    const deviceResult = await pool.query(
      `SELECT device_id, user_id, koibito_id
       FROM devices
       WHERE device_id = $1
       LIMIT 1`,
      [deviceId]
    );

    if (deviceResult.rows.length === 0) {
      return res.status(404).json({ message: "Device not linked" });
    }

    const { user_id, koibito_id } = deviceResult.rows[0];

    let koibitoName = "Koibito";

    if (koibito_id) {
      const koibitoResult = await pool.query(
        `SELECT name FROM koibitos WHERE id = $1 LIMIT 1`,
        [koibito_id]
      );

      koibitoName = koibitoResult.rows[0]?.name || "Koibito";
    }

    const columnsResult = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'reminders'`
    );

    const columns = new Set(columnsResult.rows.map((row) => row.column_name));

    const insertColumns = ["user_id", "title", "date", "time", "created_by", "koibito_id"];
    const values = [user_id, title, date, time, "koibito", koibito_id];

    if (columns.has("place")) {
      insertColumns.push("place");
      values.push(place);
    }

    if (columns.has("notes")) {
      insertColumns.push("notes");
      values.push(notes);
    }

    if (columns.has("created_by_name")) {
      insertColumns.push("created_by_name");
      values.push(koibitoName);
    }

    if (columns.has("koibito_note")) {
      insertColumns.push("koibito_note");
      values.push(koibito_note);
    }

    const placeholders = insertColumns.map((_, index) => `$${index + 1}`).join(", ");

    const result = await pool.query(
      `INSERT INTO reminders (${insertColumns.join(", ")})
       VALUES (${placeholders})
       RETURNING *`,
      values
    );

    await notify(
      user_id,
      "reminder",
      "New Reminder",
      `${koibitoName} posted a reminder for you. You can see it in your reminders.`,
      {
        reminder_id: result.rows[0].id,
        koibito_id,
      }
    );

    res.json({
      success: true,
      message: "Reminder created",
      reminder: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: "Invalid or expired device token" });
  }
});

// PATCH /reminders/:id
router.patch("/:id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const reminderId = req.params.id;
  const {
    title = null,
    date = null,
    time = null,
    place = null,
    notes = null,
    bell_enabled,
    bellEnabled,
    completed = null,
    created_by_name = null,
    koibito_note = null,
  } = req.body;

  try {
    const columns = await getReminderColumns();
    const updates = [];
    const values = [];

    const pushUpdate = (column, value) => {
      values.push(value);
      updates.push(`${column} = COALESCE($${values.length}, ${column})`);
    };

    pushUpdate("title", title);
    pushUpdate("date", date);
    pushUpdate("time", time);

    if (hasColumn(columns, "place")) pushUpdate("place", place);
    if (hasColumn(columns, "notes")) pushUpdate("notes", notes);

    if (hasColumn(columns, "bell_enabled")) {
      pushUpdate(
        "bell_enabled",
        typeof bell_enabled === "boolean"
          ? bell_enabled
          : typeof bellEnabled === "boolean"
          ? bellEnabled
          : null
      );
    }

    if (hasColumn(columns, "completed")) pushUpdate("completed", completed);
    if (hasColumn(columns, "created_by_name")) pushUpdate("created_by_name", created_by_name);
    if (hasColumn(columns, "koibito_note")) pushUpdate("koibito_note", koibito_note);
    if (hasColumn(columns, "updated_at")) updates.push("updated_at = now()");

    values.push(reminderId, userId);
    const selectClause = buildSelectClause(columns);

    const result = await pool.query(
      `UPDATE reminders
       SET ${updates.join(", ")}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${selectClause}`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    res.json({
      success: true,
      message: "Reminder updated",
      reminder: mapReminderRow(result.rows[0]),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update reminder" });
  }
});

// DELETE /reminders/:id
router.delete("/:id", authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const reminderId = req.params.id;

  try {
    const columns = await getReminderColumns();
    const selectClause = buildSelectClause(columns);

    const result = await pool.query(
      `DELETE FROM reminders
       WHERE id = $1 AND user_id = $2
       RETURNING ${selectClause}`,
      [reminderId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Reminder not found" });
    }

    res.json({
      success: true,
      message: "Reminder deleted",
      reminder: mapReminderRow(result.rows[0]),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to delete reminder" });
  }
});

module.exports = router;