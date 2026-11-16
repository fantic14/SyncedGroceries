import assert from 'node:assert/strict';
import test from 'node:test';
import { readBackendConfig } from './backendConfig.ts';

test('sharing remains optional and malformed endpoints do not crash startup', () => {
  assert.equal(readBackendConfig(), null);
  assert.equal(readBackendConfig('not a URL', 'sb_publishable_example'), null);
  assert.equal(
    readBackendConfig('http://remote.example', 'sb_publishable_example'),
    null,
  );
  assert.ok(
    readBackendConfig('https://example.supabase.co', 'sb_publishable_example'),
  );
});

test('only public keys are accepted, including local development anon JWTs', () => {
  const jwt = (role: string) =>
    `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(
    readBackendConfig('https://example.supabase.co', 'sb_secret_example'),
    null,
  );
  assert.equal(
    readBackendConfig('https://example.supabase.co', jwt('service_role')),
    null,
  );
  assert.ok(readBackendConfig('http://127.0.0.1:54321', jwt('anon')));
});
