import { apiFetch } from './apiClient';

export async function emitEvent(event_type, options = {}) {
  return apiFetch('/events', {
    method: 'POST',
    body: JSON.stringify({
      event_type,
      koibito_id: options.koibito_id || null,
      metadata: options.metadata || {},
    }),
  });
}