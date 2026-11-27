const assert = require('assert');
const { normalizePhone, gameHistoryQuery, stripUserFromGame } = require('./adminDeleteUser');

const phone = '0911223344';
const other = '0911000111';

assert.strictEqual(normalizePhone('  ' + phone + '  '), phone);
assert.strictEqual(normalizePhone(''), '');

const query = gameHistoryQuery(phone);
assert.ok(query.$or.some((clause) => clause.participantPhones === phone));
assert.ok(query.$or.some((clause) => clause['playersData.phone'] === phone));
assert.ok(query.$or.some((clause) => clause.winnerPhone && clause.winnerPhone.$regex && clause.winnerPhone.$regex.indexOf(phone) !== -1));

const shared = stripUserFromGame({
    playersData: [
        { phone, name: 'Abebe', tickets: 1 },
        { phone: other, name: 'Marta', tickets: 2 }
    ],
    participantPhones: [phone, other],
    winnerPhoneList: [other],
    winnerPhone: other,
    winnerId: other,
    winnerName: 'Marta'
}, phone);
assert.strictEqual(shared.changed, true);
assert.strictEqual(shared.remove, false);
assert.strictEqual(shared.patch.playersData.length, 1);
assert.strictEqual(shared.patch.playersData[0].phone, other);
assert.deepStrictEqual(shared.patch.participantPhones, [other]);
assert.strictEqual(shared.patch.winnerName, 'Marta');
assert.strictEqual(shared.patch.winnerPhone, other);

const onlyUser = stripUserFromGame({
    playersData: [{ phone, name: 'Abebe' }],
    participantPhones: [phone],
    winnerPhoneList: [phone],
    winnerPhone: phone,
    winnerId: phone,
    winnerName: 'Abebe'
}, phone);
assert.strictEqual(onlyUser.remove, true);

const sharedWin = stripUserFromGame({
    playersData: [{ phone, name: 'Abebe' }, { phone: other, name: 'Marta' }],
    participantPhones: [phone, other],
    winnerPhoneList: [phone, other],
    winnerPhone: phone + ', ' + other,
    winnerId: phone,
    winnerName: 'Abebe, Marta'
}, phone);
assert.strictEqual(sharedWin.remove, false);
assert.strictEqual(sharedWin.patch.winnerPhone, other);
assert.deepStrictEqual(sharedWin.patch.winnerPhoneList, [other]);
assert.strictEqual(sharedWin.patch.winnerId, other);
assert.strictEqual(sharedWin.patch.winnerName, 'Abebe, Marta');

const untouched = stripUserFromGame({
    playersData: [{ phone: other }],
    winnerPhone: other
}, phone);
assert.strictEqual(untouched.changed, false);
assert.strictEqual(untouched.remove, false);

const blank = stripUserFromGame({ playersData: [{ phone }] }, '   ');
assert.strictEqual(blank.changed, false);

const fs = require('fs');
const path = require('path');
const admin = fs.readFileSync(path.join(__dirname, 'public/admin.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const financeStart = admin.indexOf('id="tab-history-tx"');
const financeEnd = admin.indexOf('id="tab-players"');
const financeTab = admin.slice(financeStart, financeEnd);
assert.ok(financeTab.indexOf('deleteSelectedTxUsers()') !== -1, 'financial history bulk bar needs Delete User');
assert.ok(financeTab.indexOf('>Delete User<') !== -1);
const txRenderer = admin.slice(admin.indexOf('async function loadTxPage'), admin.indexOf('function filterHistoryTxType'));
assert.ok(txRenderer.indexOf("deleteUser('${t.phone}')") !== -1, 'each financial history row needs Delete User');
assert.ok(txRenderer.indexOf('singleDelete(\'transactions\'') !== -1, 'existing transaction delete stays in place');
assert.ok(admin.indexOf('Are you sure you want to permanently delete this user and reset their account?') !== -1);
assert.ok(server.indexOf('Transaction.deleteMany({ phone: target })') !== -1);
assert.ok(server.indexOf('await User.deleteOne({ _id: user._id })') !== -1);
assert.ok(server.indexOf('stripUserFromGame') !== -1);
assert.ok(server.indexOf("app.post('/api/admin/delete-user'") !== -1);

console.log('admin delete user checks passed');
