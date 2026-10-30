import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mountHeartRateMonitor } from '../hr-monitor.js';
import markup from '../src/view.js';

test('website entry point can be imported without mounting or accessing browser APIs', () => {
  assert.equal(typeof mountHeartRateMonitor, 'function');
});

test('embedded dashboard supplies every control used by the controller', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'dashboard IDs must be unique');
  for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) {
    assert.ok(ids.includes(id), `Embedded dashboard is missing #${id}`);
  }
});
