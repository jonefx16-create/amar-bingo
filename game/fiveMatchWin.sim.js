'use strict';

/**
 * Hands-on 5-match win verification.
 * Mirrors the live PLAYING tick: lock-in → cutoff freeze → hydrate →
 * draw one ball → finalizeBingoRound → sticky lock / declare / broadcast.
 */

const engine = require('./index');

const USER_PHONE = '0911223344';
const USER_NAME = 'Abebe';
const USER_CARD = 12;
const RIVAL_PHONE = '0922000000';
const BOT_PHONE = '0933000000';
const PRIZE = 200;

function log(lines, silent, msg) {
    lines.push(msg);
    if (!silent) console.log(msg);
}

function fail(lines, silent, msg) {
    log(lines, silent, 'FAIL: ' + msg);
    const err = new Error(msg);
    err.reportLines = lines;
    throw err;
}

function rowWinGrid() {
    return [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 'FREE', 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65]
    ];
}

function laterRowWinGrid() {
    return [
        [6, 16, 31, 46, 61],
        [7, 17, 32, 47, 62],
        [8, 18, 'FREE', 48, 63],
        [9, 19, 34, 49, 64],
        [10, 20, 35, 50, 65]
    ];
}

function winningRow() {
    return [1, 2, 3, 4, 5];
}

function fillerBalls() {
    return [11, 12, 13, 14, 15, 21, 22, 23, 24, 25, 26, 27, 28];
}

function maskPhone(phone) {
    const p = String(phone || '');
    if (p.length >= 10) return p.substring(0, 3) + '****' + p.substring(7);
    return p;
}

function shapeBroadcast(outcome, gameId) {
    const winners = outcome.winners || [];
    const netPrize = outcome.history.winnerPayout;
    const winnerPhones = winners.map((w) => String(w.player.phone));
    const ticketIds = winners.map((w) => w.ticket && w.ticket.id);
    const winnerDetails = winners.map((w) => ({
        name: w.player.name,
        phone: maskPhone(w.player.phone),
        ticket: w.ticket && w.ticket.id,
        prize: netPrize
    }));
    return {
        event: 'game_winner',
        gameId,
        winnerName: [...new Set(winners.map((w) => w.player.name))].join(' እና '),
        ticketId: ticketIds.join(', '),
        prize: netPrize,
        totalPrize: outcome.history.prize,
        phone: winnerPhones.map(maskPhone).join(', '),
        calledNumbers: outcome.history.calledNumbers.slice(),
        isShared: winners.length > 1,
        winnerCount: winners.length,
        winnerDetails,
        winnerPhoneList: winnerPhones.slice()
    };
}

async function lockInCard(registry, board, seated, entries, player) {
    const ids = player.ticketsData.map((t) => Number(t.id));
    const claim = board.tryClaim(ids, player.phone);
    if (!claim.ok) throw new Error('lock-in conflict for ' + player.phone);
    await registry.enqueue(player.phone, async () => {
        seated[player.phone] = {
            name: player.name,
            phone: player.phone,
            isBot: !!player.isBot,
            inactive: false,
            tickets: player.ticketsData.length,
            ticketsData: player.ticketsData.map((t) => Object.assign({}, t, { inactive: false }))
        };
        player.ticketsData.forEach((t) => {
            entries.push({
                phone: player.phone,
                name: player.name,
                ticketId: Number(t.id),
                grid: t.grid,
                isBot: !!player.isBot,
                status: 'active'
            });
        });
        board.release(ids);
    });
}

function playLiveLoop(activePlayers, entries, sequence, ctx) {
    const called = [];
    const ticks = [];
    let locked = null;
    let extraAfterLock = [];
    for (let i = 0; i < sequence.length; i++) {
        if (locked) {
            extraAfterLock.push(sequence[i]);
            continue;
        }
        called.push(sequence[i]);
        engine.hydratePlayersFromEntries(activePlayers, entries);
        const outcome = engine.finalizeBingoRound(activePlayers, entries, called, Object.assign({
            calledNumbers: called,
            currentTurn: called.length,
            numToCall: sequence[i],
            totalPrize: PRIZE
        }, ctx || {}));
        ticks.push({
            turn: called.length,
            ball: sequence[i],
            bingo: engine.checkBingo(rowWinGrid(), called),
            locked: outcome.locked,
            claimIds: (outcome.tick && outcome.tick.claimIds) || []
        });
        if (outcome.locked) {
            locked = outcome;
        }
    }
    return { called, ticks, outcome: locked, extraAfterLock };
}

function playStickyLockedLoop(activePlayers, entries, sequence, ctx) {
    let roundResolutionLocked = false;
    const called = [];
    for (let i = 0; i < sequence.length; i++) {
        if (roundResolutionLocked) break;
        engine.hydratePlayersFromEntries(activePlayers, entries);
        called.push(sequence[i]);
        const outcome = engine.finalizeBingoRound(activePlayers, entries, called, Object.assign({
            calledNumbers: called,
            currentTurn: called.length,
            numToCall: sequence[i],
            totalPrize: PRIZE
        }, ctx || {}));
        if (outcome.locked) roundResolutionLocked = true;
    }
    return { called, roundResolutionLocked };
}

async function runFiveMatchVerification(opts) {
    const silent = !!(opts && opts.silent);
    const lines = [];
    const gameId = 5041;
    log(lines, silent, '=== 5-match win verification (live-loop) ===');

    const registry = engine.createRoundRegistry();
    const board = engine.createTicketLockBoard();
    const seated = {};
    const entries = [];

    const user = {
        name: USER_NAME,
        phone: USER_PHONE,
        isBot: false,
        ticketsData: [{ id: USER_CARD, grid: rowWinGrid() }]
    };
    const rival = {
        name: 'Kebede',
        phone: RIVAL_PHONE,
        isBot: false,
        ticketsData: [{ id: 88, grid: laterRowWinGrid() }]
    };
    const bot = {
        name: 'Bot',
        phone: BOT_PHONE,
        isBot: true,
        ticketsData: [{ id: 99, grid: laterRowWinGrid() }]
    };

    log(lines, silent, '1. Lock-in: real user ' + USER_PHONE + ' claims card #' + USER_CARD);
    await lockInCard(registry, board, seated, entries, user);
    await lockInCard(registry, board, seated, entries, rival);
    await lockInCard(registry, board, seated, entries, bot);
    if (registry.hasPending()) fail(lines, silent, 'lock-in queue did not drain');
    if (!seated[USER_PHONE] || Number(seated[USER_PHONE].ticketsData[0].id) !== USER_CARD) {
        fail(lines, silent, 'user card was not committed');
    }
    log(lines, silent, '   committed cards: ' + entries.map((e) => e.phone + ':' + e.ticketId).join(', '));

    log(lines, silent, '2. Cutoff freeze (no new buys; in-flight already drained)');
    registry.freeze(seated);
    if (registry.canAcceptRegistration()) fail(lines, silent, 'cutoff did not freeze');
    let lateRejected = false;
    try {
        await registry.enqueue('0999000000', async () => {});
    } catch (err) {
        lateRejected = err && err.code === 'ROUND_FROZEN';
    }
    if (!lateRejected) fail(lines, silent, 'post-cutoff enqueue was accepted');

    log(lines, silent, '3. Simulate the skip bug: drop the user seat from memory and mark inactive');
    delete seated[USER_PHONE];
    seated[RIVAL_PHONE].inactive = true;
    seated[BOT_PHONE].ticketsData[0].inactive = true;

    const sequence = fillerBalls().concat(winningRow()).concat([6, 7, 8, 9, 10, 33, 36]);
    log(lines, silent, '4. Draw loop (13 fillers, then 1-2-3-4-5, then extra balls that would complete a rival)');
    log(lines, silent, '   adversarial forceWinner=bots (house trying to take the round)');

    const result = playLiveLoop(seated, entries, sequence, {
        forceWinner: 'bots',
        botPlayers: [seated[BOT_PHONE]],
        helpers: {
            makeNaturalBotTicket: (tix, called, winNum) => {
                tix.grid = laterRowWinGrid();
                tix.forced = winNum;
            },
            getUnusedFakeTicketId: () => 400,
            generateFixedCard: engine.generateFixedCard
        }
    });

    result.ticks.forEach((tick) => {
        log(lines, silent, '   turn ' + tick.turn + ' ball ' + tick.ball
            + (tick.bingo ? '  USER_5_MATCH' : '')
            + (tick.locked ? '  LOCK' : '')
            + (tick.claimIds.length ? '  claims=' + tick.claimIds.join(',') : ''));
    });

    if (!result.outcome || !result.outcome.locked) {
        fail(lines, silent, 'round did not lock when the user completed 5 matches');
    }
    if (result.outcome.lockReason !== 'USER_5_MATCH_LOCK') {
        fail(lines, silent, 'lock reason was ' + result.outcome.lockReason + ', expected USER_5_MATCH_LOCK');
    }
    if (result.called[result.called.length - 1] !== 5) {
        fail(lines, silent, 'lock ball was ' + result.called[result.called.length - 1] + ', expected 5');
    }
    if (result.called.length !== 18) {
        fail(lines, silent, 'expected lock on turn 18 (13 fillers + 5), got ' + result.called.length);
    }
    if (result.extraAfterLock.length === 0) {
        fail(lines, silent, 'simulation did not prove remaining balls were skipped');
    }
    if (result.extraAfterLock.indexOf(6) === -1) {
        fail(lines, silent, 'rival-completing ball 6 was not left uncalled');
    }

    const phones = result.outcome.history.winnerPhoneList;
    if (phones[0] !== USER_PHONE) {
        fail(lines, silent, 'true winner was not first: ' + phones.join(','));
    }
    if (phones.indexOf(RIVAL_PHONE) !== -1) {
        fail(lines, silent, 'later rival bypassed the user');
    }
    const botTookOver = phones.indexOf(BOT_PHONE) !== -1 && phones.indexOf(USER_PHONE) === -1;
    if (botTookOver) fail(lines, silent, 'bot replaced the user');
    if (!result.outcome.shouldBroadcast) fail(lines, silent, 'socket broadcast was suppressed');

    const broadcast = shapeBroadcast(result.outcome, gameId);
    const payout = engine.computeEvenSplit(PRIZE, result.outcome.winners.length);
    if (result.outcome.history.winnerPayout !== payout) {
        fail(lines, silent, 'payout mismatch');
    }
    if (broadcast.event !== 'game_winner') fail(lines, silent, 'broadcast event missing');
    if (broadcast.winnerPhoneList[0] !== USER_PHONE) fail(lines, silent, 'broadcast winner mismatch');
    if (String(broadcast.ticketId).indexOf(String(USER_CARD)) === -1) {
        fail(lines, silent, 'broadcast ticket mismatch');
    }
    if (JSON.stringify(broadcast.calledNumbers) !== JSON.stringify(result.called)) {
        fail(lines, silent, 'broadcast called-numbers mismatch');
    }

    const userPayouts = result.outcome.winners
        .filter((w) => !w.player.isBot && w.player.phone === USER_PHONE)
        .map((w) => ({ phone: w.player.phone, ticket: w.ticket.id, amount: payout }));
    if (userPayouts.length === 0) fail(lines, silent, 'user payout was not triggered');

    log(lines, silent, '5. Declare / broadcast');
    log(lines, silent, '   locked=true gameState=FINISHED furtherDraws=' + result.extraAfterLock.length + ' skipped');
    log(lines, silent, '   winners=' + phones.join(','));
    log(lines, silent, '   payout=' + payout + ' ETB of pool ' + PRIZE);
    log(lines, silent, '   socket game_winner phones=' + broadcast.phone + ' tickets=' + broadcast.ticketId);
    log(lines, silent, '   history winnerPhoneList=' + result.outcome.history.winnerPhoneList.join(','));

    log(lines, silent, '6. Sticky lock (roundResolutionLocked) refuses any later ball');
    const sticky = playStickyLockedLoop({}, entries, sequence, {
        forceWinner: 'bots',
        botPlayers: [],
        helpers: {
            makeNaturalBotTicket: () => {},
            getUnusedFakeTicketId: () => 403,
            generateFixedCard: engine.generateFixedCard
        }
    });
    if (!sticky.roundResolutionLocked) fail(lines, silent, 'sticky lock was not set');
    if (sticky.called[sticky.called.length - 1] !== 5) {
        fail(lines, silent, 'sticky loop rolled past the 5-match to ' + sticky.called[sticky.called.length - 1]);
    }
    log(lines, silent, '   sticky called=' + sticky.called.join(',') + ' halt=true');
    log(lines, silent, '=== 5-match win bug is resolved: user card #' + USER_CARD + ' was detected, locked, paid, and broadcast ===');

    return {
        passed: true,
        called: result.called,
        extraAfterLock: result.extraAfterLock,
        winners: phones,
        payout,
        broadcast,
        history: result.outcome.history,
        userPayouts,
        stickyCalled: sticky.called,
        lines
    };
}

async function runAdversarialSameTickBotRewrite(opts) {
    const silent = !!(opts && opts.silent);
    const lines = [];
    log(lines, silent, '=== adversarial same-tick bot rewrite cannot steal a completed user card ===');
    const winGrid = rowWinGrid();
    const activePlayers = {
        hero: { phone: USER_PHONE, name: USER_NAME, isBot: false, ticketsData: [{ id: USER_CARD, grid: winGrid }] },
        bot: { phone: BOT_PHONE, name: 'Bot', isBot: true, ticketsData: [{ id: 99, grid: laterRowWinGrid() }] }
    };
    const entries = [
        { phone: USER_PHONE, ticketId: USER_CARD, grid: winGrid, status: 'active' },
        { phone: BOT_PHONE, ticketId: 99, grid: laterRowWinGrid(), status: 'active' }
    ];
    const called = fillerBalls().concat([1, 2, 3, 4]);
    const fifth = 5;
    called.push(fifth);
    activePlayers.bot.ticketsData[0].grid = winGrid;
    const outcome = engine.finalizeBingoRound(activePlayers, entries, called, {
        calledNumbers: called,
        currentTurn: called.length,
        forceWinner: 'bots',
        totalPrize: PRIZE,
        botPlayers: [activePlayers.bot],
        helpers: {
            makeNaturalBotTicket: () => {},
            getUnusedFakeTicketId: () => 401,
            generateFixedCard: engine.generateFixedCard
        }
    });
    if (!outcome.locked) fail(lines, silent, 'did not lock after 5-match');
    if (outcome.history.winnerPhoneList[0] !== USER_PHONE) {
        fail(lines, silent, 'user was not first after bot rewrite: ' + outcome.history.winnerPhoneList.join(','));
    }
    if (outcome.history.winnerPhoneList.indexOf(USER_PHONE) === -1) {
        fail(lines, silent, 'user dropped after bot rewrite');
    }
    log(lines, silent, '   winners=' + outcome.history.winnerPhoneList.join(',') + ' (user first, not replaced)');
    return { passed: true, winners: outcome.history.winnerPhoneList, lines };
}

if (require.main === module) {
    runFiveMatchVerification({ silent: false })
        .then(() => runAdversarialSameTickBotRewrite({ silent: false }))
        .then(() => {
            console.log('\nALL 5-MATCH CHECKS PASSED');
        })
        .catch((err) => {
            console.error(err && err.stack ? err.stack : err);
            process.exitCode = 1;
        });
}

module.exports = {
    USER_PHONE,
    USER_CARD,
    runFiveMatchVerification,
    runAdversarialSameTickBotRewrite,
    playLiveLoop,
    playStickyLockedLoop,
    shapeBroadcast
};
