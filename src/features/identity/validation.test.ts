import assert from 'node:assert/strict';
import test from 'node:test';
import { identityError, normalizeEmail, validateCode } from './validation.ts';

test('normalizes email and rejects malformed addresses before sending requests', () => {
  assert.equal(normalizeEmail(' Student@Example.com '), 'student@example.com');
  for (const email of ['', 'student', 'a b@example.com', 'a@'])
    assert.throws(() => normalizeEmail(email));
});

test('accepts numeric codes while rejecting links and incomplete codes', () => {
  assert.equal(validateCode(' 012345 '), '012345');
  assert.equal(validateCode('12345678'), '12345678');
  for (const code of ['123', 'abcdef', 'https://example.com'])
    assert.throws(() => validateCode(code));
});

test('backend failures give useful messages without displaying SQL details', () => {
  assert.match(identityError({ code: 'otp_expired' }), /expired/);
  assert.match(
    identityError({ code: '42501', message: 'secret schema detail' }),
    /permission/,
  );
  assert.match(identityError({ code: 'PGRST202' }), /not ready/);
  assert.ok(
    !identityError({
      code: 'XX000',
      message: 'private SQL and token',
    }).includes('token'),
  );
});
