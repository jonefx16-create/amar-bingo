'use strict';

/**
 * End-to-end draw simulation.
 * Each round locks one winner profile and a rotated finish call in 14–23.
 * Bot cards scatter on calls 1–10 and build on 11–13. User cards fill a
 * line on calls 10–14. The winning ball lands in 14–23. The round must bingo on an authentic
 * purchased grid inside that window, with at most five winners.
 */

const engine = require('./index');

const PROFILES = [
    { name: 'depositor', forceWinner: 'mix_dep', botCount: 0, target: 'depositor' },
    { name: 'bot', forceWinner: 'bots', botCount: 0, target: 'depositor' },
    { name: 'mixed', forceWinner: 'mix_dep', botCount: 1, target: 'depositor' },
    { name: 'bonus', forceWinner: 'real', botCount: 0, target: 'bonus' }
];

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffle(list, rng) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

function cloneGrid(grid) {
    return JSON.parse(JSON.stringify(grid));
}

function makePlayer(phone, id, isBot, extra, mix) {
    const grid = engine.generateFixedCard(id, mix);
    return Object.assign({
        phone,
        name: phone,
        isBot: !!isBot,
        ticketsData: [{ id, grid }]
    }, extra || {});
}

function cardsOf(players) {
    const out = [];
    (players || []).forEach((player) => {
        (player.ticketsData || []).forEach((ticket) => {
            out.push({ player, ticket });
        });
    });
    return out;
}

function completingNumbers(players, called, pool) {
    const hits = [];
    for (let i = 0; i < pool.length; i++) {
        const n = pool[i];
        const temp = called.concat([n]);
        const found = cardsOf(players).some((card) => engine.checkBingo(card.ticket.grid, temp) && !engine.checkBingo(card.ticket.grid, called));
        if (found) hits.push(n);
    }
    return hits;
}

function bingoPlayers(players, called) {
    return (players || []).filter((player) => {
        return (player.ticketsData || []).some((ticket) => engine.checkBingo(ticket.grid, called));
    });
}

function simulateRound(spec) {
    const rng = mulberry32(spec.seed);
    const mix = 1000 + spec.seed;
    const depositor = makePlayer('dep-' + spec.seed, 11 + (spec.seed % 40), false, { hasDeposited: true }, mix);
    const bonus = makePlayer('bonus-' + spec.seed, 180 + (spec.seed % 40), false, { hasDeposited: false }, mix);
    const bots = [0, 1, 2].map((i) => makePlayer('bot-' + spec.seed + '-' + i, 300 + i * 37 + (spec.seed % 20), true, {}, mix));
    const players = [depositor, bonus].concat(bots);
    const snapshots = new Map();
    cardsOf(players).forEach((card) => snapshots.set(card.ticket.id, cloneGrid(card.ticket.grid)));

    const target = spec.profile.target === 'bonus' ? bonus : depositor;
    const others = [depositor, bonus].filter((p) => p !== target);
    const lineIndex = engine.buildRoundLineIndex(players);
    engine.primeDrawLookup(lineIndex, players);
    const walksAfterWarmup = lineIndex.gridWalks;
    let pool = shuffle(Array.from({ length: 75 }, (_, i) => i + 1), rng);
    const called = [];
    let sawShared = false;
    let endCall = null;
    let plan = null;

    for (let turn = 1; turn <= engine.HARD_CAP_CALLS; turn++) {
        const allCompleting = completingNumbers(players, called, pool);
        const botCompleting = completingNumbers(bots, called, pool);
        const userCompleting = completingNumbers([depositor, bonus], called, pool);
        lineIndex.syncCalled(called);
        if (turn >= engine.SHARED_READY_MIN && turn <= engine.SHARED_READY_MAX) {
            if (engine.sharedOneAwayAvailable([target], bots, called, pool, null, lineIndex)) sawShared = true;
        }
        const choice = engine.chooseDrawnBall({
            currentTurn: turn,
            finishCall: spec.finishCall,
            forceWinner: spec.profile.forceWinner,
            botCount: spec.profile.botCount,
            called,
            pool,
            targetPlayers: [target],
            botPlayers: bots,
            others,
            completing: allCompleting,
            botCompleting,
            userCompleting,
            fourCorner: [],
            blockedCompleting: [],
            lineIndex,
            rng,
            fullPrize: 100,
            depositor: spec.profile.target === 'depositor',
            vaultTwo: spec.profile.name === 'depositor' || spec.profile.name === 'mixed' ? 500 : 0,
            virtualPool: 500
        });
        if (!choice || choice.num == null) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' drew nothing on call ' + turn);
        }
        const drawProfile = engine.drawProfile(spec.profile.forceWinner, spec.profile.botCount);
        const scatterEnd = drawProfile === 'user' ? engine.USER_LINE_START - 1 : engine.SCATTER_CALL_END;
        if (turn < engine.FINISH_CALL_MIN && allCompleting.indexOf(choice.num) !== -1) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' completed a card on call ' + turn);
        }
        if (turn <= scatterEnd && lineIndex.leavesOneAway && lineIndex.leavesOneAway(choice.num)) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' left a card one away on call ' + turn);
        }
        if (choice.emergencySeal) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' needed an emergency seal on call ' + turn);
        }
        pool = pool.filter((n) => n !== choice.num);
        called.push(choice.num);
        lineIndex.noteCalled(choice.num);
        plan = choice.plan;
        const winnersNow = bingoPlayers(players, called);
        if (winnersNow.length && called.length < engine.FINISH_CALL_MIN) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' bingo before call 14');
        }
        if (winnersNow.length) {
            endCall = called.length;
            break;
        }
    }

    if (lineIndex.drawGridWalks !== 0 || lineIndex.gridWalks !== walksAfterWarmup) {
        throw new Error(spec.profile.name + ' seed ' + spec.seed + ' walked grids during a draw tick');
    }
    if (endCall == null) {
        throw new Error(spec.profile.name + ' seed ' + spec.seed + ' was still open after call ' + engine.HARD_CAP_CALLS);
    }
    if (endCall < engine.FINISH_CALL_MIN || endCall > engine.HARD_CAP_CALLS) {
        throw new Error(spec.profile.name + ' seed ' + spec.seed + ' ended on call ' + endCall);
    }
    if (endCall < spec.finishCall) {
        throw new Error(spec.profile.name + ' seed ' + spec.seed + ' ended on call ' + endCall + ' before scheduled ' + spec.finishCall);
    }
    const winnerProfile = engine.drawProfile(spec.profile.forceWinner, spec.profile.botCount);
    if (winnerProfile !== 'user' && !sawShared) {
        throw new Error(spec.profile.name + ' seed ' + spec.seed + ' had no shared 1-away by call 18 (ended ' + endCall + ', plan ' + plan + ')');
    }
    if (winnerProfile === 'user' && endCall > spec.finishCall) {
        throw new Error(spec.profile.name + ' seed ' + spec.seed + ' ended on call ' + endCall + ' after scheduled ' + spec.finishCall);
    }

    const winners = bingoPlayers(players, called);
    const capped = engine.capWinnerList(winners.map((player) => ({
        player,
        ticket: player.ticketsData.find((ticket) => engine.checkBingo(ticket.grid, called))
    })), 5);
    if (capped.length > 5) {
        throw new Error(spec.profile.name + ' seed ' + spec.seed + ' paid ' + capped.length + ' winners');
    }
    const winnerPhones = capped.map((w) => w.player.phone);
    if (spec.profile.name === 'depositor' || spec.profile.name === 'bonus' || spec.profile.name === 'mixed') {
        if (winnerPhones.indexOf(target.phone) === -1) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' missed target ' + target.phone + ' winners=' + winnerPhones.join(','));
        }
    }
    if (spec.profile.name === 'depositor' || spec.profile.name === 'bonus') {
        if (capped.some((w) => w.player.isBot)) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' pure user round also paid a bot');
        }
    }
    if (spec.profile.name === 'bot') {
        if (!capped.some((w) => w.player.isBot)) {
            throw new Error('bot seed ' + spec.seed + ' did not pay a bot');
        }
        if (winnerPhones.indexOf(target.phone) !== -1) {
            throw new Error('bot seed ' + spec.seed + ' also paid the target user');
        }
    }
    if (spec.profile.name === 'mixed') {
        const botWins = capped.filter((w) => w.player.isBot).length;
        if (botWins < 1) throw new Error('mixed seed ' + spec.seed + ' had no bot winner');
    }

    capped.forEach((winner) => {
        const snap = snapshots.get(winner.ticket.id);
        if (JSON.stringify(winner.ticket.grid) !== JSON.stringify(snap)) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' rewrote card ' + winner.ticket.id);
        }
        const closed = engine.closeWinningTicket(winner.ticket, called);
        if (!closed || winner.ticket.isClosed !== true) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' did not close card ' + winner.ticket.id);
        }
        if (JSON.stringify(winner.ticket.grid) !== JSON.stringify(snap)) {
            throw new Error(spec.profile.name + ' seed ' + spec.seed + ' close mutated card ' + winner.ticket.id);
        }
    });

    return { endCall, plan, profile: spec.profile.name, finishCall: spec.finishCall, winners: capped.length };
}

function runTimingSimulation() {
    engine.resetFinishRotation();
    const rounds = [];
    for (let i = 0; i < 12; i++) {
        const finishCall = engine.pullFinishCall();
        const profile = PROFILES[i % PROFILES.length];
        rounds.push(simulateRound({ seed: 5000 + i * 17, finishCall, profile }));
    }
    const ends = rounds.map((r) => r.endCall);
    ends.forEach((n) => {
        if (n < 14 || n > 23) throw new Error('end call ' + n + ' left 14-23');
    });
    if (new Set(ends).size < 3) {
        throw new Error('finish calls did not vary: ' + ends.join(','));
    }
    const emergency = engine.settleWinnerVault(
        { virtualPrizePool: 5, vaultTwoBalance: 10, vaultThreeBalance: 15 },
        { realMoneyOut: 40, isWinnerDepositor: true, realWinnersCount: 1, botWinnersCount: 1, totalWinners: 2, allowNegative: true }
    );
    if (emergency.balances.vaultThreeBalance !== -25) {
        throw new Error('emergency vault deficit was not recorded');
    }
    return {
        rounds,
        summary: 'timing sim ' + rounds.map((r) => r.profile + '@' + r.endCall + '/' + r.finishCall).join(' ')
    };
}

if (require.main === module) {
    try {
        const report = runTimingSimulation();
        console.log(report.summary);
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
    }
}

module.exports = { runTimingSimulation, simulateRound };
