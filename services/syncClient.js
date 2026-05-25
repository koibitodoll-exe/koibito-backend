import io from 'socket.io-client';

let socket = null;

export async function startKoibitoSync({
  koibitoId,
  lastSyncedAt,
  backendUrl,
  applySyncEvent
}) {

  try {

    const res = await fetch(
      `${backendUrl}/sync/${koibitoId}?since=${encodeURIComponent(
        lastSyncedAt || '1970-01-01T00:00:00.000Z'
      )}`
    );

    const data = await res.json();

    for (const event of data.sync_events || []) {
      await applySyncEvent(event);
    }

    socket = io(backendUrl, {
      transports: ['websocket']
    });

    socket.on(
      'connect',
      () => {

        socket.emit(
          'join_koibito',
          {
            koibitoId
          }
        );

        console.log(
          '👁️ joined live sync:',
          koibitoId
        );

      }
    );

    socket.on(
      'sync_update',
      async(event)=>{

        await applySyncEvent(
          event
        );

      }
    );

  } catch(err){

console.error(
'Sync ritual failed:',
err
);

}

}

export function stopKoibitoSync(){

if(socket){

socket.disconnect();

socket=null;

}

}