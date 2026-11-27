'use strict';

const assert = require('assert');
const guard = require('./contactGuard');

function message(fromId, contactUserId, phone) {
    return {
        from: { id: fromId },
        contact: { phone_number: phone, user_id: contactUserId, first_name: 'Abebe' }
    };
}

const forwarded = guard.reviewContactShare(message(111, 222, '+251911223344'), null);
assert.strictEqual(forwarded.ok, false);
assert.strictEqual(forwarded.bonus, 0);
assert.strictEqual(forwarded.verifyPhone, false);
assert.strictEqual(forwarded.create, false);
assert.strictEqual(forwarded.flagSenderPending, true);
assert.ok(forwarded.message.indexOf('own personal contact') !== -1);
assert.deepStrictEqual(guard.mismatchAccountPatch(), { contactVerified: false, verificationStatus: 'pending' });

const missingId = guard.reviewContactShare({
    from: { id: 111 },
    contact: { phone_number: '0911223344', user_id: null }
}, null);
assert.strictEqual(missingId.bonus, 0);
assert.strictEqual(missingId.verifyPhone, false);
assert.strictEqual(guard.isOwnContact(missingId && { from: { id: 111 }, contact: {} }), false);

const ownNew = guard.reviewContactShare(message(111, 111, '251911223344'), null);
assert.strictEqual(ownNew.ok, true);
assert.strictEqual(ownNew.bonus, 'register');
assert.strictEqual(ownNew.create, true);
assert.strictEqual(ownNew.verifyPhone, true);
assert.strictEqual(ownNew.phone, '0911223344');
assert.deepStrictEqual(guard.verifiedAccountPatch(), { contactVerified: true, verificationStatus: 'verified' });

const taken = guard.reviewContactShare(message(111, 111, '0911000000'), { phone: '0911000000', telegramId: '999' });
assert.strictEqual(taken.ok, false);
assert.strictEqual(taken.bonus, 0);
assert.strictEqual(taken.create, false);
assert.strictEqual(taken.verifyPhone, false);

const relink = guard.reviewContactShare(message(111, 111, '0911000000'), { phone: '0911000000', telegramId: '111' });
assert.strictEqual(relink.ok, true);
assert.strictEqual(relink.bonus, 0);
assert.strictEqual(relink.create, false);
assert.strictEqual(relink.verifyPhone, true);

const unlinked = guard.reviewContactShare(message(111, 111, '0911000000'), { phone: '0911000000', telegramId: '' });
assert.strictEqual(unlinked.ok, true);
assert.strictEqual(unlinked.bonus, 0);
assert.strictEqual(unlinked.create, false);

const fs = require('fs');
const path = require('path');
const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const contactHandler = server.slice(server.indexOf("bot.on('contact'"), server.indexOf("bot.on('message'"));
assert.ok(contactHandler.indexOf('isOwnContact') !== -1);
assert.ok(contactHandler.indexOf('phoneLinkedToOther') !== -1);
assert.ok(contactHandler.indexOf('OWN_CONTACT_REQUIRED') !== -1);
assert.ok(contactHandler.indexOf("share.bonus === 'register'") !== -1);
assert.ok(contactHandler.indexOf('mismatchAccountPatch') !== -1);
assert.strictEqual(contactHandler.indexOf('playBalance +='), -1);

console.log('contact guard tests passed');
