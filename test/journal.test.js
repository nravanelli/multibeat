import test from 'node:test';
import assert from 'node:assert/strict';
import { Journal } from '../src/recorder.js';

function discovery(t, entries) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  const opened = [], closed = [];
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    databases: async () => entries.map(({ name }) => ({ name })),
    open(name, version) {
      assert.equal(version, undefined, 'legacy reads must not upgrade databases');
      opened.push(name);
      const entry = entries.find(item => item.name === name), request = {};
      queueMicrotask(() => {
        if (entry.removed) {
          request.transaction = { abort() { request.error = new DOMException('Removed', 'AbortError'); queueMicrotask(() => request.onerror()); } };
          request.onupgradeneeded(); return;
        }
        request.result = {
          name, objectStoreNames: { contains: key => key === 'records' && entry.records !== false },
          transaction(store, mode) {
            assert.equal(store, 'records'); assert.ok(mode == null || mode === 'readonly');
            return { objectStore: () => ({
              keyPath: 'id', autoIncrement: true,
              indexNames: { contains: key => key === 'session' }, index: () => ({ keyPath: 'session' }),
              openCursor() {
                const cursor = {};
                queueMicrotask(() => { cursor.result = entry.first ? { value: entry.first } : null; cursor.onsuccess(); });
                return cursor;
              }
            }) };
          },
          close: () => closed.push(name)
        };
        request.onsuccess();
      });
      return request;
    }
  } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'indexedDB', descriptor) : delete globalThis.indexedDB);
  return { opened, closed };
}

test('recovery discovers legacy journals without changing them or reading unrelated app records', async t => {
  const legacy = { session: 'old-session', value: { type: 'session', application: 'Beatstream' } };
  const state = discovery(t, [
    { name: 'multibeat-hr' }, { name: 'prior-journal', first: legacy },
    { name: 'other-app', first: { value: { type: 'session', application: 'Unrelated' } } },
    { name: 'other-schema', records: false }, { name: 'empty-journal' }
  ]);
  const journal = new Journal(); journal.db = { name: 'multibeat-hr' };
  journal.readSessions = async db => db.name === 'multibeat-hr' ? ['new-session'] : ['old-session'];
  assert.deepEqual(await journal.sessions(), ['old-session', 'new-session']);
  assert.deepEqual(state.opened, ['prior-journal', 'other-app', 'other-schema', 'empty-journal']);
  assert.deepEqual(state.closed, state.opened, 'all probe connections must close');
  const measurement = { session: 'old-session', value: { type: 'measurement', row: { label: '=original,"text"', rr_ms: '1000;500' } } };
  const read = [];
  journal.readRows = async (db, session) => {
    read.push([db.name, session]);
    return db.name === 'prior-journal' ? [legacy, measurement] : [];
  };
  assert.deepEqual(await journal.all('old-session'), [legacy, measurement]);
  assert.deepEqual(read, [['multibeat-hr', 'old-session'], ['prior-journal', 'old-session']]);
});

test('a legacy database removed during enumeration is not recreated', async t => {
  const state = discovery(t, [{ name: 'removed-journal', removed: true }]);
  const journal = new Journal(); journal.db = { name: 'multibeat-hr' };
  journal.readSessions = async () => ['current'];
  assert.deepEqual(await journal.sessions(), ['current']);
  assert.deepEqual(state.opened, ['removed-journal']); assert.deepEqual(state.closed, []);
});

test('versioned journal metadata identifies older sessions regardless of former application name', async t => {
  discovery(t, [{ name: 'early-journal', first: {
    session: 'early-session', value: { type: 'session', application: 'Prior app', session_id: 'early-session', format_version: 1 }
  } }]);
  const journal = new Journal(); journal.db = { name: 'multibeat-hr' };
  journal.readSessions = async db => db.name === 'early-journal' ? ['early-session'] : [];
  assert.deepEqual(await journal.sessions(), ['early-session']);
});

test('browsers without enumeration still expose current recovery records', async t => {
  discovery(t, []); delete indexedDB.databases;
  const journal = new Journal(); journal.db = { name: 'multibeat-hr' };
  journal.readSessions = async () => ['current'];
  journal.readRows = async () => [{ session: 'current', value: { type: 'event' } }];
  assert.deepEqual(await journal.sessions(), ['current']);
  assert.equal((await journal.all('current')).length, 1);
});
