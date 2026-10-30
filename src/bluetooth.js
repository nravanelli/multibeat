// Bluetooth SIG Heart Rate Measurement (0x2A37).
export function parseHeartRate(view) {
  let offset = 0;
  const read8 = () => { if (offset + 1 > view.byteLength) throw new Error('Truncated heart rate packet'); return view.getUint8(offset++); };
  const read16 = () => { if (offset + 2 > view.byteLength) throw new Error('Truncated heart rate packet'); const n = view.getUint16(offset, true); offset += 2; return n; };
  const flags = read8();
  const bpm = flags & 1 ? read16() : read8();
  const contact = flags & 4 ? Boolean(flags & 2) : null;
  const energy = flags & 8 ? read16() : null;
  const rr = [];
  if (flags & 16) { if (offset === view.byteLength) throw new Error('Missing RR interval'); while (offset < view.byteLength) rr.push(read16()); }
  if (offset !== view.byteLength) throw new Error('Unexpected heart rate packet length');
  return { bpm, contact, energy, rr, rrMs: rr.map(n => n * 1000 / 1024) };
}

export async function subscribe(device, onSample, onDisconnect) {
  device.addEventListener('gattserverdisconnected', onDisconnect);
  let characteristic;
  const notify = e => onSample(e.target.value);
  try {
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('heart_rate');
    characteristic = await service.getCharacteristic('heart_rate_measurement');
    characteristic.addEventListener('characteristicvaluechanged', notify);
    await characteristic.startNotifications();
    return () => {
      characteristic.removeEventListener('characteristicvaluechanged', notify);
      device.removeEventListener('gattserverdisconnected', onDisconnect);
      device.gatt.disconnect();
    };
  } catch (error) {
    characteristic?.removeEventListener('characteristicvaluechanged', notify);
    device.removeEventListener('gattserverdisconnected', onDisconnect);
    device.gatt.disconnect();
    throw error;
  }
}
