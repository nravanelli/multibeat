import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureWakeLock } from '../src/wake-lock.js';

const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function sentinel() {
  const lock = new EventTarget(); lock.released = false; lock.releases = 0;
  lock.release = async () => { lock.releases++; lock.released = true; lock.dispatchEvent(new Event('release')); };
  return lock;
}

test('wake lock only runs during visible capture and concurrent updates share a request', async () => {
  let requests = 0; const lock = sentinel();
  const awake = new CaptureWakeLock({ request: async type => { assert.equal(type, 'screen'); requests++; return lock; } });
  awake.update(); assert.equal(requests, 0); assert.equal(awake.state, 'idle');
  awake.update({ recording: true }); awake.update(); awake.update();
  assert.equal(requests, 1); assert.equal(awake.state, 'requesting');
  await settle(); assert.equal(awake.state, 'active');
  awake.update({ recording: false });
  assert.equal(lock.released, true); assert.equal(awake.state, 'idle');
  awake.destroy();
});

test('hiding releases the lock and returning requests a fresh lock while the toggle stays enabled', async () => {
  const locks = [];
  const awake = new CaptureWakeLock({ request: async () => { const lock = sentinel(); locks.push(lock); return lock; } });
  awake.update({ recording: true }); await settle();
  awake.update({ visible: false }); assert.equal(awake.state, 'hidden'); assert.equal(locks[0].released, true);
  awake.update({ visible: true }); await settle(); assert.equal(locks.length, 2); assert.equal(awake.state, 'active');
  awake.update({ enabled: false }); assert.equal(awake.state, 'off');
  awake.update({ visible: false }); awake.update({ visible: true }); await settle();
  assert.equal(locks.length, 2, 'returning must respect the disabled toggle'); awake.destroy();
});

test('late requests after toggle off or teardown release without replacing the current lock', async () => {
  const resolvers = [];
  const awake = new CaptureWakeLock({ request: () => new Promise(resolve => resolvers.push(resolve)) });
  awake.update({ recording: true }); awake.update({ enabled: false }); awake.update({ enabled: true });
  const old = sentinel(), current = sentinel();
  resolvers[1](current); await settle(); assert.equal(awake.state, 'active');
  resolvers[0](old); await settle(); assert.equal(old.released, true); assert.equal(current.released, false);
  awake.destroy(); assert.equal(current.released, true);
  const late = sentinel(); let resolve;
  const pending = new CaptureWakeLock({ request: () => new Promise(r => { resolve = r; }) });
  pending.update({ recording: true }); pending.destroy(); resolve(late); await settle();
  assert.equal(late.released, true); assert.equal(pending.lock, null);
});

test('native release is shown as inactive and is not retried continuously', async () => {
  let requests = 0; const lock = sentinel();
  const awake = new CaptureWakeLock({ request: async () => { requests++; return lock; } });
  awake.update({ recording: true }); await settle(); await lock.release();
  assert.equal(awake.state, 'released'); awake.update(); awake.update(); assert.equal(requests, 1);
  awake.update({ enabled: false }); awake.update({ enabled: true }); await settle();
  assert.equal(requests, 2); awake.destroy();
});

test('denied or unavailable wake locks do not interrupt recording or retry every render', async () => {
  const errors = []; let requests = 0;
  const awake = new CaptureWakeLock({ request: async () => { requests++; throw new DOMException('Denied', 'NotAllowedError'); } }, () => {}, e => errors.push(e));
  awake.update({ recording: true }); await settle(); awake.update();
  assert.equal(awake.state, 'released'); assert.equal(requests, 1); assert.equal(errors.length, 1);
  assert.equal(awake.recording, true); awake.destroy();
  const unsupported = new CaptureWakeLock(undefined);
  unsupported.update({ recording: true }); assert.equal(unsupported.state, 'unavailable'); unsupported.destroy();
});
