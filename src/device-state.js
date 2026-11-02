export const READING_TIMEOUT_MS = 5000;

/** Distinguish an established Bluetooth link from a monitor supplying current readings. */
export function monitorDisplay(device, now) {
  const connected = device.status === 'connected';
  const currentReading = connected && device.last && (device.connectionStarted == null || device.last.at >= device.connectionStarted);
  const age = Math.max(0, now - (currentReading ? device.last.at : device.connectedAt ?? now));
  const live = Boolean(currentReading && age <= READING_TIMEOUT_MS);
  if (connected && age > READING_TIMEOUT_MS) {
    return { text: 'OFFLINE', offline: true, live: false, note: currentReading ? `No readings for ${Math.floor(age / 1000)}s · Bluetooth still connected` : 'No readings received · Bluetooth still connected' };
  }
  if (connected) return { text: live ? device.simulated ? 'SIMULATED' : 'LIVE' : 'WAITING', offline: false, live, note: live ? '' : 'Waiting for readings…' };
  if (device.status === 'connecting' && !device.hasConnected) return { text: 'CONNECTING', offline: false, live: false, note: 'Connecting to monitor…' };
  const note = device.status === 'permission' ? 'Bluetooth permission needed · reconnect after restoring access' : ['connecting', 'reconnecting'].includes(device.status) ? 'Connection lost · reconnecting automatically…' : device.manuallyPaused ? 'Monitor paused' : 'Not connected';
  return { text: 'OFFLINE', offline: true, live: false, note };
}
