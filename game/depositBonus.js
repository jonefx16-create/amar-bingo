'use strict';

const { isEatInWindow, isEatHourInclusive } = require('./eatTime');

function computeDepositBonus(amount, user, settings, now) {
    const set = settings || {};
    const actual = Number(amount) || 0;
    if (actual <= 0) {
        return { bonus: 0, source: 'none', giveBonus: false };
    }

    const when = now == null ? Date.now() : now;
    const hasFirst = !!(user && user.hasMadeFirstDeposit);

    if (set.depBonusSchedulerActive) {
        const inWindow = isEatInWindow(when, set.depBonusSchedulerStart, set.depBonusSchedulerEnd);
        const minAmt = Number(set.depBonusSchedulerMinAmount) || 0;
        if (inWindow && actual >= minAmt) {
            const pct = Number(set.depBonusSchedulerPercent) || 0;
            return {
                bonus: actual * (pct / 100),
                source: 'scheduler',
                giveBonus: pct > 0,
                percent: pct
            };
        }
    }

    if (set.depBonusTimeRestricted) {
        if (!isEatHourInclusive(when, set.happyHourStart, set.happyHourEnd)) {
            return { bonus: 0, source: 'restricted', giveBonus: false };
        }
    }

    if (set.depBonusTier3Min && actual >= set.depBonusTier3Min && hasFirst) {
        const pct = Number(set.depBonusTier3Percent) || 0;
        return { bonus: actual * (pct / 100), source: 'tier3', giveBonus: true, percent: pct };
    }
    if (set.depBonusTier2Min && actual >= set.depBonusTier2Min) {
        const pct = Number(set.depBonusTier2Percent) || 0;
        return { bonus: actual * (pct / 100), source: 'tier2', giveBonus: true, percent: pct };
    }
    if (set.depBonusMinAmount && actual >= set.depBonusMinAmount) {
        const pct = Number(set.depBonusPercent) || 0;
        return { bonus: actual * (pct / 100), source: 'tier1', giveBonus: true, percent: pct };
    }

    return { bonus: 0, source: 'none', giveBonus: false };
}

module.exports = {
    computeDepositBonus
};
