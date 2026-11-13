/** Validate saved IDs while preserving devices that have not been restored yet. */
export function loadDeviceOrder(storage) {
  try {
    const ids = JSON.parse(storage.getItem('multibeat-device-order') || '[]');
    return Array.isArray(ids) && ids.every(id => typeof id === 'string' && id.length > 0) ? [...new Set(ids)] : [];
  } catch { return []; }
}

/** Move one device to another device's position without mutating the input. */
export function moveDevice(order, id, targetId) {
  const from = order.indexOf(id), to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return order;
  const next = order.slice(); next.splice(from, 1); next.splice(to, 0, id);
  return next;
}
