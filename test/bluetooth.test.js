import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHeartRate, subscribe } from '../src/bluetooth.js';
const packet = bytes => new DataView(Uint8Array.from(bytes).buffer);
test('8-bit heart rate, unsupported contact, absent RR', () => {
  assert.deepEqual(parseHeartRate(packet([0, 72])), { bpm: 72, contact: null, energy: null, rr: [], rrMs: [] });
});
test('16-bit heart rate, contact, energy, and multiple little-endian RR intervals', () => {
  assert.deepEqual(parseHeartRate(packet([31, 44, 1, 10, 0, 0, 4, 0, 2])), { bpm: 300, contact: true, energy: 10, rr: [1024, 512], rrMs: [1000, 500] });
});
test('supported sensor contact is explicitly false when detached', () => {
  assert.equal(parseHeartRate(packet([4, 0])).contact, false);
});
test('respects DataView offsets into a shared buffer', () => {
  const data = Uint8Array.from([99, 16, 60, 0, 4, 99]);
  assert.equal(parseHeartRate(new DataView(data.buffer, 1, 4)).rrMs[0], 1000);
});
test('rejects truncated flags, HR, energy, and RR instead of recording corrupt values', () => {
  for (const bytes of [[], [0], [1, 3], [8, 60, 0], [16, 60], [16, 60, 0], [0, 60, 1]]) assert.throws(() => parseHeartRate(packet(bytes)));
});
test('notification subscription cleanup removes listeners and disconnects', async () => {
  const characteristic = new EventTarget(); characteristic.startNotifications = async () => {};
  const device = new EventTarget(); let disconnected = 0, samples = 0;
  device.gatt = { connect: async () => ({ getPrimaryService: async () => ({ getCharacteristic: async () => characteristic }) }), disconnect: () => disconnected++ };
  const cleanup = await subscribe(device, () => samples++, () => {});
  characteristic.dispatchEvent(new Event('characteristicvaluechanged')); cleanup();
  characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
  assert.equal(samples, 1); assert.equal(disconnected, 1);
});
