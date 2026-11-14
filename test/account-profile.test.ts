import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountProfile } from '../src/account-profile';
const unchanged = (s: string) => s;
test('decode legacy third-party nickname once and expose its source only', () => {
  const profile = accountProfile({ thirdparty_info: { nickname: 'Fixture+Runner+%E5%A4%AA%E9%83%8E', third_id: 'fixture-private-id', icon: 'https://example.invalid/private' } }, unchanged);
  assert.deepEqual(profile, { display_name: 'Fixture Runner 太郎', display_name_source: 'thirdparty_info.nickname',
    status: 'available', authentication_method: 'email_password' });
});
test('known profile aliases keep literal plus signs; missing name is explicitly unavailable', () => {
  assert.equal(accountProfile({ user_info: { nickName: 'Fixture A+B' } }, unchanged).display_name, 'Fixture A+B');
  assert.equal(accountProfile({ token_info: { nickname: 'fixture-token-field' } }, unchanged).status, 'not_returned');
  assert.equal(accountProfile({ regist_info: {}, email: 'fixture@example.invalid' }, unchanged).display_name, null);
});
test('withhold malformed, oversized, contact, control and secret-valued names', () => {
  for (const name of ['fixture@example.invalid', 'https://example.invalid/private', 'Fixture\nRunner', 'a'.repeat(161), 'fixture-access']) {
    const profile = accountProfile({ profile: { nickname: name } }, s => s.replace('fixture-access', '[REDACTED]'));
    assert.equal(profile.display_name, null);
    assert.equal(profile.status, 'withheld');
  }
  assert.equal(accountProfile({ thirdparty_info: { nickname: '%XX' } }, unchanged).status, 'withheld');
});
