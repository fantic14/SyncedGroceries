import assert from 'node:assert/strict';
import test from 'node:test';
import { createChunkedStorage } from './chunkedStorage.ts';

function fixture() {
  const values = new Map<string, string>();
  let sequence = 0;
  let failKey: string | null = null;
  const storage = createChunkedStorage(
    {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        if (key === failKey) throw new Error('Simulated storage failure');
        assert.ok(Buffer.byteLength(value, 'utf8') < 2048);
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
    },
    () => `generation-${++sequence}`,
  );
  return {
    storage,
    values,
    failAt: (key: string) => {
      failKey = key;
    },
  };
}

test('long Unicode sessions round-trip within native per-value limits', async () => {
  const { storage, values } = fixture();
  const session = JSON.stringify({
    token: 'a'.repeat(5000),
    name: '🥑'.repeat(2000),
  });
  await storage.setItem('session', session);
  assert.equal(await storage.getItem('session'), session);
  assert.ok(values.size > 2);
});

test('failed replacement keeps the previous complete session', async () => {
  const { storage, failAt } = fixture();
  await storage.setItem('session', 'previous');
  failAt('session.generation-2.1');
  await assert.rejects(storage.setItem('session', 'new'.repeat(1000)));
  assert.equal(await storage.getItem('session'), 'previous');
});

test('queued writes and logout finish without resurrecting a token', async () => {
  const { storage, values } = fixture();
  await Promise.all([
    storage.setItem('session', 'first'),
    storage.setItem('session', 'second'),
    storage.removeItem('session'),
  ]);
  assert.equal(await storage.getItem('session'), null);
  assert.equal(values.size, 0);
});

test('missing chunks fail closed, and corrupt metadata does not block logout', async () => {
  const { storage, values } = fixture();
  await storage.setItem('session', 'a'.repeat(1200));
  values.delete('session.generation-1.1');
  await assert.rejects(storage.getItem('session'), /incomplete/);
  values.set('session.manifest', '{invalid');
  await assert.rejects(storage.getItem('session'));
  await storage.removeItem('session');
  assert.equal(await storage.getItem('session'), null);
});
