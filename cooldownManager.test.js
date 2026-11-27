'use strict';

const cooldown = require('./cooldownManager');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        failed += 1;
        console.error('FAIL:', msg);
    }
}

assert(cooldown.formatDuration(0) === '0h 0m 0s', 'zero duration shows every unit');
assert(cooldown.formatDuration(3661000) === '1h 1m 1s', 'duration formats hours minutes and seconds');
assert(cooldown.parseDurationMs('10m') === 10 * 60 * 1000, 'preset 10m parses');
assert(cooldown.parseDurationMs('1h') === 60 * 60 * 1000, 'preset 1h parses');
assert(cooldown.parseDurationMs('1h 30m') === 90 * 60 * 1000, 'combined duration parses');
assert(cooldown.parseDurationMs('90s') === 90000, 'seconds parse');
assert(cooldown.parseDurationMs('15') === 15 * 60 * 1000, 'plain number is minutes');
assert(cooldown.parseDurationMs('nope') === null, 'garbage duration is rejected');
assert(cooldown.penaltyKindForWinners(1) === 'solo', 'solo win kind');
assert(cooldown.stricterKind('shared', 'solo') === 'solo', 'stricter penalty kind wins');
assert(cooldown.stricterKind('solo', 'shared') === 'solo', 'weaker penalty does not replace a solo cooldown');

const now = 1_700_000_000_000;
const roundMs = 40 * 1000;
const listed = cooldown.listPenalties({
    now,
    roundMs,
    page: 1,
    pageSize: 1,
    activeCooldowns: { '0911': 40, '0912': 2 },
    timeBans: { '0913': now + (90 * 60 * 1000), '0914': now - 1000 },
    meta: { '0911': { kind: 'solo' }, '0913': { kind: 'shared' } },
    usersByPhone: {
        '0911': { name: 'Abebe', telegramUsername: 'abe', telegramId: '100' },
        '0913': { firstName: 'Marta', telegramId: '200' }
    }
});
assert(listed.total === 3, 'expired time bans are excluded and active penalties are included');
assert(listed.users.length === 1, 'page size is honored');
assert(listed.users[0].phone === '0913', 'longest remaining penalty is first');
assert(listed.users[0].remainingLabel === '1h 30m 0s', 'remaining time uses hours minutes and seconds');
assert(listed.users[0].reason.indexOf('1 hour ban') !== -1, 'time ban reason is shown');
assert(listed.totalPages === 3, 'pagination count follows the active set');

const page2 = cooldown.listPenalties({
    now,
    roundMs,
    page: 2,
    pageSize: 1,
    activeCooldowns: { '0911': 40 },
    timeBans: { '0913': now + (90 * 60 * 1000) },
    meta: { '0911': { kind: 'solo' } },
    usersByPhone: {}
});
assert(page2.users[0].phone === '0911', 'second page is the shorter game cooldown');

const byPhone = cooldown.listPenalties({
    now,
    roundMs,
    page: 1,
    pageSize: 8,
    phone: '0911',
    activeCooldowns: { '0911223344': 10, '0922000000': 4 },
    timeBans: {},
    meta: {},
    usersByPhone: {}
});
assert(byPhone.total === 1 && byPhone.users[0].phone === '0911223344', 'cooldown search matches a phone fragment');
const spaced = cooldown.listPenalties({
    now,
    roundMs,
    phone: '0911 223',
    activeCooldowns: { '0911223344': 10, '0922000000': 4 },
    timeBans: {},
    meta: {},
    usersByPhone: {}
});
assert(spaced.total === 1 && spaced.users[0].phone === '0911223344', 'cooldown search ignores spaces in the phone');
const missingPhone = cooldown.listPenalties({
    now,
    roundMs,
    phone: '0999',
    activeCooldowns: { '0911223344': 10 },
    timeBans: {},
    meta: {},
    usersByPhone: {}
});
assert(missingPhone.total === 0 && missingPhone.users.length === 0, 'unknown phone returns no cooldown rows');
assert(page2.users[0].reason === 'Solo win cooldown', 'stored kind is the penalty reason');
assert(page2.users[0].gamesLabel === '40 games left', 'game cooldown shows remaining games');

const state = {
    activeCooldowns: { '0911': 40 },
    timeBans: { '0913': now + (60 * 60 * 1000) },
    meta: { '0911': { kind: 'solo' }, '0913': { kind: 'split' } }
};
const removed = cooldown.removePenalty(state, '0911', now);
assert(removed.ok === true && state.activeCooldowns['0911'] == null && state.meta['0911'] == null, 'remove penalty clears the cooldown');
const missing = cooldown.removePenalty(state, '0911', now);
assert(missing.ok === false, 'removing twice reports that the user is already clear');

const decreased = cooldown.applyPenaltyDelta(state, '0913', -10 * 60 * 1000, now, roundMs);
assert(decreased.ok === true, 'time decrease is accepted');
assert(state.timeBans['0913'] === now + (50 * 60 * 1000), 'ten minutes are deducted from the time ban');
assert(decreased.remainingLabel === '0h 50m 0s', 'confirmation remaining time is formatted');

const games = {
    activeCooldowns: { '0912': 30 },
    timeBans: {},
    meta: { '0912': { kind: 'split' } }
};
const cut = cooldown.applyPenaltyDelta(games, '0912', -10 * 60 * 1000, now, roundMs);
assert(cut.ok === true && games.activeCooldowns['0912'] === 15, 'ten minutes removes 15 games at a 40s timer');
const added = cooldown.applyPenaltyDelta(games, '0912', 60 * 60 * 1000, now, roundMs);
assert(added.ok === true && games.activeCooldowns['0912'] === 105, 'one hour adds 90 games');
assert(games.timeBans['0912'] == null, 'a game cooldown stays a game cooldown when time is added');

const clearGames = cooldown.applyPenaltyDelta(games, '0912', -105 * 40 * 1000, now, roundMs);
assert(clearGames.cleared === true && games.activeCooldowns['0912'] == null, 'reducing past zero clears the penalty');
assert(cooldown.applyPenaltyDelta(games, '0912', -60000, now, roundMs).ok === false, 'a cleared user cannot be adjusted');

if (failed) {
    console.error(failed + ' cooldown manager test(s) failed');
    process.exit(1);
}
console.log('cooldown manager tests passed');
