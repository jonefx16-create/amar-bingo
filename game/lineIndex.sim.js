'use strict';

/**
 * Proves the pre-round line index:
 *   - agrees with full card scans (balls, completing numbers, wins)
 *   - keeps vault splits, the 14–23 window, and isClosed winners
 *   - selects the ball on calls 7 and 8 in under 1ms with no grid walks
 */

const engine = require('./index');

function fail(msg) {
    throw new Error(msg);
}

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

function sameNumbers(a, b) {
    const as = (a || []).map(Number).slice().sort(function (x, y) { return x - y; });
    const bs = (b || []).map(Number).slice().sort(function (x, y) { return x - y; });
    return as.length === bs.length && as.every(function (n, i) { return n === bs[i]; });
}

function cardsOf(players) {
    const out = [];
    (players || []).forEach(function (player) {
        (player.ticketsData || []).forEach(function (ticket) {
            out.push({ player: player, ticket: ticket });
        });
    });
    return out;
}

function naiveCompleting(players, called, pool) {
    const hits = [];
    for (let i = 0; i < pool.length; i++) {
        const n = pool[i];
        const temp = called.concat([n]);
        const found = cardsOf(players).some(function (card) {
            return engine.checkBingo(card.ticket.grid, temp) && !engine.checkBingo(card.ticket.grid, called);
        });
        if (found) hits.push(n);
    }
    return hits;
}

function seatRoom(spec) {
    const players = [];
    let id = 1;
    for (let i = 0; i < spec.humans; i++) {
        const tickets = [];
        const count = spec.humanCards;
        for (let t = 0; t < count; t++) {
            tickets.push({ id: id, grid: engine.generateFixedCard(id, spec.mix) });
            id += 1;
        }
        players.push({
            phone: 'human-' + i,
            name: 'human-' + i,
            isBot: false,
            hasDeposited: i % 2 === 0,
            ticketsData: tickets
        });
    }
    for (let i = 0; i < spec.bots; i++) {
        const tickets = [];
        for (let t = 0; t < spec.botCards; t++) {
            tickets.push({ id: id, grid: engine.generateFixedCard(id, spec.mix) });
            id += 1;
        }
        players.push({
            phone: 'bot-' + i,
            name: 'bot-' + i,
            isBot: true,
            ticketsData: tickets
        });
    }
    return players;
}

function drawContext(turn, finish, players, called, pool, completing, rng, lineIndex) {
    const humans = players.filter(function (p) { return !p.isBot; });
    const bots = players.filter(function (p) { return p.isBot; });
    const target = humans[0] ? [humans[0]] : [];
    const others = humans.slice(1);
    return {
        currentTurn: turn,
        finishCall: finish,
        forceWinner: 'mix',
        botCount: 1,
        called: called,
        pool: pool,
        targetPlayers: target,
        botPlayers: bots,
        others: others,
        completing: completing.all,
        botCompleting: completing.bots,
        userCompleting: completing.users,
        fourCorner: [],
        blockedCompleting: [],
        lineIndex: lineIndex,
        rng: rng,
        fullPrize: 100,
        depositor: true,
        vaultTwo: 500,
        virtualPool: 500
    };
}

function assertIndexedMatchesScans() {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const players = seatRoom({ humans: 4, bots: 12, humanCards: 2, botCards: 2, mix: 11 });
    const index = engine.buildRoundLineIndex(players);
    const calledA = [];
    const calledB = [];
    let poolA = shuffle(Array.from({ length: 75 }, function (_, i) { return i + 1; }), mulberry32(7));
    let poolB = poolA.slice();
    for (let turn = 1; turn <= 12; turn++) {
        const allA = naiveCompleting(players, calledA, poolA);
        const bots = players.filter(function (p) { return p.isBot; });
        const humans = players.filter(function (p) { return !p.isBot; });
        const botHits = naiveCompleting(bots, calledA, poolA);
        const userHits = naiveCompleting(humans, calledA, poolA);
        index.syncCalled(calledA);
        const classified = index.classifyPools(poolA, {
            blockedPhones: [],
            eligibleRealPhones: humans.map(function (p) { return p.phone; }),
            depositorPhones: humans.filter(function (p) { return p.hasDeposited; }).map(function (p) { return p.phone; })
        });
        const indexedAll = [];
        poolA.forEach(function (n) {
            if (classified.winForBots.indexOf(n) !== -1 || classified.winForEligibleReal.indexOf(n) !== -1) indexedAll.push(n);
        });
        if (!sameNumbers(indexedAll, allA)) {
            fail('call ' + turn + ' completing map diverged from a card scan');
        }
        const away = index.oneAwayNumbers(humans, {});
        const naiveAway = [];
        const seen = new Set();
        humans.forEach(function (player) {
            player.ticketsData.forEach(function (ticket) {
                engine.oneAwayNumbers(ticket.grid, calledA).forEach(function (n) {
                    if (seen.has(n)) return;
                    seen.add(n);
                    naiveAway.push(n);
                });
            });
        });
        if (!sameNumbers(away, naiveAway)) fail('call ' + turn + ' one-away map diverged');

        const choiceA = engine.chooseDrawnBall(drawContext(turn, 18, players, calledA, poolA, {
            all: allA,
            bots: botHits,
            users: userHits
        }, rngA, index));
        const choiceB = engine.chooseDrawnBall(drawContext(turn, 18, players, calledB, poolB, {
            all: allA,
            bots: botHits,
            users: userHits
        }, rngB, null));
        if (!choiceA || !choiceB || choiceA.num !== choiceB.num || choiceA.plan !== choiceB.plan) {
            fail('call ' + turn + ' indexed ball ' + (choiceA && choiceA.num) + '/' + (choiceA && choiceA.plan)
                + ' != scan ball ' + (choiceB && choiceB.num) + '/' + (choiceB && choiceB.plan));
        }
        poolA = poolA.filter(function (n) { return n !== choiceA.num; });
        poolB = poolB.filter(function (n) { return n !== choiceB.num; });
        calledA.push(choiceA.num);
        calledB.push(choiceB.num);
        index.noteCalled(choiceA.num);
        const bingoNow = cardsOf(players).filter(function (card) {
            return engine.checkBingo(card.ticket.grid, calledA);
        });
        const indexedWins = index.completeCards();
        if (bingoNow.length !== indexedWins.length) {
            fail('call ' + turn + ' winner set size ' + indexedWins.length + ' != ' + bingoNow.length);
        }
    }

    const wideA = mulberry32(5);
    const wideB = mulberry32(5);
    const widePlayers = seatRoom({ humans: 6, bots: 40, humanCards: 4, botCards: 2, mix: 3 });
    const wideIndex = engine.buildRoundLineIndex(widePlayers);
    let widePoolA = shuffle(Array.from({ length: 75 }, function (_, i) { return i + 1; }), mulberry32(9));
    let widePoolB = widePoolA.slice();
    const wideCalledA = [];
    const wideCalledB = [];
    for (let turn = 1; turn <= 10; turn++) {
        const ctxBase = drawContext(turn, 19, widePlayers, wideCalledA, widePoolA, {
            all: [],
            bots: [],
            users: []
        }, wideA, wideIndex);
        ctxBase.botCount = 4;
        const ctxScan = drawContext(turn, 19, widePlayers, wideCalledB, widePoolB, {
            all: [],
            bots: [],
            users: []
        }, wideB, null);
        ctxScan.botCount = 4;
        const choiceA = engine.chooseDrawnBall(ctxBase);
        const choiceB = engine.chooseDrawnBall(ctxScan);
        if (!choiceA || !choiceB || choiceA.num !== choiceB.num || choiceA.plan !== choiceB.plan) {
            fail('wide call ' + turn + ' indexed ball ' + (choiceA && choiceA.num) + '/' + (choiceA && choiceA.plan)
                + ' != scan ball ' + (choiceB && choiceB.num) + '/' + (choiceB && choiceB.plan));
        }
        widePoolA = widePoolA.filter(function (n) { return n !== choiceA.num; });
        widePoolB = widePoolB.filter(function (n) { return n !== choiceB.num; });
        wideCalledA.push(choiceA.num);
        wideCalledB.push(choiceB.num);
        wideIndex.noteCalled(choiceA.num);
    }

    ['bots', 'real'].forEach(function (mode) {
        const modeA = mulberry32(mode === 'bots' ? 15 : 16);
        const modeB = mulberry32(mode === 'bots' ? 15 : 16);
        const modeIndex = engine.buildRoundLineIndex(players);
        let modePoolA = shuffle(Array.from({ length: 75 }, function (_, i) { return i + 1; }), mulberry32(4));
        let modePoolB = modePoolA.slice();
        const modeCalledA = [];
        const modeCalledB = [];
        for (let turn = 1; turn <= 10; turn++) {
            const ctxA = drawContext(turn, 18, players, modeCalledA, modePoolA, { all: [], bots: [], users: [] }, modeA, modeIndex);
            const ctxB = drawContext(turn, 18, players, modeCalledB, modePoolB, { all: [], bots: [], users: [] }, modeB, null);
            ctxA.forceWinner = mode;
            ctxB.forceWinner = mode;
            ctxA.botCount = mode === 'real' ? 0 : 1;
            ctxB.botCount = ctxA.botCount;
            const choiceA = engine.chooseDrawnBall(ctxA);
            const choiceB = engine.chooseDrawnBall(ctxB);
            if (!choiceA || !choiceB || choiceA.num !== choiceB.num || choiceA.plan !== choiceB.plan) {
                fail(mode + ' call ' + turn + ' indexed ball ' + (choiceA && choiceA.num) + '/' + (choiceA && choiceA.plan)
                    + ' != scan ball ' + (choiceB && choiceB.num) + '/' + (choiceB && choiceB.plan));
            }
            modePoolA = modePoolA.filter(function (n) { return n !== choiceA.num; });
            modePoolB = modePoolB.filter(function (n) { return n !== choiceB.num; });
            modeCalledA.push(choiceA.num);
            modeCalledB.push(choiceB.num);
            modeIndex.noteCalled(choiceA.num);
        }
    });
}

function assertVaultAndCardInvariants() {
    const split = engine.computeEvenSplit(100, 4);
    if (split !== 25) fail('even split changed: ' + split);
    const start = { virtualPrizePool: 5, vaultTwoBalance: 10, vaultThreeBalance: 15 };
    const clamped = engine.settleWinnerVault(start, {
        realMoneyOut: 40,
        isWinnerDepositor: false,
        realWinnersCount: 1,
        botWinnersCount: 2,
        totalWinners: 3,
        allowNegative: false
    });
    if (clamped.charged !== 'virtualPrizePool' || clamped.balances.virtualPrizePool !== 0) {
        fail('human debit did not clamp the virtual vault');
    }
    if (clamped.balances.vaultTwoBalance !== 10 || clamped.balances.vaultThreeBalance !== 15) {
        fail('human debit touched a vault that should have stayed put');
    }
    const noHuman = engine.settleWinnerVault(start, {
        realMoneyOut: 0,
        isWinnerDepositor: false,
        realWinnersCount: 0,
        botWinnersCount: 3,
        totalWinners: 3,
        allowNegative: false
    });
    if (noHuman.charged !== null || noHuman.balances.virtualPrizePool !== 5) {
        fail('a bot-only result debited a vault');
    }
    const emergency = engine.settleWinnerVault(start, {
        realMoneyOut: 40,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 1,
        totalWinners: 2,
        allowNegative: true
    });
    if (emergency.balances.vaultThreeBalance !== -25) fail('negative vault deficit was clamped');
    const capped = engine.capWinnerList([1, 2, 3, 4, 5, 6, 7].map(function (id) {
        return { player: { isBot: true, phone: 'b' + id }, ticket: { id: id } };
    }), 5);
    if (capped.length !== 5) fail('winner cap moved off 5');

    const ticket = { id: 3, grid: [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 'FREE', 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65]
    ] };
    const snap = JSON.parse(JSON.stringify(ticket.grid));
    if (!engine.closeWinningTicket(ticket, [1, 2, 3, 4, 5])) fail('authentic row did not close');
    if (ticket.isClosed !== true) fail('winning card was not saved with isClosed');
    if (JSON.stringify(ticket.grid) !== JSON.stringify(snap)) fail('close rewrote the card');
}

function elapsedMs(fn) {
    const start = process.hrtime.bigint();
    const value = fn();
    return { ms: Number(process.hrtime.bigint() - start) / 1e6, value: value };
}

function assertCall7And8UnderOneMillisecond() {
    const players = seatRoom({ humans: 20, bots: 320, humanCards: 4, botCards: 1, mix: 99 });
    if (players.reduce(function (sum, p) { return sum + p.ticketsData.length; }, 0) < 300) {
        fail('latency room was too small');
    }
    const registry = engine.createRoundRegistry();
    const seated = {};
    players.forEach(function (player) { seated[player.phone] = player; });
    registry.freeze(seated);
    if (registry.canAcceptRegistration()) fail('buy-in freeze did not hold');
    const index = engine.buildRoundLineIndex(seated);
    const walks = index.gridWalks;
    engine.primeDrawLookup(index, seated);
    const rng = mulberry32(99);
    let pool = shuffle(Array.from({ length: 75 }, function (_, i) { return i + 1; }), mulberry32(3));
    const called = [];
    const samples = {};
    for (let turn = 1; turn <= 16; turn++) {
        index.syncCalled(called);
        const humans = players.filter(function (p) { return !p.isBot; });
        const bots = players.filter(function (p) { return p.isBot; });
        const target = humans[0] ? [humans[0]] : [];
        const others = humans.slice(1);
        const eligiblePhones = humans.slice(1).map(function (p) { return p.phone; });
        const depositorPhones = humans.filter(function (p) { return p.hasDeposited; }).map(function (p) { return p.phone; });
        const measured = elapsedMs(function () {
            const classified = index.classifyPools(pool, {
                blockedPhones: ['human-0'],
                eligibleRealPhones: eligiblePhones,
                depositorPhones: depositorPhones
            });
            const restricted = index.restrictedHits(pool, function (player) {
                return player.phone === 'human-0';
            });
            return engine.chooseDrawnBall({
                currentTurn: turn,
                finishCall: 19,
                forceWinner: 'mix',
                botCount: 1,
                called: called,
                pool: pool,
                targetPlayers: target,
                botPlayers: bots,
                others: others,
                completing: classified.winForBots.concat(classified.winForEligibleReal, classified.winForBlocked),
                botCompleting: classified.winForBots,
                userCompleting: classified.winForEligibleReal,
                fourCorner: restricted.fourCorner,
                blockedCompleting: restricted.blocked,
                lineIndex: index,
                rng: rng,
                fullPrize: 100,
                depositor: true,
                vaultTwo: 500,
                virtualPool: 500
            });
        });
        const choice = measured.value;
        if (!choice || choice.num == null) fail('call ' + turn + ' did not select a ball');
        if (turn === 7 || turn === 8) samples[turn] = measured.ms;
        if (turn >= 7 && measured.ms >= 1) {
            fail('call ' + turn + ' ball selection took ' + measured.ms.toFixed(3) + 'ms');
        }
        pool = pool.filter(function (n) { return n !== choice.num; });
        called.push(choice.num);
        index.noteCalled(choice.num);
    }
    if (index.gridWalks !== walks || index.drawGridWalks !== 0) {
        fail('draw ticks walked card grids');
    }
    const humans = players.filter(function (p) { return !p.isBot; });
    const bots = players.filter(function (p) { return p.isBot; });
    const target = humans[0] ? [humans[0]] : [];
    const others = humans.slice(1);
    const profiles = [
        { name: 'mix-4', forceWinner: 'mix', botCount: 4 },
        { name: 'bots', forceWinner: 'bots', botCount: 1 },
        { name: 'real', forceWinner: 'real', botCount: 0 }
    ];
    for (let i = 0; i < profiles.length; i++) {
        const spec = profiles[i];
        const measured = elapsedMs(function () {
            return engine.chooseDrawnBall({
                currentTurn: 8,
                finishCall: 19,
                forceWinner: spec.forceWinner,
                botCount: spec.botCount,
                called: called,
                pool: pool,
                targetPlayers: target,
                botPlayers: bots,
                others: others,
                completing: [],
                botCompleting: [],
                userCompleting: [],
                fourCorner: [],
                blockedCompleting: [],
                lineIndex: index,
                rng: mulberry32(11 + i),
                fullPrize: 100,
                depositor: true,
                vaultTwo: 500,
                virtualPool: 500
            });
        });
        if (measured.ms >= 1) {
            fail(spec.name + ' call 8 ball selection took ' + measured.ms.toFixed(3) + 'ms');
        }
    }
    if (index.gridWalks !== walks || index.drawGridWalks !== 0) {
        fail('profile ticks walked card grids');
    }
    return {
        call7: samples[7],
        call8: samples[8],
        cards: index.cardCount,
        lines: index.lineCount
    };
}

function sampleGrid() {
    return [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 'FREE', 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65]
    ];
}

function drawUntilFiveMatch(grid, sequence) {
    const player = {
        phone: '0911000001',
        name: 'Solo',
        isBot: false,
        ticketsData: [{ id: 12, grid: grid }]
    };
    const active = { p: player };
    const entries = [{ phone: player.phone, ticketId: 12, grid: grid, status: 'active' }];
    const index = engine.buildRoundLineIndex([player]);
    const called = [];
    let tick = null;
    for (let i = 0; i < sequence.length; i++) {
        if (index.hasComplete()) break;
        called.push(sequence[i]);
        index.noteCalled(sequence[i]);
        tick = engine.evaluateBingoTick(active, entries, called);
        if (tick.lockRound || index.hasComplete()) break;
    }
    return { called: called, tick: tick, complete: index.hasComplete() };
}

function assertWarmupMapAndZeroSkip() {
    const grid = sampleGrid();
    const player = { phone: 'h', isBot: false, ticketsData: [{ id: 1, grid: grid }] };
    const index = engine.buildRoundLineIndex([player]);
    const walks = index.gridWalks;
    engine.mapEarlyDrawTrajectories(index);
    if (index.calledSnapshot().length !== 0 || index.hasComplete()) {
        fail('warmup did not restore an empty called list');
    }
    if (index.gridWalks !== walks || index.drawGridWalks !== 0) fail('warmup walked card grids');
    if (!index.earlyTrajectory || index.earlyTrajectory.length !== 10) {
        fail('warmup trajectory was not 10 calls');
    }
    if (index.earlyOneAwayByCall.length !== 10) fail('warmup did not record each early call');
    if (index.earlyHorizon[2] !== 5 || index.earlyRisk[2] !== 1) {
        fail('number 2 horizon ' + index.earlyHorizon[2] + ' risk ' + index.earlyRisk[2]);
    }
    if (index.earlyRisk[75] !== 0) fail('a number on no line was marked an early risk');
    const replay = engine.buildRoundLineIndex([player]);
    for (let i = 0; i < index.earlyTrajectory.length; i++) replay.noteCalled(index.earlyTrajectory[i]);
    if (engine.checkBingo(grid, index.earlyTrajectory) || replay.hasComplete()) {
        fail('warmup trajectory completed a line');
    }
    for (let n = 1; n <= 75; n++) {
        const bucket = replay.completing[n];
        if (bucket && bucket.length) fail('warmup trajectory left a card one away on ' + n);
    }

    const patterns = [
        { name: 'row', balls: [1, 2, 3, 4, 5, 6, 7], last: 5 },
        { name: 'column', balls: [1, 16, 31, 46, 61, 6, 7], last: 61 },
        { name: 'diagonal', balls: [1, 17, 49, 65, 6, 7], last: 65 },
        { name: 'corners', balls: [1, 61, 5, 65, 6, 7], last: 65 }
    ];
    for (let i = 0; i < patterns.length; i++) {
        const spec = patterns[i];
        const drawn = drawUntilFiveMatch(grid, spec.balls);
        if (!drawn.complete || !drawn.tick || drawn.tick.lockReason !== engine.USER_5_MATCH_LOCK) {
            fail(spec.name + ' 5-match was not locked');
        }
        if (drawn.called[drawn.called.length - 1] !== spec.last) {
            fail(spec.name + ' locked on ' + drawn.called[drawn.called.length - 1]);
        }
        if (drawn.called.indexOf(6) !== -1 || drawn.called.indexOf(7) !== -1) {
            fail(spec.name + ' rolled past the completed card: ' + drawn.called.join(','));
        }
    }

    const human = { player: { isBot: false, phone: '0911555000', hasDeposited: true }, ticket: { id: 12 } };
    let injected = 0;
    const underfunded = engine.applyPanicShield([human], {
        calledCount: 5,
        plannedClose: false,
        blocked: false,
        fullPrize: 100,
        depositor: true,
        vaultTwo: 12,
        virtualPool: 8,
        injectBot: function (list) {
            injected += 1;
            list.push({ player: { isBot: true, phone: 'panic-' + injected }, ticket: { id: 500 + injected } });
            return true;
        }
    });
    if (!underfunded.panic || !underfunded.allowNegative || underfunded.reason !== 'underfunded') {
        fail('underfunded human 5-match did not open the panic shield');
    }
    if (injected !== 4 || underfunded.winners.length !== 5) fail('panic shield did not cap winners at 5');
    if (underfunded.winners[0].player.phone !== human.player.phone) fail('panic shield dropped the human');
    const share = engine.computeEvenSplit(100, underfunded.winners.length);
    const settled = engine.settleWinnerVault(
        { virtualPrizePool: 8, vaultTwoBalance: 12, vaultThreeBalance: 4 },
        {
            realMoneyOut: share,
            isWinnerDepositor: true,
            realWinnersCount: 1,
            botWinnersCount: 4,
            totalWinners: 5,
            allowNegative: underfunded.allowNegative
        }
    );
    if (share !== 20 || settled.balances.virtualPrizePool !== -12) {
        fail('underfunded panic did not record virtual 8 - 20 = -12');
    }

    let coveredInjected = false;
    const covered = engine.applyPanicShield([human], {
        calledCount: 5,
        plannedClose: false,
        blocked: false,
        fullPrize: 100,
        depositor: true,
        vaultTwo: 500,
        virtualPool: 8,
        injectBot: function () { coveredInjected = true; return true; }
    });
    if (covered.panic || covered.allowNegative || covered.reason !== 'vault-covered' || covered.winners.length !== 1 || coveredInjected) {
        fail('a covered solo was split');
    }

    const planned = engine.applyPanicShield([human], {
        calledCount: 18,
        plannedClose: true,
        blocked: false,
        fullPrize: 100,
        depositor: true,
        vaultTwo: 500,
        virtualPool: 500,
        injectBot: function () { fail('a planned 14–23 close injected a panic bot'); }
    });
    if (planned.panic || planned.reason !== 'planned') fail('planned close entered the panic shield');

    const botOnly = engine.applyPanicShield([
        { player: { isBot: true, phone: 'b1' }, ticket: { id: 1 } },
        { player: { isBot: true, phone: 'b2' }, ticket: { id: 2 } }
    ], {
        calledCount: 16,
        injectBot: function () { fail('bot-only win injected another bot'); }
    });
    if (botOnly.reason !== 'bot-only' || botOnly.allowNegative) fail('bot-only win was treated as a human payout');
    const house = engine.settleWinnerVault(
        { virtualPrizePool: 40, vaultTwoBalance: 10, vaultThreeBalance: 10 },
        { realMoneyOut: 0, isWinnerDepositor: false, realWinnersCount: 0, botWinnersCount: 2, totalWinners: 2, allowNegative: botOnly.allowNegative }
    );
    if (house.charged !== null || house.balances.virtualPrizePool !== 40) fail('bot-only win debited a vault');

    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    ['useEarlyMap', 'USER_5_MATCH_LOCK', 'roundResolutionLocked', 'applyPanicShield', 'primeDrawLookup', 'allowNegativeVault', 'pullFinishCall', 'bookCardPurchase'].forEach(function (token) {
        if (server.indexOf(token) === -1) fail('server is missing ' + token);
    });
    if (server.indexOf('shapeCardsLeaderboard(rows).slice') === -1) fail('leaderboard shaping changed');
}

function assertEarlyMappedCallsUnderOneMillisecond() {
    const players = seatRoom({ humans: 20, bots: 320, humanCards: 4, botCards: 1, mix: 77 });
    const seated = {};
    players.forEach(function (player) { seated[player.phone] = player; });
    const index = engine.buildRoundLineIndex(seated);
    const walks = index.gridWalks;
    engine.primeDrawLookup(index, seated);
    if (!index.earlyHorizon || !index.earlyTrajectory || index.earlyTrajectory.length !== 10) {
        fail('card lock did not map calls 1–10');
    }
    if (index.calledSnapshot().length !== 0) fail('card-lock warmup left the called list dirty');
    const humans = players.filter(function (p) { return !p.isBot; });
    const bots = players.filter(function (p) { return p.isBot; });
    const rng = mulberry32(21);
    let pool = shuffle(Array.from({ length: 75 }, function (_, i) { return i + 1; }), mulberry32(8));
    const called = [];
    function choose(turn) {
        index.syncCalled(called);
        const classified = index.classifyPools(pool, {
            blockedPhones: ['human-0'],
            eligibleRealPhones: humans.slice(1).map(function (p) { return p.phone; }),
            depositorPhones: humans.filter(function (p) { return p.hasDeposited; }).map(function (p) { return p.phone; })
        });
        const restricted = index.restrictedHits(pool, function (player) {
            return player.phone === 'human-0';
        });
        return engine.chooseDrawnBall({
            currentTurn: turn,
            finishCall: 19,
            forceWinner: 'mix',
            botCount: 1,
            called: called,
            pool: pool,
            targetPlayers: humans[0] ? [humans[0]] : [],
            botPlayers: bots,
            others: humans.slice(1),
            completing: classified.winForBots.concat(classified.winForEligibleReal, classified.winForBlocked),
            botCompleting: classified.winForBots,
            userCompleting: classified.winForEligibleReal,
            fourCorner: restricted.fourCorner,
            blockedCompleting: restricted.blocked,
            lineIndex: index,
            useEarlyMap: true,
            rng: rng,
            fullPrize: 100,
            depositor: true,
            vaultTwo: 500,
            virtualPool: 500
        });
    }
    for (let turn = 1; turn <= 9; turn++) {
        const choice = choose(turn);
        if (!choice || choice.num == null || choice.plan !== 'safe') fail('scatter call ' + turn + ' plan ' + (choice && choice.plan));
        if (index.leavesOneAway(choice.num)) fail('scatter call ' + turn + ' would leave a card one away');
        pool = pool.filter(function (n) { return n !== choice.num; });
        called.push(choice.num);
        index.noteCalled(choice.num);
    }
    const samples = {};
    for (let turn = 10; turn <= 11; turn++) {
        const measured = elapsedMs(function () { return choose(turn); });
        const choice = measured.value;
        if (!choice || choice.num == null) fail('call ' + turn + ' did not select a ball');
        if (turn === 10 && choice.plan !== 'safe') fail('call 10 entered the line builder: ' + choice.plan);
        if (turn === 10 && index.leavesOneAway(choice.num)) fail('call 10 would leave a card one away');
        if (turn === 11 && choice.plan === 'safe') fail('call 11 stayed in the scatter phase');
        if (measured.ms >= 1) fail('staged call ' + turn + ' took ' + measured.ms.toFixed(3) + 'ms');
        samples[turn] = measured.ms;
        pool = pool.filter(function (n) { return n !== choice.num; });
        called.push(choice.num);
        index.noteCalled(choice.num);
    }
    if (index.gridWalks !== walks || index.drawGridWalks !== 0) fail('early-mapped ticks walked card grids');
    return { call7: samples[10], call8: samples[11] };
}

function runLineIndexSimulation() {
    assertIndexedMatchesScans();
    assertVaultAndCardInvariants();
    const report = require('./roundTiming.sim').runTimingSimulation();
    report.rounds.forEach(function (round) {
        if (round.endCall < 14 || round.endCall > 23) fail('timing window broke at ' + round.endCall);
        if (round.winners > 5) fail('timing round paid more than 5');
    });
    const latency = assertCall7And8UnderOneMillisecond();
    assertWarmupMapAndZeroSkip();
    const early = assertEarlyMappedCallsUnderOneMillisecond();
    return {
        latency: latency,
        early: early,
        timing: report.summary
    };
}

if (require.main === module) {
    try {
        const report = runLineIndexSimulation();
        console.log(
            'line-index sim cards=' + report.latency.cards
            + ' lines=' + report.latency.lines
            + ' call7=' + report.latency.call7.toFixed(3) + 'ms'
            + ' call8=' + report.latency.call8.toFixed(3) + 'ms'
            + ' early10=' + report.early.call7.toFixed(3) + 'ms'
            + ' early11=' + report.early.call8.toFixed(3) + 'ms'
            + ' | ' + report.timing
        );
    } catch (err) {
        console.error(err && err.stack ? err.stack : err);
        process.exit(1);
    }
}

module.exports = { runLineIndexSimulation };
