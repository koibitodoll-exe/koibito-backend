const pool = require('../db');

function xpNeeded(level) {
  if (level <= 10) return 30;
  if (level <= 30) return 50;
  if (level <= 50) return 100;
  if (level <= 75) return 150;
  return 250;
}

function relationshipLabel(eq) {
  const { affection, trust_score, comfort, chaos, romance, mentorship } = eq;

  if (comfort >= 70 && trust_score >= 60) return 'Safe Haven';
  if (chaos >= 70 && affection >= 50) return 'Chaos Besties';
  if (romance >= 70 && affection >= 60) return 'Soft Spot';
  if (mentorship >= 70) return 'Mentorship';
  if (trust_score >= 70) return 'Confidante';
  if (affection >= 60) return 'BFF';

  return 'Familiar';
}

async function ensureRelationshipLabelColumn() {
  await pool.query(`
    ALTER TABLE user_koibito_eq
    ADD COLUMN IF NOT EXISTS relationship_label TEXT DEFAULT 'Familiar'
  `);
}

async function runRegulator(event) {
  const { user_id, koibito_id } = event;
  if (!user_id || !koibito_id) return;

  await ensureRelationshipLabelColumn();

  const res = await pool.query(
    `
    SELECT *
    FROM user_koibito_eq
    WHERE user_id=$1 AND koibito_id=$2
    `,
    [user_id, koibito_id]
  );

  const eq = res.rows[0];
  if (!eq) return;

  let level = eq.relationship_level || 1;
  let xp = eq.relationship_xp || 0;

  while (xp >= xpNeeded(level) && level < 100) {
    xp -= xpNeeded(level);
    level += 1;
  }

  const label = relationshipLabel(eq);

  await pool.query(
    `
    UPDATE user_koibito_eq
    SET relationship_level=$3,
        relationship_xp=$4,
        relationship_label=$5,
        updated_at=NOW()
    WHERE user_id=$1 AND koibito_id=$2
    `,
    [user_id, koibito_id, level, xp, label]
  );
}

module.exports = { runRegulator };