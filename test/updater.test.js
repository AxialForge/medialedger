'use strict';
const assert = require('assert');
const { compareVersions, isNewer, updatesAllowed } = require('../src/main/updater');

assert.strictEqual(compareVersions('1.2.3', '1.2.3'), 0);
assert.strictEqual(compareVersions('v1.2.4', '1.2.3'), 1);
assert.strictEqual(compareVersions('1.2.3', '1.10.0'), -1);
assert.strictEqual(compareVersions('1.0.0-beta.1', '1.0.0'), -1);
assert.ok(isNewer('0.2.0', '0.1.9'));
assert.ok(!isNewer('0.1.0', '0.1.0'));
assert.deepStrictEqual(updatesAllowed({ env: { NO_AUTO_UPDATE: '1' }, enabled: true }), { enabled: false, enforced: true });
assert.deepStrictEqual(updatesAllowed({ env: {}, enabled: false }), { enabled: false, enforced: false });
assert.deepStrictEqual(updatesAllowed({ env: {} }), { enabled: true, enforced: false });
console.log('updater tests passed');
