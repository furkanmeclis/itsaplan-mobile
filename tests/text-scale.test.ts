import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessibleTextStyle } from '../src/themeText';

test('fixed iOS system-font sizes and spacing honor the accessibility scale', () => {
  assert.deepEqual(accessibleTextStyle({ fontSize: 24, lineHeight: 30, letterSpacing: 1 }, 'ios', 2), { fontSize: 48, lineHeight: 60, letterSpacing: 2 });
  assert.deepEqual(accessibleTextStyle({ fontWeight: '700' }, 'ios', 2), { fontWeight: '700', fontSize: 34 });
});

test('Android nonlinear sp, SwiftUI custom fonts and unstyled body are not double-scaled', () => {
  const android = { fontSize: 24 };
  const custom = { fontSize: 24, fontFamily: 'Custom' };
  const body = { color: '#315B40' };
  assert.equal(accessibleTextStyle(android, 'android', 2), android);
  assert.equal(accessibleTextStyle(custom, 'ios', 2), custom);
  assert.equal(accessibleTextStyle(body, 'ios', 2), body);
  assert.equal(accessibleTextStyle(undefined, 'ios', 2), undefined);
});
