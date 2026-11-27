'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'public/admin.html'), 'utf8');

const liveStart = html.indexOf('id="tab-live"');
const liveEnd = html.indexOf('id="tab-sms-compare"');
const live = html.slice(liveStart, liveEnd);
const witStart = html.indexOf('id="tab-pend-wit"');
const witEnd = html.indexOf('id="tab-dep-24h"');
const wit = html.slice(witStart, witEnd);
const settingsStart = html.indexOf('id="tab-settings"');
const settingsEnd = html.indexOf('id="edit-bot-modal"');
const settings = html.slice(settingsStart, settingsEnd);

assert.ok(live.includes('Hidden Bank'), 'Hidden Bank stays on Live & Analytics');
assert.ok(live.indexOf('Live Jackpot') < live.indexOf('Hidden Bank'), 'Hidden Bank stays to the right of the jackpot');
assert.ok(!settings.includes('Hidden Bank'), 'Hidden Bank is not inside Settings');
assert.ok(settings.includes('id="add-birr-amount"'), 'Add Birr is inside Settings');
assert.ok(settings.includes('id="disp-birr-balance"'), 'Settings shows the remaining Birr balance');
assert.ok(settings.includes('replaces the balance'), 'Add Birr replaces the previous balance instead of stacking');
assert.ok(!wit.includes('id="add-birr-amount"'), 'Add Birr is not on Pending Withdrawals');
assert.ok(wit.includes('id="birr-balance-wit"'), 'Pending Withdrawals shows the Birr balance');
assert.ok(wit.includes('Remaining after approved withdrawals'), 'The balance is what remains after approvals');
assert.ok(wit.indexOf('Birr Balance') < wit.indexOf('Total Pending Withdrawals'), 'The balance sits above the pending total');
assert.ok(html.includes("updateSettings('add_birr')"), 'Add Birr still adds to the payout balance');
assert.ok(html.includes('payload.addBirrAmount = added'), 'Add Birr sends only the amount just entered');
assert.ok(!html.includes('set-add-birr'), 'the old prize-vault Add Birr field is gone');
const addDone = html.indexOf('Remaining Birr balance:');
assert.ok(addDone !== -1 && html.slice(addDone - 220, addDone).includes("add-birr-amount').value = ''"), 'Add Birr clears the field so the next entry is not combined');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const approveAt = server.indexOf("} else if (tx.type === 'withdraw') {");
const approve = server.slice(approveAt, approveAt + 500);
assert.ok(!approve.includes('virtualPrizePool'), 'Approving a withdrawal does not change the prize vault');
assert.ok(server.includes('withdrawalDeduction'), 'Approving a withdrawal still deducts the Birr balance');

assert.ok(html.includes('openSettingsTab(this)'), 'Settings opens through the password check');
assert.ok(html.includes('id="settings-pass-modal"'), 'Settings password prompt is on the page');
assert.ok(html.includes('String(entered) !== String(pass)'), 'Settings uses the admin login password');

assert.ok(!html.includes('Real Money') && !html.includes('Bot Money'), 'money names stay Money');
assert.ok(!html.includes('🤖 Money'), 'the robot icon is gone from Money');
assert.ok(live.includes('👤 Money:'), 'the user icon can stay on the first Money amount');
assert.ok(live.includes('>Money:'), 'the second Money amount has no robot icon');
assert.ok(html.includes('color:#4ade80; font-size:14px;" id="split-real-money"'), 'the first Money amount is green');
assert.ok(html.includes('color:#4ade80; font-size:14px;" id="split-bot-money"'), 'the second Money amount is green');
assert.ok(!html.includes('id="split-bot-money"') || !html.includes('#f87171; font-size:14px;" id="split-bot-money"'), 'the second Money amount is not red');
assert.ok(live.includes('👤 Player'), 'the player label is Player with a person icon');
assert.ok(live.includes('color:#4ade80;">👤 Player'), 'the player label is green');
assert.ok(!live.includes('Real /'), 'Real / Real is gone from the player card');
assert.ok(html.includes('👁️ View List (እዚህ ይጫኑ)'), 'View List stays in place');
assert.ok(html.includes('👤 Player</span>'), 'live list badges say Player');
assert.ok(!html.includes('🤖 REAL') && !html.includes('🤖 BOT'), 'live list has no robot badge');

const fnMatch = html.match(/function playerBetPhoneHtml\(phone, isBot\) \{[\s\S]*?\n    \}/);
assert.ok(fnMatch, 'player bet phone formatter exists');
const ctx = {};
vm.runInNewContext(fnMatch[0] + '\nthis.playerBetPhoneHtml = playerBetPhoneHtml;', ctx);
const userPhone = ctx.playerBetPhoneHtml('0911000000', false);
const botPhone = ctx.playerBetPhoneHtml('0957438794', true);
assert.strictEqual(userPhone, `<a href="#" style="color:var(--cyan); text-decoration:none;" onclick="fetchAndShowUserInfo('0911000000'); return false;">0911000000</a>`);
assert.strictEqual(botPhone, userPhone.replace(/0911000000/g, '0957438794'));
assert.ok(!botPhone.includes('🤖'), 'Player & Bet has no robot icon');

console.log('admin label checks passed');
