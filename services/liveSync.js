const pool = require('../db');

let io = null;

function initializeSocket(socketServer) {
  io = socketServer;
}

function getSocketServer() {
  return io;
}

function emitRoomEvent(roomName, eventName, payload = {}) {
  if (!io || !roomName || !eventName) return false;

  io.to(roomName).emit(eventName, {
    ...payload,
    emitted_at: new Date().toISOString(),
  });

  return true;
}

function emitChatRoomUpdate(roomId, eventType, payload = {}) {
  return emitRoomEvent(`chat:room:${roomId}`, 'chat_update', {
    event_type: eventType,
    room_id: String(roomId),
    payload,
  });
}

function emitGroupUpdate(groupId, eventType, payload = {}) {
  return emitRoomEvent(`group:${groupId}`, 'group_update', {
    event_type: eventType,
    group_id: String(groupId),
    payload,
  });
}

function emitKoibitoChatUpdate(koibitoId, userId, eventType, payload = {}) {
  return emitRoomEvent(`koibito-chat:${koibitoId}:${userId}`, 'koibito_chat_update', {
    event_type: eventType,
    koibito_id: String(koibitoId),
    user_id: String(userId),
    payload,
  });
}

function emitSessionUpdate(sessionId, eventType, payload = {}) {
  return emitRoomEvent(`session:${sessionId}`, 'session_update', {
    event_type: eventType,
    session_id: String(sessionId),
    payload,
  });
}

async function emitSyncEvent({
  koibitoId,
  eventType,
  payload = {},
  source = ''
}) {
  await pool.query(
    `
    INSERT INTO sync_events(
      koibito_id,
      event_type,
      payload,
      source
    )
    VALUES($1, $2, $3, $4)
    `,
    [koibitoId, eventType, payload, source]
  );

  emitRoomEvent(`koibito:${koibitoId}`, 'sync_update', {
    event_type: eventType,
    payload,
  });
}

async function updateDeviceSync({
  hardwareId,
  koibitoId
}) {
  await pool.query(
    `
    INSERT INTO device_sync_state(
      hardware_id,
      koibito_id,
      last_synced_at,
      is_online
    )
    VALUES($1, $2, NOW(), TRUE)
    ON CONFLICT(hardware_id)
    DO UPDATE SET
      last_synced_at = NOW(),
      is_online = TRUE,
      updated_at = NOW()
    `,
    [hardwareId, koibitoId]
  );
}

module.exports = {
  initializeSocket,
  getSocketServer,
  emitRoomEvent,
  emitChatRoomUpdate,
  emitGroupUpdate,
  emitKoibitoChatUpdate,
  emitSessionUpdate,
  emitSyncEvent,
  updateDeviceSync,
};
