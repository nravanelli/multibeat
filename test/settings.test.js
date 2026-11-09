import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPairedIds, savePairedIds } from '../src/settings.js';

function storage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    get length() { return entries.size; }, key: i => [...entries.keys()][i],
    getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value)
  };
}

test('saved pairing IDs migrate to the new key without removing prior settings or labels', () => {
  const s = storage({ 'prior-app-paired': '["strap-a","strap-a","strap-b"]', 'hr-labels': '{"strap-a":"P01"}' });
  assert.deepEqual(loadPairedIds(s), ['strap-a', 'strap-b']);
  assert.equal(s.getItem('multibeat-paired'), '["strap-a","strap-b"]');
  assert.equal(s.getItem('prior-app-paired'), '["strap-a","strap-a","strap-b"]');
  assert.equal(s.getItem('hr-labels'), '{"strap-a":"P01"}');
  savePairedIds(s, []); assert.deepEqual(loadPairedIds(s), [], 'an explicit empty current list overrides legacy settings');
});

test('ambiguous or unrelated pairing lists are not silently restored', () => {
  const s = storage({ 'one-paired': '["a"]', 'two-paired': '["b"]', 'other-settings': '["c"]' });
  assert.deepEqual(loadPairedIds(s), []); assert.equal(s.getItem('multibeat-paired'), null);
  assert.deepEqual(loadPairedIds(storage({ 'old-paired': '[1,null]' })), []);
});

test('pairing can be restored even if writing the migrated settings is denied', () => {
  const s = storage({ 'old-paired': '["a"]' });
  s.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  assert.deepEqual(loadPairedIds(s), ['a']);
});
