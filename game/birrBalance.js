'use strict';

function roundBirr(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Amount entered in Settings. Zero and negative entries are refused so a
 * blank save cannot wipe the remaining balance.
 */
function addBirrAmount(amount) {
    const added = roundBirr(amount);
    if (!(added > 0)) {
        return { ok: false, added: 0, message: 'Enter an amount greater than 0.' };
    }
    return { ok: true, added, message: '' };
}

/**
 * Add Birr replaces the balance with the amount just entered.
 * 5000 followed by 3000 leaves 3000, not 8000. A rejected entry keeps
 * the current balance. Withdrawals still subtract from whatever remains.
 */
function balanceAfterAdd(current, amount) {
    const decision = addBirrAmount(amount);
    const previous = roundBirr(current);
    if (!decision.ok) {
        return { ok: false, balance: previous, added: 0, message: decision.message };
    }
    return { ok: true, balance: decision.added, added: decision.added, message: '' };
}

/**
 * Birr leaves the float only when a withdrawal is approved for the first time.
 * A second approve, a rejection, or a deposit does not change the balance.
 */
function withdrawalDeduction(tx, previousStatus) {
    if (!tx || tx.type !== 'withdraw') return 0;
    if (previousStatus === 'Approved') return 0;
    const amount = roundBirr(tx.amount);
    return amount > 0 ? amount : 0;
}

module.exports = {
    roundBirr,
    addBirrAmount,
    balanceAfterAdd,
    withdrawalDeduction
};
