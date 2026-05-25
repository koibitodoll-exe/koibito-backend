const pool = require('../db');

async function getBadgeDefinition(badgeCode) {
  const result = await pool.query(
    `
    SELECT id, code, name, category
    FROM badge_definitions
    WHERE code = $1
    LIMIT 1
    `,
    [String(badgeCode).toUpperCase()]
  );

  return result.rows[0] || null;
}

async function unlockKoibitoBadge(userId, koibitoId, badgeCode) {
  if (!userId || !koibitoId || !badgeCode) return null;

  const badge = await getBadgeDefinition(badgeCode);

  if (!badge) {
    console.warn('[badgeUnlockService] Missing badge definition:', badgeCode);
    return null;
  }

  const result = await pool.query(
    `
    INSERT INTO koibito_badges (user_id, koibito_id, badge_id, unlocked_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT DO NOTHING
    RETURNING id, unlocked_at
    `,
    [userId, koibitoId, badge.id]
  );

  return {
    owner: 'koibito',
    unlocked: result.rows.length > 0,
    badge,
  };
}

async function unlockUserBadge(userId, badgeCode) {
  if (!userId || !badgeCode) return null;

  const badge = await getBadgeDefinition(badgeCode);

  if (!badge) {
    console.warn('[badgeUnlockService] Missing badge definition:', badgeCode);
    return null;
  }

  const result = await pool.query(
    `
    INSERT INTO user_badges (user_id, badge_id, unlocked_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT DO NOTHING
    RETURNING id, unlocked_at
    `,
    [userId, badge.id]
  );

  return {
    owner: 'user',
    unlocked: result.rows.length > 0,
    badge,
  };
}

async function unlockBadge(userId, koibitoId, badgeCode, owner = 'koibito') {
  if (owner === 'user') {
    return unlockUserBadge(userId, badgeCode);
  }

  return unlockKoibitoBadge(userId, koibitoId, badgeCode);
}

module.exports = {
  getBadgeDefinition,
  unlockBadge,
  unlockKoibitoBadge,
  unlockUserBadge,
};