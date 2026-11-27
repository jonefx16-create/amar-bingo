'use strict';

function getTxRef(text) {
    if (!text || typeof text !== 'string') return null;
    const msg = text.toUpperCase().replace(/\n/g, ' ');
    const ftMatch = msg.match(/\b(FT[0-9A-Z]{5,15})\b/);
    if (ftMatch) return ftMatch[1];
    const matches = msg.match(/\b(?![A-Z]+\b)(?!\d+\b)[A-Z0-9]{6,15}\b/g);
    if (matches && matches.length > 0) return matches[0];
    const exact = msg.replace(/\s+/g, '');
    if (exact.length >= 6 && exact.length <= 15 && !/^\d+$/.test(exact)) return exact;
    return null;
}

function getBankAmount(text) {
    if (!text || typeof text !== 'string') return 0;
    const msg = text.toUpperCase().replace(/\n/g, ' ');
    const amtMatch = msg.match(/(?:ETB|BIRR|BR|ብር)\s*([\d,]+(?:\.\d+)?)/i)
        || msg.match(/([\d,]+(?:\.\d+)?)\s*(?:ETB|BIRR|BR|ብር)/i);
    if (amtMatch) return parseFloat(amtMatch[1].replace(/,/g, ''));
    return 0;
}

function isReceivingBankSms(text) {
    return /received|credited|gebi|into your account|deposit/i.test(String(text || ''));
}

function isOutboundBankSms(text) {
    return /transfer|transferred|debited|out of your account/i.test(String(text || ''));
}

function isEmptySlip(smsText) {
    return !String(smsText || '').trim();
}

function isLegitimateDepositReceipt(smsText) {
    const text = String(smsText || '').trim();
    if (!text) return false;
    if (!getTxRef(text)) return false;
    if (getBankAmount(text) <= 0) return false;
    if (!isReceivingBankSms(text) || isOutboundBankSms(text)) return false;
    return true;
}

function shouldPreservePendingDeposit(tx, bankTxRefs) {
    if (!tx) return false;
    if (isLegitimateDepositReceipt(tx.smsText)) return true;
    const ref = String(tx.txRef || '').toUpperCase().trim();
    if (!ref) return false;
    const bankSet = bankTxRefs instanceof Set
        ? bankTxRefs
        : new Set((bankTxRefs || []).map((r) => String(r || '').toUpperCase().trim()));
    return bankSet.has(ref);
}

module.exports = {
    getTxRef,
    getBankAmount,
    isReceivingBankSms,
    isOutboundBankSms,
    isEmptySlip,
    isLegitimateDepositReceipt,
    shouldPreservePendingDeposit
};
