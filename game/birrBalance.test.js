'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const birr = require('./birrBalance');

assert.strictEqual(birr.roundBirr('50000'), 50000);
assert.strictEqual(birr.roundBirr(1000.126), 1000.13);
assert.strictEqual(birr.roundBirr('nope'), 0);

const added = birr.addBirrAmount(50000);
assert.strictEqual(added.ok, true);
assert.strictEqual(added.added, 50000);

const first = birr.balanceAfterAdd(0, 5000);
assert.strictEqual(first.ok, true);
assert.strictEqual(first.balance, 5000);
const second = birr.balanceAfterAdd(first.balance, 3000);
assert.strictEqual(second.ok, true);
assert.strictEqual(second.balance, 3000);
assert.notStrictEqual(second.balance, 8000);
assert.strictEqual(birr.balanceAfterAdd(5000.5, 3000.126).balance, 3000.13);
assert.strictEqual(birr.roundBirr(second.balance - birr.withdrawalDeduction({ type: 'withdraw', amount: 1000 }, 'Pending')), 2000);
assert.strictEqual(birr.roundBirr(5000 - 1000), 4000);

assert.strictEqual(birr.addBirrAmount(0).ok, false);
assert.strictEqual(birr.addBirrAmount(-20).ok, false);
assert.strictEqual(birr.addBirrAmount('').ok, false);
const kept = birr.balanceAfterAdd(5000, 0);
assert.strictEqual(kept.ok, false);
assert.strictEqual(kept.balance, 5000);
assert.strictEqual(birr.balanceAfterAdd(5000, -20).balance, 5000);
assert.strictEqual(birr.balanceAfterAdd(5000, '').balance, 5000);

assert.strictEqual(birr.withdrawalDeduction({ type: 'withdraw', amount: 1000 }, 'Pending'), 1000);
assert.strictEqual(birr.withdrawalDeduction({ type: 'withdraw', amount: 1000 }, 'Approved'), 0);
assert.strictEqual(birr.withdrawalDeduction({ type: 'deposit', amount: 1000 }, 'Pending'), 0);
assert.strictEqual(birr.withdrawalDeduction({ type: 'withdraw', amount: 0 }, 'Pending'), 0);

const root = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert.ok(admin.indexOf('id="add-birr-amount"') !== -1);
assert.ok(admin.indexOf('id="disp-birr-balance"') !== -1);
assert.ok(admin.indexOf('id="birr-balance-wit"') !== -1);
assert.ok(admin.indexOf("updateSettings('add_birr')") !== -1);
assert.ok(admin.indexOf('function paintBirrBalance') !== -1);
assert.ok(server.indexOf('birrBalance:') !== -1);
assert.ok(server.indexOf('changeBirrBalance') !== -1);
assert.ok(server.indexOf('withdrawalDeduction') !== -1);
assert.ok(server.indexOf("io.emit('birr_balance'") !== -1);
assert.ok(server.indexOf('$inc: { birrBalance: step }') !== -1, 'withdrawals still adjust the balance by a delta');

const updateStart = server.indexOf("app.post('/api/admin/update-settings'");
const updateEnd = server.indexOf("app.post('/api/admin/shuffle-cards'");
const update = server.slice(updateStart, updateEnd);
assert.ok(update.includes('balanceAfterAdd'), 'Add Birr uses the replace rule');
assert.ok(update.includes('setBirrBalance(birrSet)'), 'Add Birr stores the entered amount');
assert.ok(!update.includes('changeBirrBalance'), 'Add Birr does not add onto the previous balance');
assert.ok(admin.indexOf('replaces the balance') !== -1);

const pendingAt = admin.indexOf('id="tab-pend-wit"');
const pendingEnd = admin.indexOf('id="tab-dep-24h"');
const balanceAt = admin.indexOf('id="birr-balance-wit"');
const pendingSumAt = admin.indexOf('id="sum-pend-wit"');
assert.ok(pendingAt !== -1 && pendingEnd > pendingAt);
assert.ok(balanceAt > pendingAt && balanceAt < pendingEnd);
assert.ok(balanceAt < pendingSumAt, 'birr balance sits above the pending withdrawal total');

console.log('birr balance rules ok');
