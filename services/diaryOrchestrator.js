const pool = require('../db');
const { generateDiary } = require('./diaryGenerator');

async function isPiOnline(koibitoId) {
  const result = await pool.query(
    `
    SELECT is_online, updated_at
    FROM device_sync_state
    WHERE koibito_id = $1
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [koibitoId]
  );

  if (!result.rows.length) return false;

  const row = result.rows[0];
  const ageMs = Date.now() - new Date(row.updated_at).getTime();

  return row.is_online === true && ageMs < 2 * 60 * 1000;
}

async function getDiarySettings(userId) {
  const result = await pool.query(
    `
    SELECT *
    FROM app_settings
    WHERE user_id = $1
    LIMIT 1
    `,
    [userId]
  );

  const settings = result.rows[0] || {};

  return {
    enabled: settings.diary_enabled !== false,
    frequency: settings.diary_frequency || 'weekly',
    lastGeneratedAt: settings.diary_last_generated_at || null,
  };
}

async function getPrimaryKoibito(userId) {
  const result = await pool.query(
    `
    SELECT id
    FROM koibitos
    WHERE user_id = $1
      AND is_primary = true
    LIMIT 1
    `,
    [userId]
  );

  return result.rows[0]?.id || null;
}

function daysForFrequency(frequency) {
  if (frequency === 'daily') return 1;
  if (frequency === 'monthly') return 30;
  return 7;
}

function isDue(lastGeneratedAt, frequency) {
  if (!lastGeneratedAt) return true;

  const days = daysForFrequency(frequency);
  const ageMs = Date.now() - new Date(lastGeneratedAt).getTime();

  return ageMs >= days * 24 * 60 * 60 * 1000;
}

async function runCloudDiaryIfNeeded({ userId, koibitoId }) {
  const settings = await getDiarySettings(userId);

  if (!settings.enabled) {
    return { success: false, skipped: true, reason: 'diary_off' };
  }

  const primaryKoibitoId = await getPrimaryKoibito(userId);

  if (!primaryKoibitoId || Number(primaryKoibitoId) !== Number(koibitoId)) {
    return { success: false, skipped: true, reason: 'not_primary_koibito' };
  }

  if (!isDue(settings.lastGeneratedAt, settings.frequency)) {
    return { success: false, skipped: true, reason: 'not_due' };
  }

  const piOnline = await isPiOnline(koibitoId);

  if (piOnline) {
    return { success: false, skipped: true, reason: 'pi_online' };
  }

  const result = await generateDiary({
    userId,
    koibitoId,
    days: daysForFrequency(settings.frequency),
  });

  if (result.success) {
    await pool.query(
      `
      UPDATE app_settings
      SET diary_last_generated_at = NOW()
      WHERE user_id = $1
      `,
      [userId]
    );
  }

  return result;
}

module.exports = {
  isPiOnline,
  runCloudDiaryIfNeeded,
};