'use strict';

const MAX_SIGNUPS_PER_LINK_PER_DAY = 5;
const REFERRAL_LIMIT_MESSAGE = 'Daily referral invite limit reached for this link';

/**
 * A single invite link may create at most 5 accounts per calendar day.
 * `successfulToday` is the number of registrations already completed for
 * that link inside the current day window.
 */
function referralSignupDecision(successfulToday, max) {
    const cap = max == null ? MAX_SIGNUPS_PER_LINK_PER_DAY : Number(max);
    const count = Math.max(0, Number(successfulToday) || 0);
    if (count >= cap) {
        return {
            allowed: false,
            message: REFERRAL_LIMIT_MESSAGE,
            successfulToday: count,
            max: cap
        };
    }
    return {
        allowed: true,
        message: '',
        successfulToday: count,
        max: cap,
        nextCount: count + 1
    };
}

module.exports = {
    MAX_SIGNUPS_PER_LINK_PER_DAY,
    REFERRAL_LIMIT_MESSAGE,
    referralSignupDecision
};
