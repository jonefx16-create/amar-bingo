'use strict';

const OWN_CONTACT_REQUIRED = '❌ ይህ የእርስዎ ስልክ አይደለም። እባክዎ ከታች ያለውን የቴሌግራም ቁልፍ ተጭነው የራስዎን ስልክ ቁጥር ያጋሩ።\n\nPlease share your own personal contact using the Telegram contact button. A forwarded contact or someone else\'s contact card is not accepted.';

const PHONE_ALREADY_LINKED = '❌ ይህ ስልክ ቁጥር ከሌላ ቴሌግራም አካውንት ጋር ተገናኝቷል። የራስዎን ስልክ ቁጥር ያጋሩ።\n\nThis phone number is already linked to another Telegram account.';

function normalizeContactPhone(phone) {
    let value = String(phone || '').trim().replace(/[\s-]/g, '');
    if (value.startsWith('+251')) value = '0' + value.substring(4);
    else if (value.startsWith('251')) value = '0' + value.substring(3);
    return value;
}

function contactUserId(contact) {
    if (!contact || contact.user_id == null || contact.user_id === '') return '';
    return String(contact.user_id).trim();
}

function senderTelegramId(from) {
    if (!from || from.id == null || from.id === '') return '';
    return String(from.id).trim();
}

function isOwnContact(message) {
    const contactId = contactUserId(message && message.contact);
    const senderId = senderTelegramId(message && message.from);
    if (!contactId || !senderId) return false;
    return contactId === senderId;
}

function phoneLinkedToOther(existingUser, telegramId) {
    if (!existingUser) return false;
    const linked = String(existingUser.telegramId || '').trim();
    const sender = String(telegramId || '').trim();
    if (!linked || !sender) return false;
    return linked !== sender;
}

function mismatchAccountPatch() {
    return { contactVerified: false, verificationStatus: 'pending' };
}

function verifiedAccountPatch() {
    return { contactVerified: true, verificationStatus: 'verified' };
}

/**
 * Decide whether a Telegram contact share may register or collect a welcome bonus.
 * Third-party and forwarded cards award nothing and do not verify the phone.
 */
function reviewContactShare(message, existingUser) {
    const telegramId = senderTelegramId(message && message.from);
    if (!isOwnContact(message)) {
        return {
            ok: false,
            bonus: 0,
            verifyPhone: false,
            create: false,
            flagSenderPending: true,
            message: OWN_CONTACT_REQUIRED
        };
    }
    const phone = normalizeContactPhone(message.contact && message.contact.phone_number);
    if (phoneLinkedToOther(existingUser, telegramId)) {
        return {
            ok: false,
            bonus: 0,
            verifyPhone: false,
            create: false,
            flagSenderPending: false,
            message: PHONE_ALREADY_LINKED
        };
    }
    if (!existingUser) {
        return {
            ok: true,
            bonus: 'register',
            verifyPhone: true,
            create: true,
            flagSenderPending: false,
            phone,
            telegramId,
            message: ''
        };
    }
    return {
        ok: true,
        bonus: 0,
        verifyPhone: true,
        create: false,
        flagSenderPending: false,
        phone,
        telegramId,
        message: ''
    };
}

module.exports = {
    OWN_CONTACT_REQUIRED,
    PHONE_ALREADY_LINKED,
    normalizeContactPhone,
    contactUserId,
    senderTelegramId,
    isOwnContact,
    phoneLinkedToOther,
    mismatchAccountPatch,
    verifiedAccountPatch,
    reviewContactShare
};
