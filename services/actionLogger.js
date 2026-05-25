const pool = require("../db");
const badgeEventMap = require("./badgeEventMap");

function normalizeActionForBadge(actionType) {
  return badgeEventMap[actionType] || actionType;
}

async function logAction({
  user_id = null,
  koibito_id = null,
  device_id = null,
  actor_type = "user",
  source = "backend",
  action_type,
  target_type = null,
  target_id = null,
  method = null,
  route = null,
  status_code = null,
  metadata = {},
}) {
  if (!action_type) return null;

  try {
    const normalizedActionType = normalizeActionForBadge(action_type);

    const result = await pool.query(
      `INSERT INTO user_action_logs (
        user_id, koibito_id, device_id,
        actor_type, source, action_type,
        target_type, target_id,
        method, route, status_code,
        metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
      RETURNING *`,
      [
        user_id,
        koibito_id,
        device_id,
        actor_type,
        source,
        normalizedActionType,
        target_type,
        target_id,
        method,
        route,
        status_code,
        JSON.stringify({
          ...(metadata || {}),
          raw_action_type: action_type,
        }),
      ]
    );

    const loggedAction = result.rows[0];

    try {
      const { process } = require("./badgeEngine");

      await process({
        user_id,
        koibito_id,
        device_id,
        event_type: normalizedActionType,
        trigger_key: normalizedActionType,
        source: "action_logger",
        metadata: {
          ...(metadata || {}),
          raw_action_type: action_type,
          action_log_id: loggedAction.id,
          target_type,
          target_id,
        },
      });
    } catch (badgeErr) {
      console.warn("[actionLogger] badge processing failed:", badgeErr.message);
    }

    return loggedAction;
  } catch (err) {
    console.warn("[actionLogger] failed:", err.message);
    return null;
  }
}

module.exports = {
  logAction,
  normalizeActionForBadge,
};
