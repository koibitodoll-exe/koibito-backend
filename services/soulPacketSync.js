const pool = require("../db");
const { buildSoulPacket } = require("./soulPacketBuilder");

async function getKoibitoDeviceIds(koibitoId) {
  const result = await pool.query(
    `
    SELECT device_id
    FROM devices
    WHERE koibito_id = $1
      AND device_id IS NOT NULL
    `,
    [koibitoId]
  );

  return result.rows.map((row) => row.device_id);
}

async function saveEssenceSnapshot(koibitoId, userId, soulPacket) {
  const essence = soulPacket.essence || {};

  await pool.query(
    `
    INSERT INTO koibito_essence
      (koibito_id, user_id, essence_json, updated_at)
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (koibito_id, user_id)
    DO UPDATE SET
      essence_json = EXCLUDED.essence_json,
      updated_at = NOW()
    `,
    [koibitoId, userId, JSON.stringify(essence)]
  );
}

async function saveBackupSnapshot(koibitoId, userId, soulPacket) {
  await pool.query(
    `
    INSERT INTO koibito_backups
      (koibito_id, user_id, backup_json, backup_type, created_at)
    VALUES ($1, $2, $3, 'auto_soul_packet', NOW())
    `,
    [koibitoId, userId, JSON.stringify(soulPacket)]
  );
}

async function queuePiSoulPacket(koibitoId, soulPacket) {
  const deviceIds = await getKoibitoDeviceIds(koibitoId);

  for (const deviceId of deviceIds) {
    await pool.query(
      `
      INSERT INTO device_commands
        (device_id, command_type, payload, status, created_at)
      VALUES ($1, 'config_patch', $2, 'pending', NOW())
      `,
      [
        deviceId,
        JSON.stringify({
          scope: "soul_packet",
          overwrite: true,
          soul_packet: soulPacket,
        }),
      ]
    );
  }

  return deviceIds.length;
}

async function writeSyncEvent(koibitoId, userId, soulPacket) {
  await pool.query(
    `
    INSERT INTO sync_events
      (koibito_id, user_id, event_type, payload, created_at)
    VALUES ($1, $2, 'soul_packet_updated', $3, NOW())
    `,
    [koibitoId, userId, JSON.stringify(soulPacket)]
  );
}

async function syncSoulPacket(koibitoId, userId) {
  if (!koibitoId || !userId) {
    throw new Error("syncSoulPacket requires koibitoId and userId");
  }

  const soulPacket = await buildSoulPacket(koibitoId, userId);

  await saveEssenceSnapshot(koibitoId, userId, soulPacket);
  await saveBackupSnapshot(koibitoId, userId, soulPacket);

  const queuedDevices = await queuePiSoulPacket(koibitoId, soulPacket);

  await writeSyncEvent(koibitoId, userId, soulPacket);

  return {
    success: true,
    koibito_id: koibitoId,
    user_id: userId,
    queued_devices: queuedDevices,
    soul_packet: soulPacket,
  };
}

module.exports = {
  syncSoulPacket,
};