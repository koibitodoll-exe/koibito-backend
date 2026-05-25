const pool = require('../db');

function levelCap(level) {
  if (level <= 10) return 10;
  if (level <= 30) return 12;
  if (level <= 50) return 15;
  if (level <= 75) return 18;
  return 20;
}

async function ensureEq(userId, koibitoId) {
  await pool.query(
    `
    INSERT INTO user_koibito_eq (user_id, koibito_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, koibito_id) DO NOTHING
    `,
    [userId, koibitoId]
  );

  await pool.query(
    `
    INSERT INTO daily_eq_limits (user_id, koibito_id, date_key)
    VALUES ($1, $2, CURRENT_DATE)
    ON CONFLICT (user_id, koibito_id, date_key) DO NOTHING
    `,
    [userId, koibitoId]
  );
}

async function addRelationshipStat(userId, koibitoId, field, dailyField, amount) {
  if (!amount || amount <= 0) return;

  await ensureEq(userId, koibitoId);

  const eqRes = await pool.query(
    `
    SELECT relationship_level
    FROM user_koibito_eq
    WHERE user_id = $1 AND koibito_id = $2
    `,
    [userId, koibitoId]
  );

  const level = eqRes.rows[0]?.relationship_level || 1;
  const cap = levelCap(level);

  const limitRes = await pool.query(
    `
    SELECT ${dailyField}
    FROM daily_eq_limits
    WHERE user_id = $1
      AND koibito_id = $2
      AND date_key = CURRENT_DATE
    `,
    [userId, koibitoId]
  );

  const used = limitRes.rows[0]?.[dailyField] || 0;
  const allowed = Math.max(0, cap - used);
  const gain = Math.min(amount, allowed);

  if (gain <= 0) return;

  await pool.query(
    `
    UPDATE user_koibito_eq
    SET ${field} = LEAST(100, COALESCE(${field}, 0) + $3),
        relationship_xp = COALESCE(relationship_xp, 0) + $3,
        updated_at = NOW()
    WHERE user_id = $1 AND koibito_id = $2
    `,
    [userId, koibitoId, gain]
  );

  await pool.query(
    `
    UPDATE daily_eq_limits
    SET ${dailyField} = COALESCE(${dailyField}, 0) + $3
    WHERE user_id = $1
      AND koibito_id = $2
      AND date_key = CURRENT_DATE
    `,
    [userId, koibitoId, gain]
  );
}

async function processEqFromEvent(event) {
  const { user_id, koibito_id, event_type, metadata = {} } = event;

  if (!user_id || !koibito_id || !event_type) return;

  switch (event_type) {
    case 'chat.message_sent':
      await addRelationshipStat(user_id, koibito_id, 'trust', 'trust_gained', 1);
      break;

    case 'chat.meaningful_message':
      await addRelationshipStat(user_id, koibito_id, 'trust', 'trust_gained', 2);
      await addRelationshipStat(user_id, koibito_id, 'comfort', 'comfort_gained', 1);
      break;

    case 'chat.long_session':
      await addRelationshipStat(user_id, koibito_id, 'trust', 'trust_gained', 1);
      break;

    case 'emotion.comfort_detected':
      await addRelationshipStat(user_id, koibito_id, 'comfort', 'comfort_gained', 2);
      await addRelationshipStat(user_id, koibito_id, 'trust', 'trust_gained', 1);
      break;

    case 'emotion.vent_detected':
      await addRelationshipStat(user_id, koibito_id, 'comfort', 'comfort_gained', 2);
      await addRelationshipStat(user_id, koibito_id, 'trust', 'trust_gained', 2);
      break;

    case 'emotion.gratitude_detected':
      await addRelationshipStat(user_id, koibito_id, 'trust', 'trust_gained', 1);
      break;

    case 'emotion.flirt_detected':
    case 'emotion.affection_detected':
      await addRelationshipStat(user_id, koibito_id, 'romance', 'romance_gained', 2);
      break;

    case 'activity.game_completed':
      await addRelationshipStat(user_id, koibito_id, 'chaos', 'chaos_gained', 1);
      break;

    case 'activity.game_won':
    case 'activity.game_lost':
    case 'activity.game_draw':
      await addRelationshipStat(user_id, koibito_id, 'chaos', 'chaos_gained', 1);
      break;

    case 'activity.rp_completed': {
      const rpType = String(metadata.rp_type || metadata.scenario_type || '').toLowerCase();

      if (rpType === 'romantic') {
        await addRelationshipStat(user_id, koibito_id, 'romance', 'romance_gained', 2);
      } else if (rpType === 'comfort') {
        await addRelationshipStat(user_id, koibito_id, 'comfort', 'comfort_gained', 2);
      } else if (rpType === 'chaos' || rpType === 'comedy') {
        await addRelationshipStat(user_id, koibito_id, 'chaos', 'chaos_gained', 2);
      } else if (rpType === 'mentor' || rpType === 'learning') {
        await addRelationshipStat(user_id, koibito_id, 'mentorship', 'mentorship_gained', 2);
      }

      break;
    }

    case 'behavior.quick_return_detected':
      await addRelationshipStat(user_id, koibito_id, 'dependency', 'dependency_gained', 1);
      break;

    case 'behavior.koibito_opened':
      await addRelationshipStat(user_id, koibito_id, 'dependency', 'dependency_gained', 1);
      break;

    case 'mood.user_checkin_completed':
      await addRelationshipStat(user_id, koibito_id, 'trust', 'trust_gained', 1);
      break;

    default:
      break;
  }
}

module.exports = {
  processEqFromEvent,
  addRelationshipStat,
  ensureEq,
};