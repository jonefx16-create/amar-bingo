'use strict';

const assert = require('assert');
const engine = require('./index');

function makeGrid(rowsAsCols) {
    return rowsAsCols;
}

function fullHouseCalled(grid) {
    const nums = [];
    for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 5; r++) {
            if (grid[c][r] !== 'FREE') nums.push(grid[c][r]);
        }
    }
    return nums;
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

let passed = 0;
const pendingTests = [];
function test(name, fn) {
    let result;
    try {
        result = fn();
    } catch (err) {
        console.error('not ok - ' + name);
        throw err;
    }
    if (result && typeof result.then === 'function') {
        pendingTests.push(result.then(() => {
            passed += 1;
            console.log('ok - ' + name);
        }));
        return;
    }
    passed += 1;
    console.log('ok - ' + name);
}

test('checkBingo detects a completed row', () => {
    const grid = rowWinGrid();
    assert.strictEqual(engine.checkBingo(grid, [1, 2, 3, 4, 5]), true);
    assert.strictEqual(engine.checkBingo(grid, [1, 2, 3, 4]), false);
});

test('checkBingo detects a column including FREE', () => {
    const grid = rowWinGrid();
    assert.strictEqual(engine.checkBingo(grid, [31, 32, 34, 35]), true);
});

test('checkBingo detects diagonal and four corners', () => {
    const grid = rowWinGrid();
    assert.strictEqual(engine.checkBingo(grid, [1, 17, 49, 65]), true);
    assert.strictEqual(engine.checkBingo(grid, [1, 5, 61, 65]), true);
});

test('classifyPlayer tags standard depositors', () => {
    const elig = engine.classifyPlayer(
        { phone: '0911', isBot: false, hasDeposited: true, realBetAmount: 20 },
        { allowBonusWin: false, activeCooldowns: {}, timeBans: {} }
    );
    assert.strictEqual(elig.tier, engine.TIER.STANDARD);
    assert.strictEqual(elig.prizeLane, engine.PRIZE_LANE.TREASURY);
    assert.strictEqual(elig.blocked, false);
    assert.strictEqual(elig.useHighVarianceCards, false);
});

test('classifyPlayer tags bonus-credit and cooldown players', () => {
    const bonus = engine.classifyPlayer(
        { phone: '0912', isBot: false, hasDeposited: false, realBetAmount: 0 },
        { allowBonusWin: false, activeCooldowns: {}, timeBans: {} }
    );
    assert.strictEqual(bonus.tier, engine.TIER.BONUS_CREDIT);
    assert.strictEqual(bonus.prizeLane, engine.PRIZE_LANE.BONUS);
    assert.strictEqual(bonus.blocked, true);
    assert.strictEqual(bonus.useHighVarianceCards, true);

    const cool = engine.classifyPlayer(
        { phone: '0913', isBot: false, hasDeposited: true, realBetAmount: 10 },
        { allowBonusWin: true, activeCooldowns: { '0913': 5 }, timeBans: {} }
    );
    assert.strictEqual(cool.tier, engine.TIER.COOLDOWN);
    assert.strictEqual(cool.blocked, true);
    assert.strictEqual(cool.useHighVarianceCards, true);
});

test('buildEligibilitySets preserves depositor vs bonus membership', () => {
    const players = [
        { phone: 'a', hasDeposited: true },
        { phone: 'b', hasDeposited: false },
        { phone: 'c', hasDeposited: true }
    ];
    const sets = engine.buildEligibilitySets(players, {
        allowBonusWin: false,
        activeCooldowns: { c: 2 },
        timeBans: {}
    });
    assert.deepStrictEqual(sets.depositorPhones, ['a']);
    assert.deepStrictEqual(sets.blockedPhones.sort(), ['b', 'c']);
    assert.deepStrictEqual(sets.eligibleBonusPhones, []);
});

test('bonus win chance blocks bonus-funded stakes and still pays real play-balance stakes', () => {
    const deny = { allowBonusWin: false, activeCooldowns: {}, timeBans: {} };
    const allow = { allowBonusWin: true, activeCooldowns: {}, timeBans: {} };

    const realPlay = engine.classifyPlayer(
        { phone: 'real', isBot: false, hasDeposited: true, realBetAmount: 0, bonusBetAmount: 0 },
        deny
    );
    assert.strictEqual(realPlay.blocked, false);
    assert.strictEqual(realPlay.tier, engine.TIER.STANDARD);
    assert.strictEqual(engine.isTargetPoolBaseEligible(
        { phone: 'real', isBot: false, hasDeposited: true, realBetAmount: 0, bonusBetAmount: 0 },
        deny
    ), true);
    assert.strictEqual(engine.bonusWinDenied(
        { phone: 'zero', isBot: false, hasDeposited: true, totalDeposited: 0, realBetAmount: 20 },
        deny
    ), true);
    assert.strictEqual(engine.classifyPlayer(
        { phone: 'zero', isBot: false, hasDeposited: true, totalDeposited: 0, realBetAmount: 20 },
        deny
    ).blocked, true);

    assert.strictEqual(engine.classifyPlayer(
        { phone: 'bonusdep', isBot: false, hasDeposited: true, realBetAmount: 0, bonusBetAmount: 10 },
        deny
    ).blocked, true);
    assert.strictEqual(engine.classifyPlayer(
        { phone: 'bonusdep', isBot: false, hasDeposited: true, realBetAmount: 0, bonusBetAmount: 10 },
        allow
    ).blocked, false);
    assert.strictEqual(engine.classifyPlayer(
        { phone: 'mix', isBot: false, hasDeposited: true, realBetAmount: 6, bonusBetAmount: 4 },
        deny
    ).blocked, true);
    assert.strictEqual(engine.classifyPlayer(
        {
            phone: 'card',
            isBot: false,
            hasDeposited: true,
            realBetAmount: 0,
            ticketsData: [{ paidFromBonus: 10, paidFromMain: 0 }]
        },
        deny
    ).blocked, true);

    const sets = engine.buildEligibilitySets([
        { phone: 'real', hasDeposited: true, realBetAmount: 0, bonusBetAmount: 0 },
        { phone: 'bonusdep', hasDeposited: true, realBetAmount: 0, bonusBetAmount: 10 },
        { phone: 'fresh', hasDeposited: false, realBetAmount: 0 }
    ], deny);
    assert.deepStrictEqual(sets.depositorPhones, ['real']);
    assert.deepStrictEqual(sets.blockedPhones.sort(), ['bonusdep', 'fresh']);

    const flaggedZero = {
        phone: 'flagged',
        isBot: false,
        hasDeposited: true,
        totalDeposited: 0,
        realBetAmount: 10,
        bonusBetAmount: 0
    };
    const zeroSets = engine.buildEligibilitySets([flaggedZero, {
        phone: 'payer',
        isBot: false,
        hasDeposited: false,
        totalDeposited: 80,
        realBetAmount: 10,
        bonusBetAmount: 0
    }], deny);
    assert.deepStrictEqual(zeroSets.depositorPhones, ['payer']);
    assert.ok(zeroSets.blockedPhones.indexOf('flagged') !== -1);
    assert.strictEqual(engine.canTargetForWin(flaggedZero, deny), false);
    assert.strictEqual(engine.canTargetForWin(flaggedZero, allow), true);
    assert.strictEqual(engine.canTargetForWin({ phone: 'payer', isBot: false, totalDeposited: 80, realBetAmount: 10 }, deny), true);

    const winners = [
        { player: { phone: 'bonusdep', isBot: false, hasDeposited: true, bonusBetAmount: 10 }, ticket: { id: 1 } },
        { player: { phone: 'real', isBot: false, hasDeposited: true, realBetAmount: 10, bonusBetAmount: 0 }, ticket: { id: 2 } },
        { player: { phone: 'bot', isBot: true }, ticket: { id: 3 } },
        { player: { phone: 'fresh', isBot: false, hasDeposited: false, realBetAmount: 0 }, ticket: { id: 4 } }
    ];
    assert.deepStrictEqual(engine.dropDeniedBonusWinners(winners, deny).map((w) => w.player.phone), ['real', 'bot']);
    assert.strictEqual(engine.dropDeniedBonusWinners(winners, allow).length, 4);
    assert.strictEqual(engine.excludeRestrictedWinners(winners, deny).map((w) => w.player.phone).indexOf('bonusdep'), -1);

    const splitReal = engine.splitPlayStake(10, 100);
    assert.strictEqual(splitReal.bonusFromPlay, 0);
    assert.strictEqual(splitReal.realFromPlay, 10);
    assert.strictEqual(splitReal.nextUnplayed, 90);
    const splitBonus = engine.splitPlayStake(10, 4);
    assert.strictEqual(splitBonus.realFromPlay, 4);
    assert.strictEqual(splitBonus.bonusFromPlay, 6);
    assert.strictEqual(splitBonus.nextUnplayed, 0);
    assert.strictEqual(engine.splitPlayStake(10, 0).bonusFromPlay, 10);

    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    assert.ok(server.indexOf('dropDeniedBonusWinners(winners, winCtx.eligCtx)') !== -1);
    assert.ok(server.indexOf('declareWinners(winnersThisRound, { allowNegativeVault, eligCtx })') !== -1);
    assert.ok(server.indexOf('bonusWinPercent > 0 && (Math.random() * 100) < bonusWinPercent') !== -1);
    assert.ok(server.indexOf('function lockRoundAllowBonusWin') !== -1);
    assert.ok(server.indexOf('mainDeducted + stakeSplit.realFromPlay') !== -1);
    const bonusGrid = rowWinGrid();
    const quiet = [
        [11, 16, 31, 46, 61],
        [12, 17, 32, 47, 62],
        [13, 18, 'FREE', 48, 63],
        [14, 19, 34, 49, 64],
        [15, 20, 35, 50, 65]
    ];
    const room = {
        b: { phone: 'b', isBot: false, hasDeposited: false, totalDeposited: 0, ticketsData: [{ id: 1, grid: bonusGrid }] },
        r: { phone: 'r', isBot: false, hasDeposited: true, totalDeposited: 40, realBetAmount: 10, bonusBetAmount: 0, ticketsData: [{ id: 2, grid: quiet }] }
    };
    const called = [1, 2, 3, 4];
    assert.ok(engine.allowedBonusReleaseNumbers(room, called, [5, 15], allow, null, []).indexOf(5) !== -1);
    assert.deepStrictEqual(engine.allowedBonusReleaseNumbers(room, called, [5, 15], deny, null, []), []);
    const sharedRoom = {
        b: room.b,
        r: { phone: 'r', isBot: false, hasDeposited: true, totalDeposited: 40, realBetAmount: 10, bonusBetAmount: 0, ticketsData: [{ id: 2, grid: bonusGrid }] }
    };
    assert.deepStrictEqual(engine.allowedBonusReleaseNumbers(sharedRoom, called, [5], allow, null, []), []);
    assert.ok(server.indexOf('.skip((page - 1) * pageSize)') !== -1);
    assert.ok(/id="search-cooldown-phone"/.test(admin));
    assert.ok(/id="pag-player-bets"/.test(admin));
    assert.ok(/searchPlayerBets\(1\)/.test(admin));
});

test('generateFixedCard keeps the original seeded scramble', () => {
    assert.deepStrictEqual(engine.generateFixedCard(1), [[9,10,11,4,3],[23,21,25,19,26],[41,42,"FREE",35,32],[52,55,46,58,59],[72,65,66,63,70]]);
    assert.deepStrictEqual(engine.generateFixedCard(250), [[1,3,5,12,10],[19,17,23,20,27],[33,44,"FREE",43,37],[56,49,60,55,52],[61,66,75,74,67]]);
});

test('generateFixedCard is deterministic and valid', () => {
    const a = engine.generateFixedCard(42);
    const b = engine.generateFixedCard(42);
    assert.deepStrictEqual(a, b);
    assert.ok(engine.assertValidBingoGrid(a));
    assert.notDeepStrictEqual(engine.generateFixedCard(42), engine.generateFixedCard(43));
});

test('generateHighVarianceCard is stratified, valid, and distinct from standard', () => {
    const hv = engine.generateHighVarianceCard(42);
    const std = engine.generateFixedCard(42);
    assert.ok(engine.assertValidBingoGrid(hv));
    assert.deepStrictEqual(hv, engine.generateHighVarianceCard(42));
    assert.notDeepStrictEqual(hv, std);

    for (let c = 0; c < 5; c++) {
        const col = hv[c].filter((v) => v !== 'FREE').map(Number).sort((x, y) => x - y);
        for (let i = 1; i < col.length; i++) {
            assert.ok(col[i] > col[i - 1], 'column values unique and ordered after sort');
        }
        const min = c * 15 + 1;
        const bucketSize = 3;
        const buckets = new Set(col.map((n) => Math.floor((n - min) / bucketSize)));
        assert.strictEqual(buckets.size, col.length, 'one pick per column third');
    }
});

test('applyCardFilterToTickets only rewrites bonus/cooldown cards', () => {
    const tickets = [{ id: 7, grid: engine.generateFixedCard(7) }];
    const original = tickets[0].grid.map((col) => col.slice());
    engine.applyCardFilterToTickets(tickets, { useHighVarianceCards: false });
    assert.deepStrictEqual(tickets[0].grid, original);
    engine.applyCardFilterToTickets(tickets, { useHighVarianceCards: true });
    assert.ok(engine.assertValidBingoGrid(tickets[0].grid));
    assert.strictEqual(tickets[0].cardFilter, 'high-variance');
});

test('13-call pacing refuses to force-resolve early (fallback still dispatches claims)', () => {
    for (let i = 0; i <= 12; i++) {
        assert.strictEqual(engine.canResolveRound(i), false, 'turn ' + i);
    }
    assert.strictEqual(engine.canResolveRound(13), true);
    assert.strictEqual(engine.shouldForceResolution(12, 13), false);
    assert.strictEqual(engine.shouldForceResolution(13, 13), true);
    assert.strictEqual(engine.shouldForceResolution(26, 99), true);
    assert.strictEqual(engine.HARD_CAP_CALLS, 23);
    assert.strictEqual(engine.shouldForceResolution(22, 99), false);
    assert.strictEqual(engine.shouldForceResolution(23, 99), true);
    assert.strictEqual(engine.FINISH_CALL_MIN, 14);
    assert.strictEqual(engine.FINISH_CALL_MAX, 23);
});

test('collectBingoClaims registers every concurrent 5-match on the same tick', () => {
    const called = [1, 2, 3, 4, 5];
    const winGrid = rowWinGrid();
    const losing = engine.generateFixedCard(99);
    const activePlayers = {
        p1: { phone: 'p1', isBot: false, ticketsData: [{ id: 1, grid: winGrid }] },
        p2: { phone: 'p2', isBot: false, ticketsData: [{ id: 2, grid: winGrid }, { id: 3, grid: losing }] },
        p3: { phone: 'p3', isBot: true, ticketsData: [{ id: 4, grid: losing }] }
    };
    const claims = engine.collectBingoClaims(activePlayers, called);
    assert.strictEqual(claims.length, 2);
    assert.deepStrictEqual(claims.map((c) => c.claimId).sort(), ['p1:1', 'p2:2']);
    assert.ok(claims.every((c) => c.tick === 5));
});

test('resolveConcurrentClaims never drops real claims and caps virtual validators at 4', () => {
    const winGrid = rowWinGrid();
    const claims = [
        { player: { phone: 'real1', isBot: false, name: 'A' }, ticket: { id: 1, grid: winGrid } },
        { player: { phone: 'real2', isBot: false, name: 'B' }, ticket: { id: 2, grid: winGrid } }
    ];
    claims.forEach((c) => { c.claimId = engine.claimId(c.player, c.ticket); });

    const fakeBots = [];
    for (let i = 0; i < 6; i++) {
        fakeBots.push({
            name: 'Bot' + i,
            phone: 'bot' + i,
            isBot: true,
            ticketsData: [{ id: 100 + i, grid: engine.generateFixedCard(100 + i) }]
        });
    }

    const result = engine.resolveConcurrentClaims(claims, {
        calledNumbers: [1, 2, 3, 4, 5],
        currentTurn: 13,
        numToCall: 5,
        forceWinner: 'mix',
        mixBotCount: 1,
        ticketPrice: 10,
        botPlayers: fakeBots,
        activeCooldowns: { real1: 3 },
        timeBans: {},
        helpers: {
            makeNaturalBotTicket: (tix) => { tix.forced = true; },
            getUnusedFakeTicketId: () => 999,
            generateFixedCard: engine.generateFixedCard
        }
    });

    const realIds = result.winners.filter((w) => !w.player.isBot).map((w) => w.player.phone).sort();
    assert.deepStrictEqual(realIds, ['real1', 'real2']);
    const virtualCount = result.winners.filter((w) => w.player.isBot).length;
    assert.ok(virtualCount <= engine.MAX_VIRTUAL_VALIDATORS);
    assert.ok(result.winners.length <= engine.MAX_TOTAL_WINNERS);
    assert.strictEqual(result.shouldDispatch, true);
    assert.strictEqual(result.hasBlockedWinner, true);
});

test('resolveConcurrentClaims dispatches early 5-matches via 4-validator fallback', () => {
    const claims = [{
        claimId: 'p:1',
        player: { phone: 'p', isBot: false, name: 'P' },
        ticket: { id: 1, grid: rowWinGrid() }
    }];
    const fakeBots = [];
    for (let i = 0; i < 4; i++) {
        fakeBots.push({
            name: 'Bot' + i,
            phone: 'bot' + i,
            isBot: true,
            ticketsData: [{ id: 200 + i, grid: engine.generateFixedCard(200 + i) }]
        });
    }
    const result = engine.resolveConcurrentClaims(claims, {
        calledNumbers: [1, 2, 3, 4, 5],
        currentTurn: 5,
        numToCall: 5,
        botPlayers: fakeBots,
        helpers: {
            makeNaturalBotTicket: () => {},
            getUnusedFakeTicketId: () => 1,
            generateFixedCard: engine.generateFixedCard
        }
    });
    assert.strictEqual(result.shouldDispatch, true);
    assert.strictEqual(result.isEarlyCompletion, true);
    assert.ok(result.winners.some((w) => w.player.phone === 'p'), 'early claimant is never skipped');
    assert.strictEqual(result.winners.filter((w) => w.player.isBot).length, 4);
});

test('even split matches declareWinners formula and does not change totals', () => {
    assert.strictEqual(engine.computeEvenSplit(100, 4), 25);
    assert.strictEqual(engine.computeEvenSplit(100, 3), 33.33);
    assert.strictEqual(engine.computeEvenSplit(50, 1), 50);
    assert.strictEqual(engine.computeEvenSplit(0, 2), 0);
});

test('DrawTickMutex is exclusive', () => {
    const m = new engine.DrawTickMutex();
    assert.strictEqual(m.tryAcquire(), true);
    assert.strictEqual(m.tryAcquire(), false);
    m.release();
    assert.strictEqual(m.tryAcquire(), true);
});

test('pickPreThresholdNumber never returns a completing ball', () => {
    const pick = engine.pickPreThresholdNumber([10, 20, 30], [20, 40]);
    assert.ok(pick === 10 || pick === 30);
    assert.strictEqual(engine.pickPreThresholdNumber([20], [20]), null);
});

test('unified target pool includes never-won and post-cooldown, excludes active cooldown and bonus', () => {
    const now = Date.now();
    const players = [
        { phone: 'never', isBot: false, hasDeposited: true, realBetAmount: 10, won: 0 },
        { phone: 'post', isBot: false, hasDeposited: true, realBetAmount: 10, won: 80, cooldownUntil: now - 1000 },
        { phone: 'cool', isBot: false, hasDeposited: true, realBetAmount: 10, won: 40, cooldownUntil: now + 60000 },
        { phone: 'bonus', isBot: false, hasDeposited: false, realBetAmount: 0, won: 0 }
    ];
    const ctx = {
        allowBonusWin: true,
        activeCooldowns: {},
        timeBans: {},
        winHistory: {},
        now
    };
    const pool = players.filter((p) => engine.isPrimaryTargetEligible(p, ctx)).map((p) => p.phone).sort();
    assert.deepStrictEqual(pool, ['never', 'post']);
    const picks = engine.selectTargetCandidates(players, ctx);
    assert.strictEqual(picks.length, 1);
    assert.ok(picks[0] === 'never' || picks[0] === 'post');
    assert.ok(!picks.includes('cool'));
    assert.ok(!picks.includes('bonus'));
});

test('selectTargetCandidates can pick a post-cooldown winner from a mixed seated room', () => {
    const players = [];
    for (let i = 0; i < 11; i++) {
        players.push({
            phone: 't' + i,
            isBot: false,
            hasDeposited: true,
            realBetAmount: 10,
            won: 0
        });
    }
    players.push({ phone: 'post', isBot: false, hasDeposited: true, realBetAmount: 10, won: 50 });
    players.push({ phone: 'cool', isBot: false, hasDeposited: true, realBetAmount: 10, won: 20 });
    players.push({ phone: 'bonus', isBot: false, hasDeposited: false, realBetAmount: 0, won: 0 });
    const ctx = {
        allowBonusWin: true,
        activeCooldowns: { cool: 4 },
        timeBans: {},
        winHistory: {},
        now: Date.now()
    };
    const eligible = players.filter((p) => engine.isPrimaryTargetEligible(p, ctx)).map((p) => p.phone);
    assert.ok(eligible.includes('post'));
    assert.ok(eligible.includes('t0'));
    assert.ok(!eligible.includes('cool'));
    assert.ok(!eligible.includes('bonus'));
    assert.ok(eligible.length >= 10);
    const picks = engine.selectTargetCandidates(players, ctx);
    assert.ok(picks.length === 1 || picks.length === 2);
    picks.forEach((ph) => assert.ok(eligible.includes(ph)));
});

test('hasPriorWin is lifetime/session, not a 1-hour window', () => {
    assert.strictEqual(engine.hasPriorWin({ phone: 'x', won: 0 }, { winHistory: {} }), false);
    assert.strictEqual(engine.hasPriorWin({ phone: 'x', won: 12 }, { winHistory: {} }), true);
    assert.strictEqual(engine.hasPriorWin({ phone: 'x', won: 0 }, { winHistory: { x: [1] } }), true);
    assert.strictEqual(engine.hasPriorWin({ phone: 'x', won: 0 }, { mixDepWinnersHistory: ['x'] }), true);
});

test('selectTargetCandidates picks a single target when the pool is small', () => {
    const players = [
        { phone: 'a', isBot: false, hasDeposited: true, realBetAmount: 5, won: 0 },
        { phone: 'b', isBot: false, hasDeposited: true, realBetAmount: 5, won: 0 }
    ];
    const picks = engine.selectTargetCandidates(players, {
        allowBonusWin: true,
        activeCooldowns: {},
        timeBans: {},
        winHistory: {}
    });
    assert.strictEqual(picks.length, 1);
    assert.ok(picks[0] === 'a' || picks[0] === 'b');
});

test('targeting helpers do not override the 14-23 finish rotation', () => {
    assert.strictEqual(typeof engine.preferTargetPool, 'undefined');
    assert.strictEqual(typeof engine.preferRotationNumbers, 'undefined');
    assert.strictEqual(engine.MIN_CALLS_BEFORE_RESOLVE, 13);
    assert.strictEqual(engine.HARD_CAP_CALLS, 23);
    assert.strictEqual(engine.SCATTER_CALL_END, 10);
    assert.strictEqual(engine.LINE_BUILD_START, 11);
    assert.strictEqual(engine.LINE_BUILD_END, 13);
    assert.strictEqual(engine.shouldForceResolution(12, 17), false);
    assert.strictEqual(engine.shouldForceResolution(17, 17), true);
    assert.strictEqual(engine.shouldForceResolution(21, 18), true);
});

test('scatter holds a two-away line, build does not finish it, and the release call does', () => {
    const grid = rowWinGrid();
    const player = { phone: 'p', isBot: false, hasDeposited: true, ticketsData: [{ id: 1, grid: grid }] };
    const called = [1, 16, 31];
    const index = engine.buildRoundLineIndex([player]);
    index.syncCalled(called);
    assert.strictEqual(index.leavesOneAway(46), true);
    assert.strictEqual(index.leavesOneAway(61), true);
    assert.strictEqual(index.leavesOneAway(2), false);
    const scatter = engine.chooseDrawnBall({
        currentTurn: 6,
        finishCall: 16,
        forceWinner: 'real',
        botCount: 0,
        called: called,
        pool: [46, 61, 2, 17],
        targetPlayers: [player],
        botPlayers: [],
        others: [],
        completing: [],
        lineIndex: index,
        rng: function () { return 0; }
    });
    assert.strictEqual(scatter.plan, 'safe');
    assert.strictEqual(scatter.num, 2);
    const near = called.concat([46]);
    index.syncCalled(near);
    const building = engine.chooseDrawnBall({
        currentTurn: 12,
        finishCall: 16,
        forceWinner: 'real',
        botCount: 0,
        called: near,
        pool: [61, 2],
        targetPlayers: [player],
        botPlayers: [],
        others: [],
        completing: [61],
        lineIndex: index,
        rng: function () { return 0; }
    });
    assert.notStrictEqual(building.num, 61);
    assert.notStrictEqual(building.plan, 'safe');
    const release = engine.chooseDrawnBall({
        currentTurn: 16,
        finishCall: 16,
        forceWinner: 'real',
        botCount: 0,
        called: near,
        pool: [61, 2],
        targetPlayers: [player],
        botPlayers: [],
        others: [],
        completing: [61],
        lineIndex: index,
        rng: function () { return 0; }
    });
    assert.strictEqual(release.num, 61);
    assert.strictEqual(release.plan, 'solo');
});

test('applyRoundCardAllocation gives standard cards to targets and high-dispersion to others', () => {
    const targetId = 11;
    const otherId = 22;
    const activePlayers = {
        tgt: {
            phone: 'tgt',
            isBot: false,
            ticketsData: [{ id: targetId, grid: engine.generateHighVarianceCard(targetId) }]
        },
        other: {
            phone: 'other',
            isBot: false,
            ticketsData: [{ id: otherId, grid: engine.generateFixedCard(otherId) }]
        },
        bot: {
            phone: 'bot1',
            isBot: true,
            ticketsData: [{ id: 33, grid: engine.generateFixedCard(33) }]
        }
    };
    engine.applyRoundCardAllocation(activePlayers, ['tgt']);
    assert.strictEqual(activePlayers.tgt.isRoundTarget, true);
    assert.deepStrictEqual(activePlayers.tgt.ticketsData[0].grid, engine.generateFixedCard(targetId));
    assert.strictEqual(activePlayers.tgt.ticketsData[0].cardFilter, 'standard');
    assert.strictEqual(activePlayers.other.isRoundTarget, false);
    assert.deepStrictEqual(activePlayers.other.ticketsData[0].grid, engine.generateHighVarianceCard(otherId));
    assert.deepStrictEqual(activePlayers.bot.ticketsData[0].grid, engine.generateHighVarianceCard(33));
});

test('purchase fee books 20% to the company and 80% to the prize pool', () => {
    const one = engine.applyPurchaseFee(10, 1, engine.PLATFORM_COMMISSION_RATE);
    assert.strictEqual(one.feePerTicket, 2);
    assert.strictEqual(one.netPerTicket, 8);
    assert.strictEqual(one.totalFee, 2);
    assert.strictEqual(one.totalNet, 8);

    const many = engine.applyPurchaseFee(10, 3, engine.PLATFORM_COMMISSION_RATE);
    assert.strictEqual(many.totalFee, 6);
    assert.strictEqual(many.totalNet, 24);
    assert.strictEqual(many.gross, 30);

    const mixed = engine.splitStake(6, engine.PLATFORM_COMMISSION_RATE);
    assert.strictEqual(mixed.fee, 1.2);
    assert.strictEqual(mixed.net, 4.8);
});

test('card purchase hardcodes 2 ETB fee, 8 ETB prize pool, and a full 10 ETB refund', () => {
    const one = engine.bookCardPurchase(1, 10);
    assert.strictEqual(one.feePerTicket, 2);
    assert.strictEqual(one.netPerTicket, 8);
    assert.strictEqual(one.gross, 10);
    assert.strictEqual(one.totalFee, 2);
    assert.strictEqual(one.totalNet, 8);

    const many = engine.bookCardPurchase(4, 10);
    assert.strictEqual(many.totalFee, 8);
    assert.strictEqual(many.totalNet, 32);
    assert.strictEqual(many.gross, 40);

    const standard = engine.bookCardPurchase(2);
    assert.strictEqual(standard.feePerTicket, 2);
    assert.strictEqual(standard.netPerTicket, 8);
    assert.strictEqual(standard.gross, 20);

    const fromPlay = engine.refundCancelledCard({ paidFromPlay: 10, paidFromMain: 0, netToPool: 8 });
    assert.strictEqual(fromPlay.refundTotal, 10);
    assert.strictEqual(fromPlay.refundPlay, 10);
    assert.strictEqual(fromPlay.poolReversal, 8);

    const splitWallets = engine.refundCancelledCard({ paidFromPlay: 6, paidFromMain: 4, netToPool: 8 });
    assert.strictEqual(splitWallets.refundPlay, 6);
    assert.strictEqual(splitWallets.refundMain, 4);
    assert.strictEqual(splitWallets.refundTotal, 10);
    assert.strictEqual(splitWallets.poolReversal, 8);

    const short = engine.refundCancelledCard({ paidFromPlay: 8, paidFromMain: 0, netToPool: 8 });
    assert.strictEqual(short.refundTotal, 10);
    assert.strictEqual(short.poolReversal, 8);

    const missing = engine.refundCancelledCard({});
    assert.strictEqual(missing.refundTotal, 10);
    assert.strictEqual(missing.refundPlay, 10);
    assert.strictEqual(missing.poolReversal, 8);
});

test('referral invite link allows 5 signups per day and rejects the 6th', () => {
    assert.strictEqual(engine.MAX_SIGNUPS_PER_LINK_PER_DAY, 5);
    for (let n = 0; n < 5; n++) {
        const decision = engine.referralSignupDecision(n);
        assert.strictEqual(decision.allowed, true, 'signup ' + (n + 1) + ' must be allowed');
        assert.strictEqual(decision.nextCount, n + 1);
    }
    const blocked = engine.referralSignupDecision(5);
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.message, 'Daily referral invite limit reached for this link');
    const over = engine.referralSignupDecision(6);
    assert.strictEqual(over.allowed, false);
    assert.strictEqual(over.message, engine.REFERRAL_LIMIT_MESSAGE);
});

test('winner payout ledger pays 100% with no deduction for humans or bots', () => {
    const ledger = engine.applyCommissionLedger(200, 5);
    assert.strictEqual(ledger.rate, 0);
    assert.strictEqual(ledger.commissionPerClaim, 0);
    assert.strictEqual(ledger.netPayout, 200);
    assert.strictEqual(ledger.totalCommission, 0);
    assert.strictEqual(ledger.totalNetPayout, 1000);
    assert.strictEqual(ledger.netPayout, ledger.grossSplit);
});

test('round registry queues per-phone registrations and never drops later cards', async () => {
    const registry = engine.createRoundRegistry();
    const seated = {};
    const order = [];
    const jobs = [122, 30, 45, 504].map((id) => registry.enqueue('0911', async () => {
        order.push(id);
        if (!seated['0911']) seated['0911'] = { phone: '0911', ticketsData: [], isBot: false };
        seated['0911'].ticketsData.push({ id, grid: engine.generateFixedCard(id) });
        seated['0911'].tickets = seated['0911'].ticketsData.length;
    }));
    await Promise.all(jobs);
    assert.deepStrictEqual(order, [122, 30, 45, 504]);
    assert.strictEqual(registry.hasPending(), false);
    const ids = seated['0911'].ticketsData.map((t) => t.id);
    assert.deepStrictEqual(ids, [122, 30, 45, 504]);
});

test('hydratePlayersFromEntries restores a committed card missing from memory (#504)', () => {
    const winGrid = rowWinGrid();
    const activePlayers = {
        '0911': {
            phone: '0911',
            isBot: false,
            tickets: 3,
            ticketsData: [
                { id: 122, grid: winGrid },
                { id: 30, grid: winGrid },
                { id: 45, grid: winGrid }
            ]
        }
    };
    const entries = [
        { phone: '0911', ticketId: 122, grid: winGrid, status: 'active' },
        { phone: '0911', ticketId: 30, grid: winGrid, status: 'active' },
        { phone: '0911', ticketId: 45, grid: winGrid, status: 'active' },
        { phone: '0911', ticketId: 504, grid: winGrid, status: 'active' }
    ];
    engine.hydratePlayersFromEntries(activePlayers, entries);
    const ids = activePlayers['0911'].ticketsData.map((t) => Number(t.id)).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, [30, 45, 122, 504]);
    assert.strictEqual(activePlayers['0911'].tickets, 4);

    const cards = engine.listParticipatingCards(activePlayers);
    assert.strictEqual(cards.length, 4);
    assert.ok(cards.every((c) => c.active));
    assert.ok(cards.some((c) => c.ticketId === 504));

    const claims = engine.collectBingoClaimsFromCommitted(activePlayers, entries, [1, 2, 3, 4, 5]);
    const claimIds = claims.map((c) => c.claimId).sort();
    assert.deepStrictEqual(claimIds, ['0911:122', '0911:30', '0911:45', '0911:504'].sort());
});

test('frozen registry rejects new locks after cutoff while pending in-flight still drain', () => {
    const registry = engine.createRoundRegistry();
    assert.strictEqual(registry.canAcceptRegistration(), true);
    const end = registry.beginRegistration();
    registry.freeze({});
    assert.strictEqual(registry.isFrozen(), true);
    assert.strictEqual(registry.canAcceptRegistration(), false);
    assert.strictEqual(registry.hasPending(), true);
    end();
    assert.strictEqual(registry.hasPending(), false);
    registry.thaw();
    assert.strictEqual(registry.isFrozen(), false);
    assert.strictEqual(registry.canAcceptRegistration(), true);
});

test('auto-pass check never marks a committed card inactive', () => {
    const cards = engine.listParticipatingCards({
        u: {
            phone: '0911',
            ticketsData: [
                { id: 122, grid: engine.generateFixedCard(122) },
                { id: 504, grid: engine.generateFixedCard(504) }
            ]
        }
    });
    assert.ok(!cards.some((c) => !c.active));
    assert.strictEqual(cards.find((c) => c.ticketId === 504).active, true);
});

test('ticket lock board keeps pending cards off the committed list until release after commit', () => {
    const board = engine.createTicketLockBoard();
    const committed = [122, 30];
    assert.strictEqual(board.tryClaim([504], '0911').ok, true);
    assert.strictEqual(board.tryClaim([504], '0922').ok, true, 'unconfirmed pending must be stealable');
    assert.strictEqual(board.owner(504), '0922');
    assert.strictEqual(board.isPending(504), true);
    const publicTaken = board.mergePublicTaken(committed);
    assert.ok(publicTaken.indexOf(504) === -1, 'unconfirmed pending lock leaked into public taken');
    assert.ok(publicTaken.indexOf(122) !== -1);
    assert.deepStrictEqual(board.pendingIdsForPhone('0922'), [504]);
    board.release([504], '0911');
    assert.strictEqual(board.isPending(504), true, 'release must not drop another phone pending');
    board.release([504], '0922');
    assert.strictEqual(board.isPending(504), false);
    assert.ok(board.mergePublicTaken(committed).indexOf(504) === -1);
});

test('dropping a released card from the committed cache unregisters it for the round', () => {
    const cache = [
        { gameId: 9, phone: '0911', ticketId: 122, status: 'active' },
        { gameId: 9, phone: '0911', ticketId: 504, status: 'active' },
        { gameId: 9, phone: '0922', id: 30, status: 'active' }
    ];
    const next = engine.dropCommittedEntries(cache, [504, '504']);
    assert.strictEqual(next.length, 2);
    assert.ok(!next.some((e) => Number(e.ticketId) === 504));
    assert.ok(next.some((e) => Number(e.ticketId) === 122));
    assert.deepStrictEqual(engine.dropCommittedEntries(cache, []), cache);
});

test('unconfirmed pending locks never block a later player from taking a free card', () => {
    const board = engine.createTicketLockBoard();
    const t0 = 1_000_000;
    assert.strictEqual(board.tryClaim([88], '0911', t0).ok, true);
    assert.strictEqual(board.tryClaim([88], '0922', t0 + 500).ok, true);
    assert.strictEqual(board.owner(88), '0922');
    assert.strictEqual(board.tryClaim([88], '0933', t0 + engine.PENDING_TTL_MS + 1).ok, true);
    assert.strictEqual(board.owner(88), '0933');
    assert.deepStrictEqual(board.mergePublicTaken([]), []);
});

test('lock ack is omitted until the card is seated after commit', () => {
    assert.strictEqual(engine.committedLockAck(null, [122], 9), null);
    assert.strictEqual(engine.committedLockAck({ ticketsData: [] }, [122], 9), null);
    assert.strictEqual(engine.committedLockAck({ ticketsData: [{ id: 30 }] }, [122], 9), null);
    const seated = { ticketsData: [{ id: 122, grid: [[1]] }, { id: 30, grid: [[2]] }] };
    const ack = engine.committedLockAck(seated, [122], 9);
    assert.ok(ack);
    assert.strictEqual(ack.committed, true);
    assert.deepStrictEqual(ack.ticketIds, [122]);
    assert.deepStrictEqual(ack.myTickets.map((t) => t.id), [122, 30]);
    assert.deepStrictEqual(ack.myTickets[0].grid, [[1]]);
    assert.strictEqual(engine.committedLockAck(seated, [122, 504], 9), null);
});

test('deposit bonus scheduler applies configured % in EAT window then reverts to base tiers', () => {
    const settings = {
        depBonusMinAmount: 50,
        depBonusPercent: 50,
        depBonusTier2Min: 200,
        depBonusTier2Percent: 100,
        depBonusSchedulerActive: true,
        depBonusSchedulerPercent: 20,
        depBonusSchedulerMinAmount: 100,
        depBonusSchedulerStart: '14:00',
        depBonusSchedulerEnd: '16:00'
    };
    const inWindow = Date.UTC(2026, 8, 17, 11, 30, 0); // 14:30 EAT
    const outWindow = Date.UTC(2026, 8, 17, 14, 0, 0); // 17:00 EAT
    const scheduled = engine.computeDepositBonus(150, { hasMadeFirstDeposit: true }, settings, inWindow);
    assert.strictEqual(scheduled.source, 'scheduler');
    assert.strictEqual(scheduled.bonus, 30);
    const belowMin = engine.computeDepositBonus(80, { hasMadeFirstDeposit: true }, settings, inWindow);
    assert.strictEqual(belowMin.source, 'tier1');
    assert.strictEqual(belowMin.bonus, 40);
    const reverted = engine.computeDepositBonus(250, { hasMadeFirstDeposit: true }, settings, outWindow);
    assert.strictEqual(reverted.source, 'tier2');
    assert.strictEqual(reverted.bonus, 250);
});

test('bot ramp moves one-by-one between 7 daily slots instead of jumping', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const settings = {
        isBotScheduleActive: true,
        botRampMinutes: 30,
        gameTimer: 40,
        botSchedule1: { start: 0, end: 6, min: 10, max: 12 },
        botSchedule2: { start: 6, end: 9, min: 15, max: 20 },
        botSchedule3: { start: 9, end: 12, min: 20, max: 30 },
        botSchedule4: { start: 12, end: 15, min: 30, max: 40 },
        botSchedule5: { start: 15, end: 18, min: 40, max: 55 },
        botSchedule6: { start: 18, end: 21, min: 55, max: 80 },
        botSchedule7: { start: 21, end: 24, min: 80, max: 110 }
    };
    assert.strictEqual(engine.findActiveBotSchedule(settings, 21).n, 'Slot 7');
    assert.strictEqual(engine.findActiveBotSchedule(settings, 19).n, 'Slot 6');
    assert.strictEqual(engine.listBotSchedules(settings).length, 7);

    let now = Date.UTC(2026, 8, 17, 4, 30, 0); // 07:30 EAT slot 2
    const first = ramp.nextCount({ settings, now, rng: () => 0 });
    assert.ok(first.count >= 15 && first.count <= 20);

    now = Date.UTC(2026, 8, 17, 6, 0, 0); // 09:00 EAT slot 3
    const samples = [];
    for (let i = 0; i < 8; i++) {
        const step = ramp.nextCount({ settings, now: now + (i * 40000), rng: () => 0.99 });
        samples.push(step.count);
    }
    for (let i = 1; i < samples.length; i++) {
        assert.ok(Math.abs(samples[i] - samples[i - 1]) <= 2, 'ramp jumped from ' + samples[i - 1] + ' to ' + samples[i]);
    }
    assert.ok(Math.max.apply(null, samples) < 30, 'should not instantly reach slot 3 min');
});

test('false inactive flags never skip a legitimate bingo card', () => {
    const winGrid = rowWinGrid();
    const activePlayers = {
        u: {
            phone: '0911',
            inactive: true,
            ticketsData: [{ id: 504, grid: winGrid, inactive: true }]
        }
    };
    const entries = [{ phone: '0911', ticketId: 504, grid: winGrid, status: 'active' }];
    const tick = engine.evaluateBingoTick(activePlayers, entries, [1, 2, 3, 4, 5]);
    assert.strictEqual(tick.lockRound, true);
    assert.deepStrictEqual(tick.claimIds, ['0911:504']);
});

test('bingo simulation always awards the completing player and locks the round', () => {
    for (let round = 0; round < 25; round++) {
        const winGrid = rowWinGrid();
        const loserGrid = engine.generateFixedCard(200 + round);
        const activePlayers = {
            winner: { phone: 'w' + round, isBot: false, ticketsData: [{ id: 11, grid: winGrid }] },
            other: { phone: 'o' + round, isBot: false, ticketsData: [{ id: 22, grid: loserGrid }] },
            bot: { phone: 'b' + round, isBot: true, ticketsData: [{ id: 33, grid: loserGrid }] }
        };
        const entries = [
            { phone: 'w' + round, ticketId: 11, grid: winGrid, status: 'active' },
            { phone: 'o' + round, ticketId: 22, grid: loserGrid, status: 'active' },
            { phone: 'b' + round, ticketId: 33, grid: loserGrid, status: 'active' }
        ];
        const called = [1, 2, 3, 4, 5];
        const tick = engine.evaluateBingoTick(activePlayers, entries, called);
        assert.ok(tick.lockRound, 'round ' + round + ' did not lock');
        assert.ok(tick.claimIds.indexOf('w' + round + ':11') !== -1, 'winner skipped on round ' + round);

        const resolved = engine.resolveConcurrentClaims(tick.claims, {
            calledNumbers: called,
            currentTurn: 15,
            numToCall: 5,
            forceWinner: 'real',
            botPlayers: [activePlayers.bot],
            helpers: {
                makeNaturalBotTicket: () => {},
                getUnusedFakeTicketId: () => 400 + round,
                generateFixedCard: engine.generateFixedCard
            }
        });
        const realPhones = resolved.winners.filter((w) => !w.player.isBot).map((w) => w.player.phone);
        assert.ok(realPhones.indexOf('w' + round) !== -1, 'winner dropped during resolve on round ' + round);
        assert.strictEqual(resolved.shouldDispatch, true);
    }
});

test('describeScheduleStatus flags exactly one of 7 slots as live', () => {
    const settings = {
        isBotScheduleActive: true,
        botSchedule1: { start: 0, end: 6, min: 10, max: 15 },
        botSchedule2: { start: 6, end: 9, min: 15, max: 25 },
        botSchedule3: { start: 9, end: 12, min: 20, max: 35 },
        botSchedule4: { start: 12, end: 15, min: 30, max: 45 },
        botSchedule5: { start: 15, end: 18, min: 40, max: 60 },
        botSchedule6: { start: 18, end: 21, min: 55, max: 85 },
        botSchedule7: { start: 21, end: 24, min: 70, max: 110 }
    };
    const now = Date.UTC(2026, 8, 17, 16, 10, 0); // 19:10 EAT = slot 6
    const status = engine.describeScheduleStatus(settings, now);
    assert.strictEqual(status.slots.length, 7);
    const live = status.slots.filter((s) => s.isActive);
    assert.strictEqual(live.length, 1);
    assert.strictEqual(live[0].index, 6);
    assert.ok(live[0].remainingMinutes > 0 && live[0].remainingMinutes <= 110);
});

test('EAT datetime conversion stores UTC instant for scheduled posts', () => {
    const utc = engine.eatDateTimeToUtc('2026-09-18', '18:30');
    assert.ok(utc instanceof Date);
    assert.strictEqual(utc.toISOString(), '2026-09-18T15:30:00.000Z');
    assert.strictEqual(engine.formatEatClock(utc.getTime()), '18:30:00');
});

function sevenSlotSettings(overrides) {
    return Object.assign({
        isBotScheduleActive: true,
        botRampMinutes: 30,
        gameTimer: 40,
        botSchedule1: { start: 0, end: 6, min: 10, max: 12 },
        botSchedule2: { start: 6, end: 9, min: 15, max: 20 },
        botSchedule3: { start: 9, end: 12, min: 20, max: 30 },
        botSchedule4: { start: 12, end: 15, min: 30, max: 40 },
        botSchedule5: { start: 15, end: 18, min: 40, max: 55 },
        botSchedule6: { start: 18, end: 21, min: 55, max: 80 },
        botSchedule7: { start: 21, end: 24, min: 80, max: 110 }
    }, overrides || {});
}

function assertGradualCurve(samples, maxStep) {
    for (let i = 1; i < samples.length; i++) {
        const jump = Math.abs(samples[i] - samples[i - 1]);
        assert.ok(jump <= maxStep, 'abrupt jump from ' + samples[i - 1] + ' to ' + samples[i]);
    }
}

test('bot ramp-up reaches the next slot band by the configured ramp window', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const settings = sevenSlotSettings({ gameTimer: 300 });
    let now = Date.UTC(2026, 8, 17, 4, 30, 0); // slot 2 ~15-20
    const first = ramp.nextCount({ settings, now, rng: () => 0 });
    now = Date.UTC(2026, 8, 17, 18, 0, 0); // 21:00 EAT slot 7 80-110
    const samples = [first.count];
    const stepMs = 300000;
    const rounds = Math.round((30 * 60 * 1000) / stepMs);
    for (let i = 0; i < rounds; i++) {
        samples.push(ramp.nextCount({ settings, now: now + (i * stepMs), rng: () => 0.99 }).count);
    }
    assert.ok(samples[1] < 80, 'ramped up to slot 7 instantly');
    const last = samples[samples.length - 1];
    assert.ok(last >= 80 && last <= 110, 'did not reach slot 7 by the end of the ramp window, last=' + last);
});

test('bot ramp-down decreases step-by-step instead of collapsing in one tick', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const settings = sevenSlotSettings();
    let now = Date.UTC(2026, 8, 17, 18, 30, 0); // 21:30 EAT slot 7
    const first = ramp.nextCount({ settings, now, rng: () => 0.99 });
    assert.ok(first.count >= 80);
    now = Date.UTC(2026, 8, 17, 0, 0, 0); // 03:00 EAT slot 1 10-12
    const samples = [first.count];
    for (let i = 0; i < 20; i++) {
        samples.push(ramp.nextCount({ settings, now: now + (i * 40000), rng: () => 0.5 }).count);
    }
    assertGradualCurve(samples, 4);
    for (let i = 1; i < samples.length; i++) {
        assert.ok(samples[i] <= samples[i - 1], 'count rose during ramp-down');
    }
    assert.ok(samples[samples.length - 1] > 12, 'collapsed to slot 1 in 20 rounds');
});

test('a confirmed committed card stays in the round if marked inactive or dropped from memory', () => {
    const winGrid = rowWinGrid();
    const entries = [{ phone: '0911', ticketId: 122, grid: winGrid, status: 'active' }];
    const missing = engine.evaluateBingoTick({}, entries, [1, 2, 3, 4, 5]);
    assert.strictEqual(missing.lockRound, true);
    assert.deepStrictEqual(missing.claimIds, ['0911:122']);

    const seated = {
        '0911': { phone: '0911', inactive: true, ticketsData: [{ id: 122, grid: winGrid, inactive: true }] }
    };
    const tick = engine.evaluateBingoTick(seated, entries, [1, 2, 3, 4, 5]);
    assert.strictEqual(tick.lockRound, true);
    assert.strictEqual(seated['0911'].inactive, false);
    assert.strictEqual(seated['0911'].ticketsData[0].inactive, false);
    const cards = engine.listParticipatingCards(seated);
    assert.strictEqual(cards.length, 1);
    assert.strictEqual(cards[0].active, true);
});

test('hydrate without a builder still seats a committed card that vanished from memory', () => {
    const winGrid = rowWinGrid();
    const seated = {};
    engine.hydratePlayersFromEntries(seated, [
        { phone: '0911', ticketId: 504, grid: winGrid, name: 'Abebe', status: 'active' }
    ]);
    assert.ok(seated['0911']);
    assert.strictEqual(Number(seated['0911'].ticketsData[0].id), 504);
    assert.strictEqual(seated['0911'].inactive, false);
    const tick = engine.evaluateBingoTick({}, [
        { phone: '0911', ticketId: 504, grid: winGrid, status: 'active' }
    ], [1, 2, 3, 4, 5]);
    assert.strictEqual(tick.lockRound, true);
    assert.deepStrictEqual(tick.claimIds, ['0911:504']);
});

test('cutoff awaits in-flight registrations and drops zero cards under concurrency', async () => {
    const registry = engine.createRoundRegistry();
    const seated = {};
    const entries = [];
    const jobs = [];
    for (let i = 0; i < 24; i++) {
        const phone = '09' + String(10000000 + i);
        const ticketId = i + 1;
        jobs.push(registry.enqueue(phone, async () => {
            await new Promise((resolve) => setTimeout(resolve, (i % 5) * 4));
            const grid = engine.generateFixedCard(ticketId);
            seated[phone] = { phone, isBot: false, inactive: false, ticketsData: [{ id: ticketId, grid }] };
            entries.push({ phone, ticketId, grid, status: 'active' });
        }));
    }
    registry.freeze(seated);
    assert.strictEqual(registry.canAcceptRegistration(), false);
    assert.strictEqual(registry.hasPending(), true);
    await Promise.all(jobs);
    assert.strictEqual(registry.hasPending(), false);
    engine.hydratePlayersFromEntries(seated, entries);
    const cards = engine.listParticipatingCards(seated);
    assert.strictEqual(cards.length, 24);
    assert.ok(cards.every((c) => c.active));
    const ids = cards.map((c) => c.ticketId).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, Array.from({ length: 24 }, (_, i) => i + 1));
});

test('forceWinner bots cannot replace a legitimate locked bingo', () => {
    const winGrid = rowWinGrid();
    const loser = engine.generateFixedCard(88);
    const activePlayers = {
        hero: { phone: '0911223344', name: 'Abebe', isBot: false, ticketsData: [{ id: 12, grid: winGrid }] },
        extra: { phone: '0922000000', isBot: false, ticketsData: [{ id: 13, grid: loser }] },
        bot: { phone: '0933000000', isBot: true, ticketsData: [{ id: 99, grid: loser }] }
    };
    const entries = [
        { phone: '0911223344', ticketId: 12, grid: winGrid, status: 'active' },
        { phone: '0922000000', ticketId: 13, grid: loser, status: 'active' },
        { phone: '0933000000', ticketId: 99, grid: loser, status: 'active' }
    ];
    const called = [1, 2, 3, 4, 5];
    const outcome = engine.finalizeBingoRound(activePlayers, entries, called, {
        calledNumbers: called,
        currentTurn: 15,
        numToCall: 5,
        forceWinner: 'bots',
        totalPrize: 200,
        botPlayers: [activePlayers.bot],
        helpers: {
            makeNaturalBotTicket: () => {},
            getUnusedFakeTicketId: () => 400,
            generateFixedCard: engine.generateFixedCard
        }
    });
    assert.strictEqual(outcome.locked, true);
    const phones = outcome.winners.map((w) => w.player.phone);
    assert.ok(phones.indexOf('0911223344') !== -1, 'legitimate winner was bypassed');
    assert.ok(outcome.history.winnerPhoneList.indexOf('0911223344') !== -1);
    assert.strictEqual(outcome.shouldBroadcast, true);
    assert.ok(outcome.history.participantPhones.indexOf('0911223344') !== -1);
    assert.ok(outcome.history.winnerPayout > 0);
});

test('simultaneous real and bot bingos keep every registered completing card', () => {
    const winGrid = rowWinGrid();
    const activePlayers = {
        a: { phone: 'a1', isBot: false, ticketsData: [{ id: 1, grid: winGrid }] },
        b: { phone: 'b1', isBot: false, ticketsData: [{ id: 2, grid: winGrid }] },
        bot: { phone: 'bot1', isBot: true, ticketsData: [{ id: 3, grid: winGrid }] }
    };
    const entries = [
        { phone: 'a1', ticketId: 1, grid: winGrid, status: 'active' },
        { phone: 'b1', ticketId: 2, grid: winGrid, status: 'active' },
        { phone: 'bot1', ticketId: 3, grid: winGrid, status: 'active' }
    ];
    const called = [1, 2, 3, 4, 5];
    const outcome = engine.finalizeBingoRound(activePlayers, entries, called, {
        calledNumbers: called,
        currentTurn: 16,
        forceWinner: 'mix',
        mixBotCount: 2,
        totalPrize: 300,
        botPlayers: [activePlayers.bot],
        helpers: {
            makeNaturalBotTicket: () => {},
            getUnusedFakeTicketId: () => 401,
            generateFixedCard: engine.generateFixedCard
        }
    });
    const ids = outcome.winners.map((w) => w.claimId);
    assert.ok(ids.indexOf('a1:1') !== -1);
    assert.ok(ids.indexOf('b1:2') !== -1);
    assert.ok(ids.indexOf('bot1:3') !== -1);
    assert.strictEqual(outcome.history.winnerPhoneList[0], 'a1');
    assert.strictEqual(outcome.winners[0].claimId, 'a1:1');
    assert.ok(outcome.locked);
    assert.deepStrictEqual(outcome.history.calledNumbers, called);
    assert.strictEqual(outcome.history.winnerPayout, engine.computeEvenSplit(300, outcome.winners.length));
    assert.ok(outcome.shouldBroadcast);
});

test('ball 16 keeps every same-ball bingo, including a committed card the caller had not indexed', () => {
    const grid = rowWinGrid();
    const copy = () => grid.map((col) => col.slice());
    const called = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5];
    assert.strictEqual(called.length, 16);
    assert.strictEqual(engine.checkBingo(grid, called.slice(0, 15)), false);
    assert.strictEqual(engine.checkBingo(grid, called), true);
    const quiet = [
        [21, 22, 23, 24, 25],
        [26, 27, 28, 29, 30],
        [31, 32, 'FREE', 34, 35],
        [36, 37, 38, 39, 40],
        [41, 42, 43, 44, 45]
    ];
    assert.strictEqual(engine.checkBingo(quiet, called), false);
    const seated = {
        a: { phone: '0911000001', name: 'Player A', isBot: false, ticketsData: [{ id: 11, grid: copy() }] },
        bot: { phone: 'bot', name: 'Bot', isBot: true, ticketsData: [{ id: 33, grid: copy() }] }
    };
    const entries = [
        { phone: '0911000002', name: 'Player B', ticketId: 22, grid: copy(), status: 'active' }
    ];
    const winners = engine.collectSameBallWinners(seated, entries, called, (ticket) => ticket.grid);
    const phones = winners.map((w) => w.player.phone);
    assert.ok(phones.indexOf('0911000001') !== -1, 'Player A was dropped');
    assert.ok(phones.indexOf('0911000002') !== -1, 'Player B was bypassed on the same ball');
    assert.ok(phones.indexOf('bot') !== -1, 'bot co-winner was bypassed');
    assert.strictEqual(winners.length, 3);
    winners.forEach((w) => assert.strictEqual(w.authenticClose, true));
    const prize = 90;
    const share = engine.computeEvenSplit(prize, winners.length);
    assert.strictEqual(share, 30);
    assert.strictEqual(Number((share * winners.length).toFixed(2)), prize);

    const quietSeat = {
        c: { phone: '0911000003', name: 'Player C', isBot: false, ticketsData: [{ id: 44, grid: quiet }] }
    };
    const withQuiet = engine.collectSameBallWinners(Object.assign({}, seated, quietSeat), entries, called);
    assert.ok(withQuiet.every((w) => w.player.phone !== '0911000003'));

    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(server.indexOf('collectSameBallWinners(activePlayers, roundEntriesForTick, calledNumbers, sameBallGrid)') !== -1);
    assert.ok(server.indexOf('roundLineIndex.completeCards()') === -1);
});

function simulateDrawUntilLock(activePlayers, entries, sequence, ctx) {
    const called = [];
    for (let i = 0; i < sequence.length; i++) {
        called.push(sequence[i]);
        const outcome = engine.finalizeBingoRound(activePlayers, entries, called, Object.assign({
            calledNumbers: called,
            currentTurn: called.length,
            numToCall: sequence[i],
            totalPrize: 200
        }, ctx || {}));
        if (outcome.locked) {
            return { called: called.slice(), outcome, extraNumbers: sequence.slice(i + 1) };
        }
    }
    return { called, outcome: { locked: false, winners: [], history: null }, extraNumbers: [] };
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

test('sequential bingos lock on the first completing card and never roll past it', () => {
    const earlyGrid = rowWinGrid();
    const lateGrid = laterRowWinGrid();
    const activePlayers = {
        user: { phone: '0911223344', name: 'Abebe', isBot: false, ticketsData: [{ id: 12, grid: earlyGrid }] },
        rival: { phone: '0922000000', name: 'Kebede', isBot: false, ticketsData: [{ id: 88, grid: lateGrid }] },
        bot: { phone: '0933000000', name: 'Bot', isBot: true, ticketsData: [{ id: 99, grid: lateGrid }] }
    };
    const entries = [
        { phone: '0911223344', ticketId: 12, grid: earlyGrid, status: 'active' },
        { phone: '0922000000', ticketId: 88, grid: lateGrid, status: 'active' },
        { phone: '0933000000', ticketId: 99, grid: lateGrid, status: 'active' }
    ];
    const sequence = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = simulateDrawUntilLock(activePlayers, entries, sequence, {
        forceWinner: 'bots',
        botPlayers: [activePlayers.bot],
        helpers: {
            makeNaturalBotTicket: () => {},
            getUnusedFakeTicketId: () => 400,
            generateFixedCard: engine.generateFixedCard
        }
    });
    assert.strictEqual(result.outcome.locked, true);
    assert.deepStrictEqual(result.called, [1, 2, 3, 4, 5]);
    assert.ok(result.extraNumbers.length > 0, 'later balls must remain uncalled');
    const phones = result.outcome.winners.map((w) => w.player.phone);
    assert.ok(phones.indexOf('0911223344') !== -1, 'first valid bingo was skipped');
    assert.ok(phones.indexOf('0922000000') === -1, 'later card replaced the earlier winner');
    assert.strictEqual(result.outcome.history.winnerPhoneList[0], '0911223344');
    assert.strictEqual(result.outcome.shouldBroadcast, true);
    assert.strictEqual(
        result.outcome.history.winnerPayout,
        engine.computeEvenSplit(200, result.outcome.winners.length)
    );
});

test('end-to-end simultaneous claims keep every locked card and shape history/payout/broadcast', () => {
    const winGrid = rowWinGrid();
    const loser = engine.generateFixedCard(77);
    const activePlayers = {
        a: { phone: 'a1', name: 'A', isBot: false, ticketsData: [{ id: 1, grid: winGrid }] },
        b: { phone: 'b1', name: 'B', isBot: false, ticketsData: [{ id: 2, grid: winGrid }] },
        bot: { phone: 'bot1', name: 'Bot', isBot: true, ticketsData: [{ id: 3, grid: winGrid }] },
        extra: { phone: 'c1', name: 'C', isBot: false, ticketsData: [{ id: 4, grid: loser }] }
    };
    const entries = [
        { phone: 'a1', ticketId: 1, grid: winGrid, status: 'active' },
        { phone: 'b1', ticketId: 2, grid: winGrid, status: 'active' },
        { phone: 'bot1', ticketId: 3, grid: winGrid, status: 'active' },
        { phone: 'c1', ticketId: 4, grid: loser, status: 'active' }
    ];
    const result = simulateDrawUntilLock(activePlayers, entries, [1, 2, 3, 4, 5, 6, 7], {
        forceWinner: 'mix',
        mixBotCount: 2,
        totalPrize: 300,
        botPlayers: [activePlayers.bot],
        helpers: {
            makeNaturalBotTicket: () => {},
            getUnusedFakeTicketId: () => 401,
            generateFixedCard: engine.generateFixedCard
        }
    });
    const outcome = result.outcome;
    const ids = outcome.winners.map((w) => w.claimId);
    assert.ok(ids.indexOf('a1:1') !== -1);
    assert.ok(ids.indexOf('b1:2') !== -1);
    assert.ok(ids.indexOf('bot1:3') !== -1);
    assert.ok(ids.indexOf('c1:4') === -1);
    assert.deepStrictEqual(result.called, [1, 2, 3, 4, 5]);

    const broadcast = {
        phones: outcome.history.winnerPhoneList.slice(),
        ticketIds: outcome.history.ticketIds.slice(),
        prize: outcome.history.winnerPayout,
        totalPrize: outcome.history.prize,
        calledNumbers: outcome.history.calledNumbers.slice(),
        participantPhones: outcome.history.participantPhones.slice(),
        shouldBroadcast: outcome.shouldBroadcast
    };
    assert.ok(broadcast.shouldBroadcast);
    assert.ok(broadcast.phones.indexOf('a1') !== -1);
    assert.ok(broadcast.phones.indexOf('b1') !== -1);
    assert.ok(broadcast.phones.indexOf('bot1') !== -1);
    assert.ok(broadcast.participantPhones.indexOf('c1') !== -1);
    assert.strictEqual(broadcast.prize, engine.computeEvenSplit(300, outcome.winners.length));
    assert.deepStrictEqual(broadcast.calledNumbers, [1, 2, 3, 4, 5]);
    assert.ok(broadcast.ticketIds.indexOf(1) !== -1);
    assert.ok(broadcast.ticketIds.indexOf(2) !== -1);
});

test('missing in-memory seat still crowns a committed user bingo before any later card', () => {
    const earlyGrid = rowWinGrid();
    const lateGrid = laterRowWinGrid();
    const activePlayers = {
        bot: { phone: 'bot1', isBot: true, ticketsData: [{ id: 99, grid: lateGrid }] }
    };
    const entries = [
        { phone: '0911223344', ticketId: 12, grid: earlyGrid, name: 'Abebe', status: 'active' },
        { phone: 'bot1', ticketId: 99, grid: lateGrid, status: 'active' }
    ];
    const result = simulateDrawUntilLock(activePlayers, entries, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {
        forceWinner: 'bots',
        botPlayers: [activePlayers.bot],
        helpers: {
            makeNaturalBotTicket: () => {},
            getUnusedFakeTicketId: () => 402,
            generateFixedCard: engine.generateFixedCard
        }
    });
    assert.strictEqual(result.outcome.locked, true);
    assert.deepStrictEqual(result.called, [1, 2, 3, 4, 5]);
    assert.ok(result.outcome.winners.some((w) => w.player.phone === '0911223344' && Number(w.ticket.id) === 12));
    assert.ok(result.outcome.history.winnerPhoneList.indexOf('0911223344') !== -1);
});

test('frozen registry rejects NEW enqueues but drains in-flight jobs', async () => {
    const registry = engine.createRoundRegistry();
    const seated = {};
    const inflight = registry.enqueue('0911', async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        seated['0911'] = { phone: '0911', isBot: false, ticketsData: [{ id: 504, grid: engine.generateFixedCard(504) }] };
    });
    registry.freeze(seated);
    assert.strictEqual(registry.canAcceptRegistration(), false);
    let rejected = false;
    try {
        await registry.enqueue('0922', async () => {
            seated['0922'] = { phone: '0922', ticketsData: [{ id: 1, grid: engine.generateFixedCard(1) }] };
        });
    } catch (err) {
        rejected = err && (err.code === 'ROUND_FROZEN' || /FROZEN/.test(String(err.message)));
    }
    assert.ok(rejected, 'post-cutoff enqueue must fail');
    await inflight;
    assert.ok(seated['0911']);
    assert.ok(!seated['0922']);
    assert.strictEqual(registry.hasPending(), false);
});

test('user transaction views only allow win, deposit, and withdraw', () => {
    function isVisibleUserTx(type) {
        const kind = String(type || '').toLowerCase().replace(/[\s-]+/g, '_');
        return kind === 'deposit' || kind === 'withdraw' || kind === 'win';
    }
    const allowed = ['win', 'deposit', 'withdraw', 'WIN', 'Deposit'];
    const hidden = ['bet', 'platform_fee', 'Bet Slip', 'Platform Fee', 'bet_slip', 'platform-fee', 'fee'];
    allowed.forEach((type) => assert.strictEqual(isVisibleUserTx(type), true, type));
    hidden.forEach((type) => assert.strictEqual(isVisibleUserTx(type), false, type));

    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(
        /type:\s*\{\s*\$in:\s*\['deposit',\s*'withdraw',\s*'win',\s*'TOURNAMENT_PRIZE'\]\s*\}/.test(server),
        'user transactions API must whitelist deposit/withdraw/win/tournament prize'
    );
    ['../public/index.html', '../publicindex.html', '../public/admin.html'].forEach((file) => {
        const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assert.ok(
            html.includes("kind === 'deposit' || kind === 'withdraw' || kind === 'win'"),
            'missing user tx type filter in ' + file
        );
    });
});

test('game history loader never reads a lexical currentUser binding', () => {
    const fs = require('fs');
    const path = require('path');
    function extractLoader(file) {
        const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
        const start = html.indexOf('function getSessionUser');
        const end = html.indexOf('function updateUIBalance');
        assert.ok(start !== -1 && end !== -1 && end > start, 'missing history helpers in ' + file);
        return html.slice(start, end);
    }
    ['../public/index.html', '../publicindex.html'].forEach((file) => {
        const src = extractLoader(file);
        assert.ok(/window\.currentUser/.test(src));
        assert.ok(/function loadPlayerGameHistory/.test(src));
        assert.ok(!/const user = currentUser/.test(src));
        assert.ok(!/currentUser\s*\|\|/.test(src));
        const loaderOnly = src.slice(src.indexOf('async function loadPlayerGameHistory'));
        assert.ok(!/\bcurrentUser\b/.test(loaderOnly), 'loadPlayerGameHistory must not mention currentUser');
    });
});

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a += 0x6D2B79F5;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('30-minute ramp-up uses small randomized steps and never jumps', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const settings = sevenSlotSettings({ botRampMinutes: 30, gameTimer: 40 });
    const rng = mulberry32(42);
    let now = Date.UTC(2026, 8, 17, 4, 30, 0);
    const first = ramp.nextCount({ settings, now, rng });
    now = Date.UTC(2026, 8, 17, 6, 0, 0); // 09:00 EAT slot 3 20-30
    const samples = [first.count];
    const stepMs = 40 * 1000;
    const rounds = Math.round((30 * 60 * 1000) / stepMs);
    for (let i = 0; i < rounds; i++) {
        samples.push(ramp.nextCount({ settings, now: now + (i * stepMs), rng }).count);
    }
    assertGradualCurve(samples, engine.MAX_RAMP_STEP);
    const last = samples[samples.length - 1];
    assert.ok(last >= 20 && last <= 30, 'did not settle in slot 3 band, last=' + last);
    assert.ok(samples[5] < 30, 'jumped to slot 3 max in 5 rounds');
});

test('30-minute ramp-down uses small randomized steps and never collapses', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const settings = sevenSlotSettings({ botRampMinutes: 30, gameTimer: 40 });
    const rng = mulberry32(99);
    let now = Date.UTC(2026, 8, 17, 18, 30, 0);
    const first = ramp.nextCount({ settings, now, rng });
    now = Date.UTC(2026, 8, 17, 0, 0, 0); // 03:00 EAT slot 1 10-12
    const samples = [first.count];
    const stepMs = 40 * 1000;
    const rounds = Math.round((30 * 60 * 1000) / stepMs);
    for (let i = 0; i < rounds; i++) {
        samples.push(ramp.nextCount({ settings, now: now + (i * stepMs), rng }).count);
    }
    assertGradualCurve(samples.slice(0, 8), engine.MAX_RAMP_STEP);
    const atWindow = samples[samples.length - 1];
    assert.ok(atWindow < first.count, 'did not ramp down during the 30-minute window');
    assert.ok(atWindow >= 10 && atWindow <= 12, 'did not settle in slot 1 by the end of the ramp window: ' + atWindow);
    for (let i = 0; i < 20; i++) {
        samples.push(ramp.nextCount({ settings, now: now + ((rounds + i) * stepMs), rng }).count);
    }
    const last = samples[samples.length - 1];
    assert.ok(last >= 10 && last <= 12, 'did not stay in slot 1 band, last=' + last);
    assert.ok(samples[8] > 12, 'collapsed to slot 1 in 8 rounds: ' + samples[8]);
});

test('manual override injects the exact bot count immediately without a 30-minute ramp', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const scheduled = sevenSlotSettings();
    let now = Date.UTC(2026, 8, 17, 4, 30, 0); // slot 2 ~15-20
    const first = ramp.nextCount({ settings: scheduled, now, rng: () => 0 });
    assert.ok(first.count >= 15 && first.count <= 20);
    assert.strictEqual(first.mode, engine.CONTROL_SCHEDULE);

    const manual = {
        isBotScheduleActive: false,
        botDist1: 40,
        botDist2: 40,
        botDist3: 20,
        botDist4: 20
    };
    const applied = ramp.nextCount({ settings: manual, now: now + 40000, rng: () => 0.99 });
    assert.strictEqual(applied.mode, engine.CONTROL_MANUAL);
    assert.strictEqual(applied.count, 120);
    assert.strictEqual(applied.ramping, false);
    assert.strictEqual(ramp.getLastCount(), 120);
    assert.ok(Math.abs(applied.count - first.count) > 2, 'manual override was forced through the ramp');
});

test('changing the saved manual bot count jumps from 15 to 120 on the next tick', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const now = Date.UTC(2026, 8, 17, 8, 0, 0);
    const small = ramp.nextCount({
        settings: { isBotScheduleActive: false, botDist1: 5, botDist2: 4, botDist3: 3, botDist4: 3 },
        now,
        rng: () => 0
    });
    assert.strictEqual(small.count, 15);

    const large = ramp.nextCount({
        settings: { isBotScheduleActive: false, botDist1: 60, botDist2: 30, botDist3: 20, botDist4: 10 },
        now: now + 40000,
        rng: () => 0.99
    });
    assert.strictEqual(large.count, 120);
    assert.strictEqual(large.ramping, false);
    assert.strictEqual(large.mode, engine.CONTROL_MANUAL);
});

test('applyManualOverride and syncControlMode snap immediately then leave schedule ramps intact', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const now = Date.UTC(2026, 8, 17, 4, 30, 0);
    const snapped = ramp.applyManualOverride(120);
    assert.strictEqual(snapped.count, 120);
    assert.strictEqual(snapped.mode, engine.CONTROL_MANUAL);
    assert.strictEqual(ramp.getMode(), engine.CONTROL_MANUAL);

    const syncedManual = ramp.syncControlMode({
        settings: { isBotScheduleActive: false, botDist1: 80, botDist2: 20, botDist3: 10, botDist4: 10 },
        now
    });
    assert.strictEqual(syncedManual.count, 120);
    assert.strictEqual(syncedManual.mode, engine.CONTROL_MANUAL);

    const settings = sevenSlotSettings();
    const entered = ramp.syncControlMode({ settings, now, rng: () => 0 });
    assert.strictEqual(entered.mode, engine.CONTROL_SCHEDULE);
    assert.ok(entered.count >= 15 && entered.count <= 20);
    assert.strictEqual(entered.ramping, false);

    const afterSameSlotSave = ramp.syncControlMode({ settings, now: now + 60000, rng: () => 0.99 });
    assert.strictEqual(afterSameSlotSave.count, entered.count);
    assert.strictEqual(afterSameSlotSave.ramping, false);

    const later = Date.UTC(2026, 8, 17, 6, 0, 0);
    const samples = [entered.count];
    for (let i = 0; i < 8; i++) {
        samples.push(ramp.nextCount({ settings, now: later + (i * 40000), rng: () => 0.99 }).count);
    }
    assertGradualCurve(samples, engine.MAX_RAMP_STEP);
    assert.ok(Math.max.apply(null, samples) < 30, 'schedule shift jumped to the next slot');
});

test('editing the current schedule slot min/max snaps instead of starting a 30-minute ramp', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const settings = sevenSlotSettings();
    const now = Date.UTC(2026, 8, 17, 4, 30, 0);
    const first = ramp.nextCount({ settings, now, rng: () => 0 });
    assert.ok(first.count >= 15 && first.count <= 20);

    const edited = Object.assign({}, settings, {
        botSchedule2: { start: 6, end: 9, min: 120, max: 120 }
    });
    const next = ramp.nextCount({ settings: edited, now: now + 40000, rng: () => 0.99 });
    assert.strictEqual(next.count, 120);
    assert.strictEqual(next.ramping, false);
    assert.strictEqual(next.mode, engine.CONTROL_SCHEDULE);
});

test('hands-on 5-match live loop detects the locked user card and never rolls past it', async () => {
    const sim = require('./fiveMatchWin.sim');
    const report = await sim.runFiveMatchVerification({ silent: true });
    assert.strictEqual(report.passed, true);
    assert.strictEqual(report.called[report.called.length - 1], 5);
    assert.ok(report.extraAfterLock.indexOf(6) !== -1);
    assert.strictEqual(report.winners[0], sim.USER_PHONE);
    assert.ok(report.broadcast.event === 'game_winner');
    assert.ok(report.history.winnerPhoneList[0] === sim.USER_PHONE);
    assert.ok(report.userPayouts[0].amount > 0);
    assert.ok(String(report.broadcast.ticketId).indexOf(String(sim.USER_CARD)) !== -1);
    assert.strictEqual(report.stickyCalled[report.stickyCalled.length - 1], 5);
});

test('same-tick bot rewrite cannot replace a completed 5-match user card', async () => {
    const sim = require('./fiveMatchWin.sim');
    const report = await sim.runAdversarialSameTickBotRewrite({ silent: true });
    assert.strictEqual(report.passed, true);
    assert.strictEqual(report.winners[0], sim.USER_PHONE);
});

test('game history session lookup never reads an uninitialized binding', () => {
    function getSessionUser(scope) {
        try {
            if (!scope) return null;
            const session = scope.currentUser;
            if (session && session.phone) return session;
        } catch (e) {
            return null;
        }
        return null;
    }
    assert.strictEqual(getSessionUser(null), null);
    assert.strictEqual(getSessionUser({}), null);
    assert.strictEqual(getSessionUser({ currentUser: { phone: '0911' } }).phone, '0911');
});

test('history timestamps convert stored UTC instants to exact EAT clocks', () => {
    assert.strictEqual(engine.formatEatDateTimeExact('2026-09-17T15:42:05.000Z'), '17 Sep 2026, 18:42:05 EAT');
    assert.strictEqual(engine.formatEatDateTimeExact(new Date('2026-09-17T21:05:09.000Z')), '18 Sep 2026, 00:05:09 EAT');
    assert.strictEqual(engine.formatEatDateTimeExact(null), '');
    const shaped = engine.shapeHistoryRounds([{
        gameId: 77,
        date: '2026-09-17T15:42:05.000Z',
        ticketId: '12',
        winnerPhone: '0911223344',
        prize: 80,
        playersData: [{ phone: '0911223344', ticketsData: [{ id: 12, grid: [[1]] }] }]
    }], '0911223344');
    assert.strictEqual(shaped[0].eatDateTime, '17 Sep 2026, 18:42:05 EAT');
});

test('weekly leaderboard window is the current EAT Monday-Sunday cycle', () => {
    const thursday = Date.UTC(2026, 8, 17, 12, 0, 0); // 15:00 EAT Thursday
    const start = engine.currentEatWeekStart(thursday);
    const end = engine.currentEatWeekEnd(thursday);
    assert.strictEqual(engine.formatEatDateTime(start.getTime()), '2026-09-14 00:00');
    assert.strictEqual(end.getTime() - start.getTime(), 7 * 24 * 60 * 60 * 1000);
    const match = engine.weeklyWithdrawMatch(thursday);
    assert.strictEqual(match.type, 'withdraw');
    assert.strictEqual(match.status, 'Approved');
    assert.ok(match.date.$gte.getTime() === start.getTime());
    const shaped = engine.shapeWeeklyLeaderboard([{ _id: '0911', weekly: 500 }], { '0911': { name: 'Abebe' } });
    assert.strictEqual(shaped[0].won, 500);
    assert.strictEqual(shaped[0].name, 'Abebe');
});

test('card shuffle keeps ids 1-N sequential and refreshes internal grids', () => {
    const original = engine.defaultCardOrder(10);
    assert.deepStrictEqual(engine.shuffleCardOrder([10, 1, 4], mulberry32(7), 10), original);
    const seed = engine.nextCardGridSeed(mulberry32(7));
    assert.ok(seed > 0);
    const before = engine.generateFixedCard(12);
    const after = engine.generateFixedCard(12, seed);
    assert.ok(engine.assertValidBingoGrid(after));
    assert.notDeepStrictEqual(after, before);
    assert.deepStrictEqual(engine.generateFixedCard(12, seed), after);
    const preview = engine.previewShuffledGrids(seed, [1, 12]);
    assert.strictEqual(preview[0].id, 1);
    assert.deepStrictEqual(preview[1].grid, after);
    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(/nextCardGridSeed/.test(server), 'admin shuffle must rotate the grid seed');
    assert.ok(!/shuffleCardOrder\(GLOBAL_SETTINGS\.cardBoardOrder/.test(server), 'admin shuffle must not permute card IDs');
    const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    assert.ok(/Card IDs stay 1 to 700/.test(admin));
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const orderFn = html.slice(html.indexOf('function getCardBoardOrder'), html.indexOf('function initGrid'));
    assert.ok(/for \(let i = 1; i <= 700; i\+\+\)/.test(orderFn));
    assert.ok(!/window\.cardBoardOrder/.test(orderFn), 'player board must not use a shuffled ID order');
    assert.ok(/window\.cardGridSeed/.test(html));
});

test('scheduled post builder stores the EAT instant in UTC', () => {
    const built = engine.buildScheduledPost('Hello players', '2026-09-18', '18:30', Date.UTC(2026, 8, 18, 10, 0, 0));
    assert.strictEqual(built.ok, true);
    assert.strictEqual(built.doc.scheduledAt.toISOString(), '2026-09-18T15:30:00.000Z');
    assert.strictEqual(built.doc.status, 'queued');
    const due = engine.postsDue(Date.UTC(2026, 8, 18, 15, 31, 0));
    assert.strictEqual(due.status, 'queued');
});

test('player history won badge uses the individual split and a winner-count subtitle', () => {
    const split = engine.shapeHistoryRounds([{
        gameId: 88,
        ticketId: '12, 44, 71, 90, 101',
        winnerPhone: '0911223344, 0911000001, 0911000002, 0911000003, 0911000004',
        winnerPhoneList: ['0911223344', '0911000001', '0911000002', '0911000003', '0911000004'],
        winnerPayout: 40,
        prize: 200,
        calledNumbers: [1],
        playersData: [{ phone: '0911223344', ticketsData: [{ id: 12, grid: [[1]] }] }]
    }], '0911223344');
    assert.strictEqual(split[0].won, true);
    assert.strictEqual(split[0].winnerCount, 5);
    assert.strictEqual(split[0].payout, 40);
    assert.strictEqual(split[0].prizePool, 200);

    const legacySplit = engine.shapeHistoryRounds([{
        gameId: 89,
        ticketId: '12, 44',
        winnerPhone: '0911223344, 0911000001',
        prize: 171,
        calledNumbers: [1],
        playersData: [{ phone: '0911223344', ticketsData: [{ id: 12, grid: [[1]] }] }]
    }], '0911223344');
    assert.strictEqual(legacySplit[0].winnerCount, 2);
    assert.strictEqual(legacySplit[0].payout, 85.5);

    const sole = engine.shapeHistoryRounds([{
        gameId: 90,
        ticketId: '12',
        winnerPhone: '0911223344',
        prize: 200,
        calledNumbers: [1],
        playersData: [{ phone: '0911223344', ticketsData: [{ id: 12, grid: [[1]] }] }]
    }], '0911223344');
    assert.strictEqual(sole[0].winnerCount, 1);
    assert.strictEqual(sole[0].payout, 200);

    const fullPotStoredAsPayout = engine.shapeHistoryRounds([{
        gameId: 91,
        ticketId: '12, 44, 71, 90, 101',
        winnerPhoneList: ['0911223344', '0911000001', '0911000002', '0911000003', '0911000004'],
        winnerPayout: 200,
        prize: 200,
        calledNumbers: [1],
        playersData: [{ phone: '0911223344', ticketsData: [{ id: 12, grid: [[1]] }] }]
    }], '0911223344');
    assert.strictEqual(fullPotStoredAsPayout[0].payout, 40);

    const fs = require('fs');
    const path = require('path');
    ['../public/index.html', '../publicindex.html'].forEach((file) => {
        const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assert.ok(/function renderHistoryWonBadge/.test(html), 'missing won badge helper in ' + file);
        assert.ok(/winnerCount > 1/.test(html), 'split subtitle must be hidden for a sole winner in ' + file);
        assert.ok(/Winners \/ \$\{winnerCount\} አሸናፊዎች/.test(html), 'missing bilingual split subtitle in ' + file);
        assert.ok(/hist-won-split/.test(html), 'missing split subtitle class in ' + file);
        assert.ok(!/Won \$\{Number\(round\.payout/.test(html), 'old inline won amount still present in ' + file);
        assert.ok(/function formatHistoryEatTime/.test(html), 'missing EAT timestamp helper in ' + file);
        assert.ok(/hist-round-time/.test(html), 'missing EAT timestamp class in ' + file);
        assert.ok(/ EAT/.test(html), 'history timestamp must be labeled EAT in ' + file);
    });
});

test('split win broadcasts the dealt bot kartela and keeps other assigned grids', () => {
    const assigned = openBotGrid();
    const called = [1, 16, 31, 46];
    const forged = [
        [7, 12, 13, 14, 15],
        [24, 27, 28, 29, 30],
        [42, 32, 'FREE', 34, 35],
        [47, 47, 44, 59, 74],
        [64, 64, 45, 60, 75]
    ];
    const bot = { player: { isBot: true }, ticket: { id: 88, grid: forged } };
    const human = { player: { isBot: false }, ticket: { id: 12, grid: assigned } };
    const broadcast = engine.splitWinnerBroadcastGrid(bot, true, assigned);
    assert.strictEqual(broadcast, assigned);
    assert.deepStrictEqual(broadcast, openBotGrid());
    assert.strictEqual(engine.checkBingo(broadcast, called.concat([61])), false);
    assert.strictEqual(engine.splitWinnerBroadcastGrid(human, true, assigned), assigned);
    assert.strictEqual(engine.splitWinnerBroadcastGrid(bot, false, assigned), assigned);
    assert.deepStrictEqual(assigned, openBotGrid());
});

test('split-win payload and board render the closed bot kartela', () => {
    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(server.includes('chooseMixedCall'), 'a mixed win must scan for an authentic shared ball');
    assert.ok(server.includes('closeWinningTicket'), 'winning cards must be marked closed on their grid');
    assert.ok(server.includes('allowNegativeVault'), 'an emergency split must be allowed to record a vault deficit');
    assert.ok(server.includes('winForBots'), 'bot-only draws stay on the seated bot numbers');
    const emitAt = server.indexOf("io.emit('game_winner'");
    assert.ok(emitAt !== -1, 'winner broadcast missing');
    const emitBlock = server.slice(emitAt, emitAt + 1400);
    assert.ok(emitBlock.includes('splitWinnerBroadcastGrid'), 'winner payload must send the dealt grid on a split');
    assert.ok(emitBlock.includes('closed: botOnSplit'));
    const historyAt = server.lastIndexOf('winningGrid:', emitAt);
    assert.ok(historyAt !== -1 && server.slice(historyAt, historyAt + 80).includes('assignedCardGrid(winners[0].ticket)'));
    const persistAt = server.indexOf('async function persistClosedWinner');
    const persistBody = server.slice(persistAt, persistAt + 1400);
    assert.ok(persistBody.includes('playedGridForHistory'), 'history must save the dealt grid');
    assert.ok(persistBody.includes('assignedCardGrid(ticket)'), 'history must read the frozen played card');
    assert.ok(!persistBody.includes('closeBotKartela'), 'history save must not seal a card');
    const claimBody = server.slice(server.indexOf('function claimSyntheticBot'), server.indexOf('function closeBotWinnerKartelas'));
    assert.ok(!claimBody.includes('replaceGrid'), 'a payout bot must not overwrite the frozen card');
    assert.ok(!claimBody.includes('makeNaturalBotTicket'), 'a payout bot must not rewrite purchased cells');
    const closeBody = server.slice(server.indexOf('function closeBotWinnerKartelas'), server.indexOf('function applyFrozenGrid'));
    assert.ok(closeBody.includes('applyFrozenGrid'), 'bot winners must be put back on the frozen card');
    assert.ok(!closeBody.includes('makeNaturalBotTicket'));
    const declareBody = server.slice(server.indexOf('async function declareWinners'), server.indexOf('async function foldMissedRealWinners'));
    assert.ok(!declareBody.includes('replaceGrid'), 'settlement must not replace the frozen card');

    function loadRender(html) {
        const start = html.indexOf('function renderSplitBotKartelas(data)');
        const end = html.indexOf("socket.on('game_winner'", start);
        assert.ok(start !== -1 && end > start, 'missing split bot kartela renderer');
        const bHeads = ['B', 'I', 'N', 'G', 'O'];
        const bColors = ['#3b82f6', '#6366f1', '#a855f7', '#4ade80', '#f97316'];
        return new Function('bHeads', 'bColors', html.slice(start, end) + '\nreturn renderSplitBotKartelas;')(bHeads, bColors);
    }

    const assigned = openBotGrid();
    const called = [1, 16, 31, 46, 61];
    ['../public/index.html', '../publicindex.html'].forEach((file) => {
        const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
        const sharedAt = html.indexOf('በጋራ ሲያሸንፉ ቦክሱ እና ስም ዝርዝሩ ብቻ ይታያል');
        assert.ok(sharedAt !== -1, 'shared win branch missing the name-list popup in ' + file);
        const branch = html.slice(sharedAt, sharedAt + 900);
        assert.ok(branch.indexOf('renderSplitBotKartelas(data)') === -1, 'shared popup must stay the name list in ' + file);
        const render = loadRender(html);
        const markup = render({
            calledNumbers: called,
            cards: [
                { id: 12, isBot: false, closed: false, grid: assigned },
                { id: 88, isBot: true, closed: true, grid: assigned }
            ]
        });
        assert.ok(markup.includes('data-closed="1"'), file);
        assert.ok(markup.includes('data-bot-kartela="88"'), file);
        assert.ok(!markup.includes('data-bot-kartela="12"'), file);
        assert.ok(markup.includes('>11<'), file);
        assert.ok(!markup.includes('>61<'), file);
        assert.strictEqual(render({
            calledNumbers: called,
            cards: [{ id: 88, isBot: true, closed: false, grid: assigned }]
        }), '');
    });
});

function numbersOnCard(grid) {
    const nums = [];
    grid.forEach((col) => col.forEach((val) => {
        if (val !== 'FREE' && val !== 'free') nums.push(Number(val));
    }));
    return nums;
}

test('bot win call is the missing number on the authentic seated card', () => {
    const grid = engine.generateFixedCard(252);
    const snapshot = JSON.parse(JSON.stringify(grid));
    const onCard = numbersOnCard(grid);
    const row = [grid[0][0], grid[1][0], grid[2][0], grid[3][0], grid[4][0]];
    const missing = Number(row[4]);
    const called = row.slice(0, 4).map(Number);
    const bot = {
        isBot: true,
        phone: 'bot-252',
        ticketsData: [
            { id: 10, grid: engine.generateFixedCard(10) },
            { id: 252, grid }
        ]
    };
    const num = engine.pickAuthenticOneAwayNumber([bot], called, { pool: called.concat([missing, 58, 1]) });
    assert.strictEqual(num, missing);
    assert.ok(onCard.indexOf(num) !== -1, 'called number is not on card 252');
    assert.strictEqual(engine.checkBingo(grid, called), false);
    assert.strictEqual(engine.checkBingo(grid, called.concat([num])), true);
    assert.deepStrictEqual(grid, snapshot);
    if (onCard.indexOf(58) === -1) {
        assert.strictEqual(engine.pickAuthenticOneAwayNumber([bot], called, { pool: [58] }), null);
    }
    assert.strictEqual(engine.pickAuthenticOneAwayNumber([bot], called, { pool: [missing], avoid: [missing] }), null);
});

test('mix split calls the same missing number on the real card and a seated bot card', () => {
    const realGrid = [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 'FREE', 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65]
    ];
    const botGrid = [
        [2, 17, 33, 47, 61],
        [3, 18, 34, 48, 62],
        [4, 19, 'FREE', 49, 63],
        [5, 20, 35, 50, 64],
        [6, 21, 36, 51, 65]
    ];
    const realSnap = JSON.parse(JSON.stringify(realGrid));
    const botSnap = JSON.parse(JSON.stringify(botGrid));
    const called = [1, 16, 31, 46, 2, 17, 33, 47];
    const real = { isBot: false, phone: 'real', ticketsData: [{ id: 12, grid: realGrid }] };
    const bot = { isBot: true, phone: 'bot', ticketsData: [{ id: 252, grid: botGrid }] };
    const strangerGrid = [
        [8, 23, 38, 53, 68],
        [9, 24, 39, 54, 69],
        [10, 25, 'FREE', 55, 70],
        [11, 26, 40, 56, 71],
        [12, 27, 41, 57, 72]
    ];
    const stranger = { isBot: true, phone: 'other', ticketsData: [{ id: 77, grid: strangerGrid }] };
    const shared = engine.pickSharedOneAwayNumber([real], [stranger, bot], called, {
        pool: [61, 58, 12, 6]
    });
    assert.strictEqual(shared, 61);
    assert.ok(numbersOnCard(realGrid).indexOf(shared) !== -1);
    assert.ok(numbersOnCard(botGrid).indexOf(shared) !== -1);
    assert.strictEqual(engine.checkBingo(realGrid, called.concat([shared])), true);
    assert.strictEqual(engine.checkBingo(botGrid, called.concat([shared])), true);
    assert.deepStrictEqual(realGrid, realSnap);
    assert.deepStrictEqual(botGrid, botSnap);
    const absent = engine.pickSharedOneAwayNumber([real], [stranger], called, { pool: [61, 58] });
    assert.strictEqual(absent, null);
});

test('card click selects instantly without pending dots or blocking lock UI', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function initGrid');
    const end = html.indexOf('function updateBetPreview');
    assert.ok(start !== -1 && end > start);
    const src = html.slice(start, end);
    assert.ok(!/\balert\s*\(/.test(src), 'card click still calls alert()');
    assert.ok(/socket\.emit\('buy_tickets'/.test(src));
    const emitIdx = src.indexOf("socket.emit('buy_tickets'");
    const paintIdx = src.indexOf('paintSelection()', emitIdx);
    assert.ok(emitIdx !== -1 && paintIdx > emitIdx, 'registration must dispatch before paint');
    assert.ok(/LOCK_MAX_RETRIES/.test(src));
    assert.ok(!/LOCK_TIMEOUT_MS/.test(src));
    assert.ok(/ተይዟል/.test(html), 'conflict toasts must be filtered');
    const rejectSrc = html.slice(html.indexOf("socket.on('ticket_rejected'"), html.indexOf("socket.on('announcement'"));
    assert.ok(!/showCardHint/.test(rejectSrc), 'ticket_rejected still shows a toast');
    const betErrSrc = html.slice(html.indexOf("socket.on('bet_error'"), html.indexOf("socket.on('ticket_cancelled_success'"));
    assert.ok(!/showCardHint/.test(betErrSrc), 'bet_error still shows a toast');
    assert.ok(/mergeServerTickets/.test(html), 'sync must keep in-flight optimistic greens');
    assert.ok(!/pending-lock/.test(src));
    assert.ok(!/innerText = '\.\.\.'/.test(src) && !/innerText = "\.\.\."/.test(src));
    assert.ok(/globalTakenTickets \|\| \[\]\)\.some/.test(src), 'click blocks only on confirmed taken ids');
    assert.ok(/function releaseSelectedCard/.test(html), 'deselect must release local lock state immediately');
    assert.ok(/releaseSelectedCard\(i\)/.test(src), 'clicking a selected card must deselect it');
    assert.ok(!/if\(isProcessingTicket\) return/.test(src), 'deselect must not freeze behind isProcessingTicket');
    const releaseSrc = html.slice(html.indexOf('function releaseSelectedCard'), html.indexOf('function failPendingLock'));
    assert.ok(/queuedCancels.add/.test(releaseSrc));
    assert.ok(/socket\.emit\('cancel_ticket'/.test(releaseSrc), 'deselect must dispatch a release event');
    assert.ok(/queuedCancels.forEach/.test(html), 'sync must keep released cards dropped');
    const cancelSuccess = html.slice(html.indexOf("socket.on('ticket_cancelled_success'"), html.indexOf("socket.on('ticket_cancel_denied'"));
    assert.ok(/Number\(tid\)/.test(cancelSuccess), 'cancel ack must ignore id type mismatch');
    assert.ok(/queuedCancels.delete/.test(cancelSuccess));
    const gridStart = html.indexOf('function renderGridTakenStates');
    const gridEnd = html.indexOf("socket.on('game_status'");
    const gridSrc = html.slice(gridStart, gridEnd);
    assert.ok(/bought-by-me/.test(gridSrc));
    assert.ok(!/isPending/.test(gridSrc));
    assert.ok(!/pending-lock/.test(html));
    const css = html.slice(html.indexOf('.num-btn.bought-by-me'), html.indexOf('.num-btn.taken'));
    assert.ok(!/#854d0e/.test(css));
    assert.ok(/-webkit-tap-highlight-color:\s*transparent/.test(html), 'mobile tap must not flash yellow/orange');
    assert.ok(/num-btn:active/.test(html), 'press state must be green, not amber pending');
    assert.ok(/inFlightTickets\.has\(num\)/.test(gridSrc), 'in-flight picks must stay green, not taken');
    assert.strictEqual((gridSrc.match(/\blet isMine\b/g) || []).length, 1, 'duplicate let isMine would freeze the registration page');
    assert.ok(/onpointerup/.test(src), 'card numbers must use pointerup so taps register instantly');
    assert.ok(/touch-action:\s*manipulation/.test(html), 'mobile tap delay must be disabled');
    const mergeSrc = html.slice(html.indexOf('function mergeServerTickets'), html.indexOf('function dropLocalTicket'));
    assert.ok(/inFlightTickets.has/.test(mergeSrc), 'sync must keep in-flight optimistic greens');
    assert.ok(!/takenSet/.test(mergeSrc), 'public taken must not wipe an in-flight green');
});

test('purchase and referral rules are hardcoded in the backend handlers', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const buy = src.slice(src.indexOf("socket.on('buy_tickets'"), src.indexOf("socket.on('cancel_ticket'"));
    assert.ok(buy.includes('bookCardPurchase'), 'real purchases must use the hardcoded card split');
    assert.ok(buy.includes('purchase.totalNet'), 'prize pool must receive the 8 ETB share');
    assert.ok(buy.includes('platformFee'), 'each card must record the 2 ETB platform fee');
    assert.ok(!buy.includes('adminProfitPercent'), 'card purchase must not follow the admin profit percent');
    const cancel = src.slice(src.indexOf("socket.on('cancel_ticket'"), src.indexOf('bot.setWebHook'));
    assert.ok(cancel.includes('refundCancelledCard'), 'cancel must refund the full card price');
    assert.ok(cancel.includes('refund.poolReversal'), 'cancel must remove only the prize-pool share');
    assert.ok(!cancel.includes('adminProfitPercent'), 'cancel must not skim the refund with admin profit percent');
    const bots = src.slice(src.indexOf('let buyNow = queueItem.tixCount'), src.indexOf('if(didInject)'));
    assert.ok(bots.includes('bookCardPurchase'), 'bot purchases must use the same hardcoded split');
    assert.ok(bots.includes('purchase.totalNet'));
    assert.ok(src.includes('reserveReferralSignup'));
    assert.ok(src.includes('Daily referral invite limit reached for this link'));
    assert.ok(src.includes('claimInviteLink'));
});

test('server emits ticket_locked only after persist, seat, and committed cache', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const persistIdx = src.indexOf('await persistRoundEntries(phone');
    const cacheIdx = src.indexOf('committedRoundEntriesCache = (committedRoundEntriesCache || []).concat');
    const confirmIdx = src.indexOf('confirmTicketsLocked(socket, phone, incomingIds)', persistIdx);
    assert.ok(persistIdx !== -1 && cacheIdx !== -1 && confirmIdx !== -1);
    assert.ok(persistIdx < confirmIdx, 'lock ack before persist');
    assert.ok(cacheIdx < confirmIdx, 'lock ack before committed cache');
    const successTail = src.slice(confirmIdx, src.indexOf("socket.on('cancel_ticket'"));
    assert.ok(successTail.indexOf("io.emit('update_taken_tickets'") !== -1);
    assert.ok(src.indexOf('confirmTicketsLocked(socket, phone, incomingIds)', persistIdx) < src.indexOf("io.emit('update_taken_tickets', getPublicTakenTickets());\n                let currentState"), 'broadcasts should not delay the lock ack');
    const fn = src.slice(src.indexOf('function confirmTicketsLocked'), src.indexOf('function reserveTicketsInMemory'));
    assert.ok(/committedLockAck/.test(fn));
    const playingIdx = src.indexOf('} else if (gameState === "PLAYING")');
    const hydrateIdx = src.indexOf('hydratePlayersFromEntries(activePlayers, committedRoundEntriesCache)', playingIdx);
    const drawIdx = src.indexOf('currentDrawSequence.length === 0', hydrateIdx);
    assert.ok(playingIdx !== -1 && hydrateIdx !== -1 && drawIdx !== -1);
    assert.ok(hydrateIdx < drawIdx, 'PLAYING tick must reseat committed cards before the draw');
    assert.ok(/function isConfirmedTakenByOther/.test(src));
    assert.ok(/function rebuildTakenFromSeated/.test(src));
    assert.ok(/function recoverOwnCommittedTickets/.test(src));
    assert.ok(src.indexOf("socket.emit('bet_error'") === -1, 'card rejects must not emit bet_error toasts');
    const dupIdx = src.indexOf('err.code === 11000');
    assert.ok(dupIdx !== -1);
    assert.ok(src.lastIndexOf('recoverOwnCommittedTickets', src.indexOf('rejectTickets(socket, incomingIds, `❌ የመረጡት ካርቴላ ቀድሞ ተይዟል', dupIdx)) > dupIdx, 'duplicate key must recover own cards before rejecting');
    assert.ok(/function clearCancelledRoundEntries/.test(src), 'stale cancelled unique rows must be deleted before persist');
    assert.ok(/await clearCancelledRoundEntries\(docs.map/.test(src));
    const cancelFn = src.slice(src.indexOf('async function cancelRoundEntry'), src.indexOf('async function loadCommittedRoundEntries'));
    assert.ok(/deleteMany/.test(cancelFn), 'deselect must free the unique ticket slot');
    assert.ok(!/\$set: \{ status: 'cancelled' \}/.test(cancelFn));
    assert.ok(/function emitTicketReleased/.test(src));
    assert.ok(/function dropCommittedCacheTickets/.test(src));
    const releaseFn = src.slice(src.indexOf('async function handleReleaseTicket'), src.indexOf("socket.on('cancel_ticket'"));
    assert.ok(/emitTicketReleased\(socket, phone, \[ticketId\]\)/.test(releaseFn), 'unseated deselect must still ack the release');
    assert.ok(/ticket_cancel_denied/.test(releaseFn));
    assert.ok(/socket.on\('release_ticket'/.test(src), 'server must accept a release event');
    assert.ok(/dupRetried/.test(src), 'false registered conflicts after cancel must retry once');
});

test('player history query uses indexed phone+date and a small page size', () => {
    assert.strictEqual(engine.parseHistoryLimit(), 10);
    assert.strictEqual(engine.parseHistoryLimit('3'), 3);
    assert.strictEqual(engine.parseHistoryLimit('99'), 15);
    const filter = engine.playerHistoryFilter('0911223344', '2026-09-17T15:00:00.000Z');
    assert.ok(Array.isArray(filter.$or));
    assert.ok(filter.$or.some((c) => c.participantPhones === '0911223344'));
    assert.ok(filter.$or.some((c) => c['playersData.phone'] === '0911223344'));
    assert.ok(filter.date && filter.date.$lt instanceof Date);
    const proj = engine.playerHistoryProjection('0911223344');
    assert.deepStrictEqual(proj.playersData, { $elemMatch: { phone: '0911223344' } });
    const shaped = engine.shapeHistoryRounds([{
        gameId: 1204,
        date: new Date('2026-09-17T15:42:00.000Z'),
        ticketId: '12',
        winnerPhone: '0911223344',
        winnerPhoneList: ['0911223344'],
        winnerPayout: 85.5,
        prize: 171,
        calledNumbers: [1, 2, 3],
        playersData: [{ phone: '0911223344', ticketsData: [{ id: 12, grid: [[1, 2, 3, 4, 5], [16, 17, 18, 19, 20], [31, 32, 'FREE', 34, 35], [46, 47, 48, 49, 50], [61, 62, 63, 64, 65]] }] }]
    }], '0911223344');
    assert.strictEqual(shaped.length, 1);
    assert.strictEqual(shaped[0].won, true);
    assert.strictEqual(shaped[0].winnerCount, 1);
    assert.strictEqual(shaped[0].payout, 85.5);
    assert.strictEqual(shaped[0].eatDateTime, '17 Sep 2026, 18:42:00 EAT');
    assert.deepStrictEqual(shaped[0].cardIds, [12]);
    assert.strictEqual(shaped[0].roundId, 1204);
    assert.strictEqual(shaped[0].linesNeeded, 2);
});

test('history round id, lost line gap, and split winner count come from the saved round', () => {
    const grid = [[1, 2, 3, 4, 5], [16, 17, 18, 19, 20], [31, 32, 'FREE', 34, 35], [46, 47, 48, 49, 50], [61, 62, 63, 64, 65]];
    const lost = engine.shapeHistoryRounds([{
        gameId: 40,
        roundId: 50,
        ticketId: '44, 71',
        winnerPhone: '0911000001, 0911000002',
        winnerPhoneList: ['0911000001', '0911000002'],
        prize: 100,
        calledNumbers: [1, 2, 3],
        playersData: [{ phone: '0911223344', ticketsData: [{ id: 12, grid }] }]
    }], '0911223344');
    assert.strictEqual(lost[0].roundId, 50);
    assert.strictEqual(lost[0].won, false);
    assert.strictEqual(lost[0].winnerCount, 2);
    assert.strictEqual(lost[0].linesNeeded, 2);
    assert.deepStrictEqual(lost[0].cardIds, [12]);
    const fallback = engine.shapeHistoryRounds([{ gameId: 9, playersData: [] }], '0911');
    assert.strictEqual(fallback[0].roundId, 9);
    assert.strictEqual(fallback[0].linesNeeded, null);
});

test('admin card snapshots keep the locked grid for a kartela id', () => {
    const locked = [
        [9, 10, 11, 4, 3],
        [23, 21, 25, 19, 26],
        [41, 42, 'FREE', 35, 32],
        [52, 55, 46, 58, 59],
        [72, 65, 66, 63, 70]
    ];
    const rewritten = [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 'FREE', 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65]
    ];
    const players = [{
        phone: 'bot629',
        name: 'Bot',
        isBot: true,
        ticketsData: [{ id: 629, grid: rewritten }]
    }];
    const entries = [{
        gameId: 42,
        phone: 'bot629',
        name: 'Bot',
        isBot: true,
        ticketId: 629,
        status: 'active',
        grid: locked
    }];
    const cards = engine.collectCardSnapshots(players, entries);
    assert.strictEqual(cards.length, 1);
    assert.strictEqual(cards[0].id, 629);
    assert.deepStrictEqual(cards[0].grid, locked);
    const poked = locked.map((col) => col.slice());
    poked[0][0] = 8;
    assert.strictEqual(cards[0].grid[0][0], 9);

    const game = {
        gameId: 42,
        ticketId: '629',
        winningGrid: rewritten,
        playersData: [{ phone: 'bot629', name: 'Bot', isBot: true, ticketsData: [{ id: 629, grid: rewritten }] }]
    };
    engine.applyCardSnapshots(game, entries);
    assert.deepStrictEqual(game.playersData[0].ticketsData[0].grid, [
        [9, 10, 11, 4, 3],
        [23, 21, 25, 19, 26],
        [41, 42, 'FREE', 35, 32],
        [52, 55, 46, 58, 59],
        [72, 65, 66, 63, 70]
    ]);
    assert.deepStrictEqual(game.winningGrid, game.cards[0].grid);
    assert.strictEqual(game.cards[0].grid[0][0], 9);

    const played = [
        [1, 2, 3, 4, 5],
        [16, 17, 18, 19, 20],
        [31, 32, 'FREE', 34, 35],
        [46, 47, 48, 49, 50],
        [61, 62, 63, 64, 65]
    ];
    const stale = locked.map((col) => col.slice());
    const searchGame = {
        gameId: 42,
        playersData: [{ phone: '0911223344', name: 'Abebe', isBot: false, tickets: 1, ticketsData: [{ id: 12, grid: played.map((col) => col.slice()) }] }]
    };
    engine.keepPlayedSearchGrids(searchGame, [{
        phone: '0911223344',
        ticketId: 12,
        status: 'active',
        grid: stale
    }, {
        phone: '0911000000',
        ticketId: 77,
        status: 'active',
        grid: stale
    }]);
    assert.strictEqual(searchGame.playersData.length, 1);
    assert.deepStrictEqual(searchGame.playersData[0].ticketsData[0].grid, played);
    assert.strictEqual(searchGame.playersData[0].ticketsData.length, 1);

    const storedOnly = engine.collectCardSnapshots([{
        phone: '0911',
        name: 'Abebe',
        isBot: false,
        ticketsData: [{ id: 12, grid: rewritten }]
    }], []);
    assert.deepStrictEqual(storedOnly[0].grid, rewritten);
    assert.strictEqual(engine.collectCardSnapshots([{ phone: 'x', ticketsData: [{ id: 3 }] }], []).length, 0);
});

test('admin history list uses a slim projection and a 15-row first page', () => {
    assert.strictEqual(engine.parseAdminHistoryLimit(), 15);
    assert.strictEqual(engine.parseAdminHistoryLimit('8'), 8);
    assert.strictEqual(engine.parseAdminHistoryLimit('99'), 30);
    const proj = engine.adminHistoryListProjection();
    assert.strictEqual(proj.calledNumbers, undefined);
    assert.strictEqual(proj.winningGrid, undefined);
    assert.strictEqual(proj['playersData.ticketsData.id'], 1);
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(src.indexOf('adminHistoryListProjection') !== -1);
    assert.ok(src.indexOf('estimatedDocumentCount') !== -1);
    const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    assert.ok(/historyLimitPerPage = 15/.test(html));
    assert.ok(/\/api\/admin\/history-detail/.test(html));
});

test('user winner history keeps real winners and drops bot-only rows', () => {
    const userGame = {
        winnerPhone: '0911000001',
        playersData: [{ phone: '0911000001', isBot: false }]
    };
    const botGame = {
        winnerPhone: '0900000001, 0900000002',
        playersData: [
            { phone: '0900000001', isBot: true },
            { phone: '0900000002', isBot: true }
        ]
    };
    const mixed = {
        winnerPhoneList: ['0911000001', '0900000002'],
        winnerPhone: 'ignored',
        playersData: [
            { phone: '0911000001', isBot: false },
            { phone: '0900000002', isBot: true }
        ]
    };
    const unlabeled = { winnerPhone: '0911222333', playersData: [{ phone: '0911222333' }] };

    assert.deepStrictEqual(engine.userWinnerPhones(userGame), ['0911000001']);
    assert.strictEqual(engine.gameHasUserWinner(userGame), true);
    assert.deepStrictEqual(engine.userWinnerPhones(botGame), []);
    assert.strictEqual(engine.gameHasUserWinner(botGame), false);
    assert.deepStrictEqual(engine.userWinnerPhones(mixed), ['0911000001']);
    assert.strictEqual(engine.gameHasUserWinner(mixed), true);
    assert.deepStrictEqual(engine.userWinnerPhones(unlabeled), ['0911222333']);
    assert.strictEqual(engine.gameHasUserWinner({ winnerPhone: '' }), false);

    const clause = engine.userWinnerHistoryClause();
    assert.ok(clause.$expr);
    const src = require('fs').readFileSync(require('path').join(__dirname, '../server.js'), 'utf8');
    assert.ok(src.indexOf("String(req.body.winners || '') === 'user'") !== -1);
    const mobile = require('fs').readFileSync(require('path').join(__dirname, '../public/mobile-ops.html'), 'utf8');
    assert.ok(mobile.indexOf("winners: 'user'") !== -1);
});

test('custom botRampMinutes lands in the next slot band exactly at the window end', () => {
    const ramp = engine.createBotRampController({ maxBots: 360 });
    const settings = sevenSlotSettings({ botRampMinutes: 10, gameTimer: 40 });
    let now = Date.UTC(2026, 8, 17, 4, 30, 0);
    const first = ramp.nextCount({ settings, now, rng: () => 0 });
    assert.ok(first.count >= 15 && first.count <= 20);
    now = Date.UTC(2026, 8, 17, 6, 0, 0);
    const stepMs = 40 * 1000;
    const rounds = Math.round((10 * 60 * 1000) / stepMs);
    let last = first.count;
    for (let i = 0; i < rounds; i++) {
        last = ramp.nextCount({ settings, now: now + (i * stepMs), rng: () => 0.5 }).count;
    }
    assert.ok(last >= 20 && last <= 30, '10-minute ramp missed slot 3, last=' + last);
    assert.strictEqual(engine.normalizeBotRampMinutes(0), 30);
    assert.strictEqual(engine.normalizeBotRampMinutes(5), 5);
    assert.strictEqual(engine.normalizeBotRampMinutes(999), 180);
});

test('weekly leaderboard honors a mid-week reset and manual rank overrides', () => {
    const thursday = Date.UTC(2026, 8, 17, 12, 0, 0);
    const weekStart = engine.currentEatWeekStart(thursday);
    const resetAt = new Date(weekStart.getTime() + (2 * 24 * 60 * 60 * 1000));
    const match = engine.weeklyWithdrawMatch(thursday, resetAt);
    assert.ok(match.date.$gte.getTime() === resetAt.getTime());
    const merged = engine.mergeWeeklyLeaderboard(
        [{ _id: '0911', weekly: 800 }, { _id: '0912', weekly: 400 }],
        [
            { phone: '0911', name: 'Abebe', weeklyRankOverride: 0 },
            { phone: '0913', name: 'Chala', weeklyRankOverride: 250 }
        ]
    );
    assert.deepStrictEqual(merged.map((r) => r._id), ['0912', '0913']);
    assert.strictEqual(merged[0].weekly, 400);
    assert.strictEqual(merged[1].weekly, 250);
    const shaped = engine.shapeWeeklyLeaderboard(merged, {
        '0912': { name: 'Kebede' },
        '0913': { name: 'Chala', weeklyRankOverride: 250 }
    });
    assert.strictEqual(shaped[0].rank, 1);
    assert.strictEqual(shaped[1].weeklyRankOverride, 250);
});

test('restricted players cannot keep a four-corner or any bingo payout', () => {
    const grid = rowWinGrid();
    const called = [1, 5, 61];
    const remaining = [65, 10, 20];
    const players = {
        cool: {
            phone: 'cool',
            isBot: false,
            hasDeposited: true,
            realBetAmount: 10,
            ticketsData: [{ id: 1, grid }]
        },
        ok: {
            phone: 'ok',
            isBot: false,
            hasDeposited: true,
            realBetAmount: 10,
            ticketsData: [{ id: 2, grid: engine.generateFixedCard(99) }]
        }
    };
    const ctx = { allowBonusWin: false, activeCooldowns: { cool: 8 }, timeBans: {}, now: Date.now() };
    assert.strictEqual(engine.checkFourCorners(grid, [1, 5, 61, 65]), true);
    const hits = engine.collectRestrictedCompletingNumbers(players, called, remaining, ctx);
    assert.ok(hits.fourCorner.indexOf(65) !== -1);
    assert.ok(hits.blocked.indexOf(65) !== -1);
    const paid = engine.excludeRestrictedWinners([
        { player: players.cool, ticket: players.cool.ticketsData[0] },
        { player: players.ok, ticket: players.ok.ticketsData[0] }
    ], ctx);
    assert.deepStrictEqual(paid.map((w) => w.player.phone), ['ok']);
    const bonusOnly = engine.excludeRestrictedWinners([
        { player: { phone: 'bonus', isBot: false, hasDeposited: false, realBetAmount: 0 }, ticket: { id: 3 } }
    ], { allowBonusWin: false, activeCooldowns: {}, timeBans: {} });
    assert.strictEqual(bonusOnly.length, 0);
});

test('large depositors keep priority after a win and cooldown stays weight 0', () => {
    const ctx = { allowBonusWin: true, activeCooldowns: { cool: 5 }, timeBans: {}, winHistory: {}, now: Date.now() };
    const seated = (phone, extra) => Object.assign({
        phone,
        isBot: false,
        hasDeposited: true,
        realBetAmount: 10,
        won: 0,
        depositTodayEtb: 0,
        totalDeposited: 0,
        roundsTodayWithoutWin: 0,
        winsToday: 0
    }, extra);
    const daily = seated('daily', { depositTodayEtb: 500, totalDeposited: 500, winsToday: 4, won: 80 });
    const lifetime = seated('life', { depositTodayEtb: 0, totalDeposited: 3000, winsToday: 2, won: 40 });
    const under = seated('under', { depositTodayEtb: 499, totalDeposited: 2999, won: 0, roundsTodayWithoutWin: 10 });
    const cool = seated('cool', { depositTodayEtb: 5000, totalDeposited: 9000, winsToday: 0 });
    const banned = seated('ban', { depositTodayEtb: 800, totalDeposited: 800 });
    const banCtx = Object.assign({}, ctx, { timeBans: { ban: Date.now() + 60000 } });
    assert.strictEqual(engine.LARGE_DAILY_DEPOSIT_ETB, 500);
    assert.strictEqual(engine.LARGE_LIFETIME_DEPOSIT_ETB, 3000);
    assert.strictEqual(engine.LARGE_GROUP_PROBABILITY, 0.6);
    assert.strictEqual(engine.isLargeDepositor(daily, ctx), true);
    assert.strictEqual(engine.isLargeDepositor(lifetime, ctx), true);
    assert.strictEqual(engine.isHighRollerPriority(daily, ctx), true);
    assert.strictEqual(engine.isLargeDepositor(under, ctx), false);
    assert.strictEqual(engine.isLargeDepositor(cool, ctx), false);
    assert.strictEqual(engine.isLargeDepositor(banned, banCtx), false);
    assert.strictEqual(engine.winPriorityScore(cool, ctx), 0);
    assert.strictEqual(engine.largeDepositorWeight(daily, ctx), 500 + (500 * 0.2));
    assert.strictEqual(engine.largeDepositorWeight(lifetime, ctx), 3000 * 0.2);
    const mapped = seated('map');
    delete mapped.depositTodayEtb;
    delete mapped.totalDeposited;
    const mapCtx = Object.assign({}, ctx, {
        depositTodayEtb: { map: 100 },
        totalDeposited: { map: 3000 }
    });
    assert.strictEqual(engine.isLargeDepositor(mapped, mapCtx), true);

    function scripted(seq) {
        let i = 0;
        return function () {
            const value = seq[i];
            i += 1;
            return value;
        };
    }
    const players = { daily, life: lifetime, under };
    const phones = ['daily', 'life', 'under', 'cool'];
    const largeRoll = Object.assign({}, ctx, { rng: scripted([0.0, 0.0]) });
    assert.strictEqual(engine.pickPriorityWinnerPhone(phones, players, largeRoll), 'life');
    const secondLarge = Object.assign({}, ctx, { rng: scripted([0.2, 0.75]) });
    assert.strictEqual(engine.pickPriorityWinnerPhone(phones, players, secondLarge), 'life');
    const smallRoll = Object.assign({}, ctx, { rng: scripted([0.6]) });
    assert.strictEqual(engine.pickPriorityWinnerPhone(phones, players, smallRoll), 'under');
    assert.strictEqual(engine.pickPriorityWinnerPhone(['cool'], { cool }, ctx), null);
    const onlyLarge = Object.assign({}, ctx, { rng: scripted([0.99]) });
    assert.strictEqual(engine.pickPriorityWinnerPhone(['daily', 'life', 'cool'], players, onlyLarge), 'life');
    const targets = engine.selectTargetCandidates([daily, under, cool], Object.assign({}, ctx, { rng: scripted([0.0, 0.0]) }));
    assert.deepStrictEqual(targets, ['daily']);

    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(/totalDeposited: user\.totalDeposited \|\| 0/.test(server));
    assert.ok(/totalDeposited: totalDepositedByPhone/.test(server));
    assert.ok(/depositTodayEtb: depositTodayByPhone/.test(server));
    assert.ok(/totalWithdrawn: user\.totalWithdrawn \|\| 0/.test(server));
    assert.ok(/netContribution:/.test(server));
    assert.ok(/netContribution: netContributionByPhone/.test(server));
});

test('60/40 depositor draw holds across repeated winner picks', () => {
    const now = Date.now();
    const ctx = { allowBonusWin: true, activeCooldowns: { cool: 12 }, timeBans: {}, winHistory: {}, now };
    const seated = (phone, extra) => Object.assign({
        phone,
        isBot: false,
        hasDeposited: true,
        realBetAmount: 10,
        won: 0,
        depositTodayEtb: 0,
        totalDeposited: 0,
        roundsTodayWithoutWin: 0,
        winsToday: 0
    }, extra);
    const bigDaily = seated('bigDaily', { depositTodayEtb: 500, totalDeposited: 500, winsToday: 3, won: 90 });
    const bigger = seated('bigger', { depositTodayEtb: 1000, totalDeposited: 4000, winsToday: 1, won: 40 });
    const lifetimeOnly = seated('lifetimeOnly', { depositTodayEtb: 0, totalDeposited: 3000, winsToday: 2, won: 20 });
    const grinder = seated('grinder', { depositTodayEtb: 499, totalDeposited: 2999, won: 50, roundsTodayWithoutWin: 10 });
    const fresh = seated('fresh', { depositTodayEtb: 100, totalDeposited: 200, won: 0, roundsTodayWithoutWin: 0 });
    const quiet = seated('quiet', { depositTodayEtb: 50, totalDeposited: 50, won: 10, roundsTodayWithoutWin: 0 });
    const cool = seated('cool', { depositTodayEtb: 8000, totalDeposited: 20000, winsToday: 0, won: 100 });
    const players = { bigDaily, bigger, lifetimeOnly, grinder, fresh, quiet, cool };
    const phones = Object.keys(players);
    const weights = {
        bigDaily: 500 + (500 * 0.2),
        bigger: 1000 + (4000 * 0.2),
        lifetimeOnly: 3000 * 0.2
    };
    const largeWeight = weights.bigDaily + weights.bigger + weights.lifetimeOnly;
    const trials = 8000;
    const hits = {};
    phones.forEach((phone) => { hits[phone] = 0; });
    let candidateLarge = 0;
    for (let i = 0; i < trials; i++) {
        const phone = engine.pickPriorityWinnerPhone(phones, players, ctx);
        assert.ok(phone && phone !== 'cool');
        hits[phone] += 1;
        const picks = engine.selectTargetCandidates([bigDaily, fresh], ctx);
        assert.strictEqual(picks.length, 1);
        if (picks[0] === 'bigDaily') candidateLarge += 1;
    }
    function share(phone) {
        return hits[phone] / trials;
    }
    const largeShare = share('bigDaily') + share('bigger') + share('lifetimeOnly');
    const smallShare = share('grinder') + share('fresh') + share('quiet');
    console.log('60/40 sim large=' + largeShare.toFixed(3) + ' small=' + smallShare.toFixed(3)
        + ' bigger=' + share('bigger').toFixed(3)
        + ' targets=' + (candidateLarge / trials).toFixed(3));
    assert.strictEqual(hits.cool, 0);
    assert.strictEqual(hits.fresh, 0);
    assert.strictEqual(hits.quiet, 0);
    assert.ok(Math.abs(largeShare - 0.6) < 0.04, 'large group ' + largeShare);
    assert.ok(Math.abs(smallShare - 0.4) < 0.04, 'small group ' + smallShare);
    assert.ok(Math.abs(share('grinder') - 0.4) < 0.04, 'deepest small net ' + share('grinder'));
    assert.ok(Math.abs(share('bigger') - 0.6) < 0.04, 'deepest large net ' + share('bigger'));
    assert.strictEqual(hits.bigDaily, 0);
    assert.strictEqual(hits.lifetimeOnly, 0);
    assert.ok(Math.abs((candidateLarge / trials) - 0.6) < 0.04);

    const smallOnly = { grinder, fresh, quiet };
    const smallHits = { grinder: 0, fresh: 0, quiet: 0 };
    for (let i = 0; i < 1000; i++) {
        smallHits[engine.pickPriorityWinnerPhone(['grinder', 'fresh', 'quiet', 'cool'], smallOnly, ctx)] += 1;
    }
    assert.strictEqual(smallHits.grinder, 1000);
    assert.strictEqual(smallHits.fresh, 0);

    const largeOnlyHits = { bigDaily: 0, bigger: 0, lifetimeOnly: 0 };
    for (let i = 0; i < 3000; i++) {
        const phone = engine.pickPriorityWinnerPhone(['bigDaily', 'bigger', 'lifetimeOnly', 'cool'], players, ctx);
        largeOnlyHits[phone] += 1;
    }
    assert.strictEqual(largeOnlyHits.bigger, 3000);
    assert.strictEqual(largeOnlyHits.bigDaily + largeOnlyHits.bigger + largeOnlyHits.lifetimeOnly, 3000);
});

test('over-withdrawn players score 0 and lose the steer to net-loss depositors', () => {
    const ctx = { allowBonusWin: false, activeCooldowns: {}, timeBans: {}, winHistory: {}, now: Date.now() };
    const seated = (phone, extra) => Object.assign({
        phone,
        isBot: false,
        hasDeposited: true,
        realBetAmount: 10,
        won: 0,
        depositTodayEtb: 0,
        totalDeposited: 0,
        totalWithdrawn: 0,
        roundsTodayWithoutWin: 0,
        winsToday: 0
    }, extra);
    const siphon = seated('siphon', {
        totalDeposited: 1000,
        totalWithdrawn: 20000,
        netContribution: 1000 - 20000,
        won: 19000,
        roundsTodayWithoutWin: 40,
        depositTodayEtb: 1000
    });
    const unpaid = seated('unpaid', {
        totalDeposited: 1000,
        totalWithdrawn: 0,
        netContribution: 1000,
        won: 0,
        roundsTodayWithoutWin: 0
    });
    const deeper = seated('deeper', {
        totalDeposited: 3000,
        totalWithdrawn: 200,
        netContribution: 2800,
        won: 100,
        depositTodayEtb: 0
    });
    assert.strictEqual(engine.netContributionOf(siphon, ctx), -19000);
    assert.strictEqual(engine.winPriorityScore(siphon, ctx), 0);
    assert.ok(engine.winPriorityScore(unpaid, ctx) > 0);
    assert.strictEqual(engine.smallDepositorTieScore(siphon, ctx), 0);
    assert.strictEqual(engine.largeDepositorWeight(siphon, ctx), 0);
    assert.strictEqual(engine.minimumBotShare(siphon, ctx), 1);
    assert.strictEqual(engine.minimumBotShare(unpaid, ctx), 0);
    assert.strictEqual(engine.isTargetPoolBaseEligible(unpaid, ctx), true);
    assert.strictEqual(engine.isTargetPoolBaseEligible(siphon, ctx), true);
    const players = { siphon, unpaid, deeper };
    for (let i = 0; i < 200; i++) {
        const phone = engine.pickPriorityWinnerPhone(['siphon', 'unpaid', 'deeper'], players, Object.assign({}, ctx, { rng: Math.random }));
        assert.notStrictEqual(phone, 'siphon');
    }
    assert.strictEqual(engine.pickPriorityWinnerPhone(['siphon', 'deeper'], players, ctx), 'deeper');
    assert.strictEqual(engine.pickPriorityWinnerPhone(['deeper', 'unpaid'], players, Object.assign({}, ctx, { rng: function () { return 0.0; } })), 'deeper');
    assert.strictEqual(engine.pickPriorityWinnerPhone(['siphon'], { siphon }, ctx), 'siphon');

    const largeNeverWonSiphon = seated('ghost', {
        totalDeposited: 4000,
        totalWithdrawn: 20000,
        netContribution: 4000 - 20000,
        won: 0,
        depositTodayEtb: 800
    });
    const smallLoss = seated('loss', {
        totalDeposited: 400,
        totalWithdrawn: 0,
        netContribution: 400,
        won: 0
    });
    assert.strictEqual(engine.isTargetPoolBaseEligible(largeNeverWonSiphon, ctx), true);
    assert.strictEqual(engine.isTargetPoolBaseEligible(smallLoss, ctx), true);
    const ghostHits = { ghost: 0, loss: 0 };
    for (let i = 0; i < 200; i++) {
        const phone = engine.pickPriorityWinnerPhone(
            ['ghost', 'loss'],
            { ghost: largeNeverWonSiphon, loss: smallLoss },
            Object.assign({}, ctx, { rng: Math.random })
        );
        ghostHits[phone] += 1;
    }
    assert.ok(ghostHits.ghost > 0 && ghostHits.loss > 0, 'negative lifetime net stays in the target pool');
    assert.strictEqual(engine.winPriorityScore(largeNeverWonSiphon, ctx), 0);
    assert.strictEqual(engine.minimumBotShare(largeNeverWonSiphon, ctx), 1);
    assert.strictEqual(engine.pickPriorityWinnerPhone(['ghost'], { ghost: largeNeverWonSiphon }, ctx), 'ghost');
    const repeatProfit = seated('repeat', {
        totalDeposited: 3000,
        totalWithdrawn: 9000,
        netContribution: -6000,
        won: 4000,
        depositTodayEtb: 1000
    });
    const neverWonLoss = seated('never', {
        totalDeposited: 100,
        totalWithdrawn: 500,
        netContribution: -400,
        won: 0
    });
    assert.strictEqual(engine.isTargetPoolBaseEligible(repeatProfit, ctx), true);
    assert.strictEqual(engine.isTargetPoolBaseEligible(neverWonLoss, ctx), true);
    const repeatHits = { repeat: 0, never: 0 };
    for (let i = 0; i < 200; i++) {
        const phone = engine.pickPriorityWinnerPhone(
            ['repeat', 'never'],
            { repeat: repeatProfit, never: neverWonLoss },
            Object.assign({}, ctx, { rng: Math.random })
        );
        repeatHits[phone] += 1;
    }
    assert.ok(repeatHits.repeat > 0 && repeatHits.never > 0, 'a prior winner with negative net stays selectable');

    const dry = seated('dry', {
        totalDeposited: 1000,
        totalWithdrawn: 5000,
        netContribution: -4000,
        won: 80,
        roundsTodayWithoutWin: 40
    });
    const quietProfit = seated('quietProfit', {
        totalDeposited: 1000,
        totalWithdrawn: 5000,
        netContribution: -4000,
        won: 80,
        roundsTodayWithoutWin: 0
    });
    const dryHits = { dry: 0, quietProfit: 0 };
    for (let i = 0; i < 200; i++) {
        dryHits[engine.pickPriorityWinnerPhone(['dry', 'quietProfit'], { dry, quietProfit }, ctx)] += 1;
    }
    assert.ok(dryHits.dry > 0 && dryHits.quietProfit > 0, 'dry-round bonus must not decide a net-profit tie');
    assert.strictEqual(engine.smallDepositorTieScore(dry, ctx), 0);

    const attached = seated('attached', { totalDeposited: 1500, totalWithdrawn: 400 });
    engine.attachEligibility(attached, ctx);
    assert.strictEqual(attached.netContribution, 1100);

    const sameNetA = seated('weightA', { totalDeposited: 3000, totalWithdrawn: 0, depositTodayEtb: 500, won: 10 });
    const sameNetB = seated('weightB', { totalDeposited: 3000, totalWithdrawn: 0, depositTodayEtb: 0, won: 10 });
    const weightCtx = Object.assign({}, ctx, { rng: function () { return 0; } });
    assert.strictEqual(engine.pickPriorityWinnerPhone(['weightA', 'weightB'], { weightA: sameNetA, weightB: sameNetB }, weightCtx), 'weightA');

    const settled = engine.settleWinnerVault(
        { virtualPrizePool: 100, vaultTwoBalance: 500, vaultThreeBalance: 80 },
        { realMoneyOut: 40, isWinnerDepositor: true, realWinnersCount: 1, botWinnersCount: 1, totalWinners: 2, allowNegative: false }
    );
    assert.strictEqual(settled.charged, 'vaultThreeBalance');
    assert.strictEqual(settled.balances.vaultTwoBalance, 500);
    const solo = engine.settleWinnerVault(
        { virtualPrizePool: 100, vaultTwoBalance: 500, vaultThreeBalance: 80 },
        { realMoneyOut: 80, isWinnerDepositor: true, realWinnersCount: 1, botWinnersCount: 0, totalWinners: 1, allowNegative: false }
    );
    assert.strictEqual(solo.charged, 'vaultTwoBalance');
    assert.strictEqual(engine.FINISH_CALL_MIN, 14);
    assert.strictEqual(engine.HARD_CAP_CALLS, 23);
    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(/newPenalty = 41/.test(server));
    assert.ok(/newPenalty = 29/.test(server));
    assert.ok(/newPenalty = 21/.test(server));
    assert.ok(/minimumBotShare/.test(server));
    assert.ok(/pullFinishCall/.test(server));
});

test('daily net loss of 600 ETB joins the 60% target pool on the Ethiopia day', () => {
    const now = Date.parse('2026-11-03T12:00:00Z');
    const today = engine.eatDayKey(now);
    const ctx = { allowBonusWin: false, activeCooldowns: {}, timeBans: {}, winHistory: {}, now };
    const seated = (phone, extra) => Object.assign({
        phone,
        isBot: false,
        hasDeposited: true,
        realBetAmount: 20,
        won: 10,
        depositTodayEtb: 0,
        totalDeposited: 100,
        totalWithdrawn: 0,
        netContribution: 100,
        roundsTodayWithoutWin: 0,
        winsToday: 0,
        dailyRealBets: 0,
        dailyWins: 0,
        eatDayKey: today
    }, extra);
    const under = seated('under', { dailyRealBets: 599, dailyWins: 0, totalWithdrawn: 5000, netContribution: 100 - 5000 });
    const exact = seated('exact', { dailyRealBets: 800, dailyWins: 200, totalWithdrawn: 9000, netContribution: 100 - 9000 });
    const ahead = seated('ahead', { dailyRealBets: 400, dailyWins: 900, totalDeposited: 100 });
    const whale = seated('whale', { depositTodayEtb: 2000, totalDeposited: 20000, totalWithdrawn: 0, netContribution: 20000, dailyRealBets: 50, dailyWins: 0 });
    const grinder = seated('grinder', { depositTodayEtb: 100, totalDeposited: 400, totalWithdrawn: 0, netContribution: 400, won: 0, roundsTodayWithoutWin: 8 });
    const cool = seated('cool', { dailyRealBets: 2000, dailyWins: 0, totalWithdrawn: 4000, netContribution: -3900 });
    const bonusStake = seated('bonusStake', { realBetAmount: 0, bonusBetAmount: 10, dailyRealBets: 1200, dailyWins: 0, totalWithdrawn: 2000, netContribution: -1900 });
    const neverDeposited = seated('neverDep', { hasDeposited: false, realBetAmount: 0, dailyRealBets: 0, dailyWins: 0, totalDeposited: 0, netContribution: 0 });
    const stale = seated('stale', { eatDayKey: '1999-01-01', dailyRealBets: 5000, dailyWins: 0, totalWithdrawn: 8000, netContribution: -7900 });
    const coolCtx = Object.assign({}, ctx, { activeCooldowns: { cool: 3 } });

    assert.strictEqual(engine.DAILY_NET_LOSS_TARGET_ETB, 600);
    assert.strictEqual(engine.dailyNetLossOf(under, ctx), 599);
    assert.strictEqual(engine.dailyNetLossOf(exact, ctx), 600);
    assert.strictEqual(engine.dailyNetLossOf(ahead, ctx), 400 - 900);
    assert.strictEqual(engine.meetsDailyLossTarget(under, ctx), false);
    assert.strictEqual(engine.meetsDailyLossTarget(exact, ctx), true);
    assert.strictEqual(engine.isLargeDepositor(under, ctx), false);
    assert.strictEqual(engine.isTargetPoolBaseEligible(under, ctx), true);
    assert.strictEqual(engine.isLargeDepositor(exact, ctx), true);
    assert.strictEqual(engine.isTargetPoolBaseEligible(exact, ctx), true);
    assert.strictEqual(engine.largeDepositorWeight(exact, ctx), 600);
    assert.strictEqual(engine.isLargeDepositor(cool, coolCtx), false);
    assert.strictEqual(engine.isTargetPoolBaseEligible(cool, coolCtx), false);
    assert.strictEqual(engine.winPriorityScore(cool, coolCtx), 0);
    assert.strictEqual(engine.isLargeDepositor(bonusStake, ctx), false);
    assert.strictEqual(engine.isTargetPoolBaseEligible(bonusStake, ctx), false);
    assert.strictEqual(engine.isLargeDepositor(neverDeposited, ctx), false);
    assert.strictEqual(engine.dailyNetLossOf(stale, ctx), 0);
    assert.strictEqual(engine.isLargeDepositor(stale, ctx), false);

    const rolled = engine.rolloverDailyLoss({ eatDayKey: today, dailyRealBets: 640, dailyWins: 40 }, now);
    assert.strictEqual(rolled.dailyRealBets, 640);
    assert.strictEqual(rolled.dailyWins, 40);
    const reset = engine.rolloverDailyLoss({ eatDayKey: '1999-01-01', dailyRealBets: 640, dailyWins: 40 }, now);
    assert.strictEqual(reset.eatDayKey, today);
    assert.strictEqual(reset.dailyRealBets, 0);
    assert.strictEqual(reset.dailyWins, 0);

    function scripted(seq) {
        let i = 0;
        return function () {
            const value = seq[i];
            i += 1;
            return value;
        };
    }
    const players = { exact, whale, grinder, cool, under };
    const lossSide = Object.assign({}, ctx, { rng: scripted([0.0, 0.0]) });
    assert.strictEqual(
        engine.pickPriorityWinnerPhone(['exact', 'whale', 'grinder', 'cool', 'under'], players, lossSide),
        'exact'
    );
    const smallSide = Object.assign({}, ctx, { rng: scripted([0.6]) });
    assert.strictEqual(
        engine.pickPriorityWinnerPhone(['exact', 'whale', 'grinder', 'cool', 'under'], players, smallSide),
        'grinder'
    );
    const heavier = seated('heavier', { dailyRealBets: 1500, dailyWins: 100, totalWithdrawn: 4000, netContribution: 100 - 4000 });
    const light = seated('light', { dailyRealBets: 700, dailyWins: 100, totalWithdrawn: 50, netContribution: 50 });
    assert.strictEqual(
        engine.pickPriorityWinnerPhone(['light', 'heavier'], { light, heavier }, Object.assign({}, ctx, { rng: scripted([0.99]) })),
        'heavier'
    );
    assert.strictEqual(engine.minimumBotShare(exact, ctx), 1);
    assert.strictEqual(engine.LARGE_GROUP_PROBABILITY, 0.6);

    const targets = engine.selectTargetCandidates(
        [exact, whale, grinder, cool],
        Object.assign({}, coolCtx, { rng: scripted([0.0, 0.0]) })
    );
    assert.deepStrictEqual(targets, ['exact']);

    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(/dailyRealBets: dailyRealBetsByPhone/.test(server));
    assert.ok(/dailyWins: dailyWinsByPhone/.test(server));
    assert.ok(/rolloverDailyLoss/.test(server));
    assert.ok(/stakeSplit\.realFromPlay/.test(server));
    assert.ok(/user\.dailyWins = Number\(\(\(Number\(user\.dailyWins\) \|\| 0\) \+ splitPrize\)\.toFixed\(2\)\)/.test(server));
    assert.ok(/finalTotalPrize \/ winners\.length/.test(server));
    assert.ok(/dropDeniedBonusWinners/.test(server));
    assert.ok(/depositTodayEtb: depositTodayByPhone/.test(server));
    assert.ok(/netContribution: netContributionByPhone/.test(server));
});

test('pending deposit receipt heuristics keep real slips and drop empty fakes', () => {
    const real = 'Dear customer you have received 1,500.00 ETB. FTABC12345 credited into your account.';
    const empty = '   ';
    const fake = 'hello 123';
    const outbound = 'You transferred 200 ETB FTXYZ99999 out of your account';
    assert.strictEqual(engine.isLegitimateDepositReceipt(real), true);
    assert.strictEqual(engine.isEmptySlip(empty), true);
    assert.strictEqual(engine.isLegitimateDepositReceipt(fake), false);
    assert.strictEqual(engine.isLegitimateDepositReceipt(outbound), false);
    assert.strictEqual(engine.shouldPreservePendingDeposit({ smsText: fake, txRef: 'FTABC12345' }, ['FTABC12345']), true);
    assert.strictEqual(engine.shouldPreservePendingDeposit({ smsText: fake, txRef: 'NOPE' }, []), false);
});

test('admin panel exposes ramp minutes, season controls, and pending clear-all', () => {
    const fs = require('fs');
    const path = require('path');
    const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(/id="bot-ramp-minutes"/.test(admin));
    assert.ok(/Reset \/ Clear/.test(admin));
    assert.ok(/Start Season/.test(admin));
    assert.ok(/ገቢ አድርግ/.test(admin));
    assert.ok(/clearInvalidPendingDeposits/.test(admin));
    assert.ok(/\/api\/admin\/reset-leaderboard/.test(server));
    assert.ok(/\/api\/admin\/start-season/.test(server));
    assert.ok(/\/api\/admin\/disburse-prizes/.test(server));
    assert.ok(/TOURNAMENT_PRIZE/.test(server));
    assert.ok(/\/api\/admin\/clear-pending-deposits/.test(server));
    assert.ok(/Delete Last Claim Announcement/.test(admin));
    assert.ok(/⏳ Cooldown Users/.test(admin));
    assert.ok(/\/api\/admin\/delete-claim-announcement/.test(server));
    assert.ok(/\/api\/admin\/cooldown-users/.test(server));
    assert.ok(/\/api\/admin\/cooldown-action/.test(server));
    assert.ok(/pickPriorityWinnerPhone/.test(server));
    assert.ok(/excludeRestrictedWinners/.test(server));
});

test('tournament season lasts exactly 7 days and ranks by cards played', () => {
    const start = Date.UTC(2026, 8, 17, 12, 34, 56);
    const live = engine.seasonState(start + 1000, {
        tournamentSeasonId: 'S1',
        tournamentStartedAt: new Date(start),
        tournamentStatus: 'active'
    });
    assert.strictEqual(live.active, true);
    assert.strictEqual(live.endsAt.getTime() - live.startedAt.getTime(), 7 * 24 * 60 * 60 * 1000);
    const frozen = engine.seasonState(live.endsAt.getTime(), {
        tournamentSeasonId: 'S1',
        tournamentStartedAt: new Date(start),
        tournamentEndsAt: live.endsAt,
        tournamentStatus: 'active'
    });
    assert.strictEqual(frozen.active, false);
    assert.strictEqual(frozen.frozen, true);
    const ranked = engine.shapeCardsLeaderboard([
        { phone: '0912', name: 'Kebede', seasonCardsPlayed: 120 },
        { phone: '0911', name: 'Abebe', seasonCardsPlayed: 450 },
        { phone: '0913', name: 'Chala', seasonCardsPlayed: 0 }
    ]);
    assert.deepStrictEqual(ranked.map((row) => row.phone), ['0911', '0912']);
    assert.strictEqual(ranked[0].cardsPlayed, 450);
    assert.strictEqual(ranked[0].rank, 1);
    const kept = engine.ticketsForActiveRound([
        { id: 4, roundId: 10 },
        { id: 9, roundId: 11 }
    ], 11);
    assert.deepStrictEqual(kept.map((t) => t.id), [9]);
    assert.strictEqual(engine.rejectEvalForRound(10, 11), true);
    assert.strictEqual(engine.rejectEvalForRound(11, 11), false);
    const html = require('fs').readFileSync(require('path').join(__dirname, '../public/index.html'), 'utf8');
    assert.ok(/function adoptActiveRound/.test(html));
    assert.ok(/addEventListener\('online'/.test(html));
    assert.ok(/visibilitychange/.test(html));
    assert.ok(/Cards Played/.test(html));
});

test('one card index belongs to one holder per round', () => {
    assert.strictEqual(engine.TOTAL_CARDS, 700);
    assert.strictEqual(engine.DEFAULT_CARD_COUNT, 700);
    assert.strictEqual(engine.defaultCardOrder().length, 700);
    const ledger = engine.createRoundCardLedger();
    assert.strictEqual(ledger.tryReserve(9, 506, 'bot-a').ok, true);
    const clash = ledger.tryReserve(9, 506, 'bot-b');
    assert.strictEqual(clash.ok, false);
    assert.strictEqual(clash.reason, 'TAKEN');
    assert.strictEqual(ledger.tryReserve(9, 506, 'bot-a').ok, true);
    assert.strictEqual(ledger.ownerOf(9, 506), 'bot-a');
    assert.strictEqual(ledger.tryReserve(9, 700, 'player').ok, true);
    assert.strictEqual(ledger.tryReserve(9, 701, 'player').ok, false);
    ledger.release(9, 506, 'bot-b');
    assert.strictEqual(ledger.isSelected(9, 506), true);
    ledger.release(9, [506], 'bot-a');
    assert.strictEqual(ledger.isSelected(9, 506), false);
    assert.strictEqual(ledger.tryReserve(8, 506, 'bot-b').ok, true);
});

test('a card grid stays frozen after the first assignment for that round', () => {
    const ledger = engine.createRoundCardLedger();
    const grid = engine.generateFixedCard(151, 5);
    const frozen = ledger.freezeGrid(4, 151, grid);
    frozen[0][0] = 1;
    const rewritten = engine.generateFixedCard(151, 99);
    assert.notDeepStrictEqual(rewritten, grid);
    const kept = ledger.freezeGrid(4, 151, rewritten);
    assert.deepStrictEqual(kept, grid);
    assert.deepStrictEqual(ledger.getGrid(4, 151), grid);
    kept[2][0] = 99;
    assert.deepStrictEqual(ledger.getGrid(4, 151), grid);
});

test('duplicate holders of one winning card do not each take a share', () => {
    const winners = engine.dedupeWinnersByCard([
        { player: { phone: 'a', isBot: false }, ticket: { id: 506, grid: [[1]] } },
        { player: { phone: 'b', isBot: true }, ticket: { id: '506', grid: [[9]] } },
        { player: { phone: 'c', isBot: false }, ticket: { id: 12, grid: [[2]] } }
    ]);
    assert.deepStrictEqual(winners.map((w) => w.player.phone), ['a', 'c']);
    const grid = engine.generateFixedCard(151);
    const claims = [{
        claimId: 'p:151',
        player: { phone: 'p', isBot: false, name: 'P' },
        ticket: { id: 151, grid }
    }, {
        claimId: 'bot:151',
        player: { phone: 'bot', isBot: true, name: 'Bot' },
        ticket: { id: 151, grid: engine.generateFixedCard(151, 3) }
    }];
    const resolved = engine.resolveConcurrentClaims(claims, {
        calledNumbers: [1, 2, 3, 4, 5],
        currentTurn: 15,
        numToCall: 5,
        forceWinner: 'real',
        botPlayers: [],
        helpers: {
            makeNaturalBotTicket: (tix) => { tix.grid = [[99]]; },
            getUnusedFakeTicketId: () => 151,
            generateFixedCard: engine.generateFixedCard
        }
    });
    const cardIds = resolved.winners.map((w) => Number(w.ticket.id));
    assert.deepStrictEqual(cardIds, [151]);
    assert.deepStrictEqual(resolved.winners[0].ticket.grid, grid);
});

function openBotGrid() {
    return [
        [11, 26, 41, 56, 71],
        [12, 27, 42, 57, 72],
        [13, 28, 'FREE', 58, 73],
        [14, 29, 44, 59, 74],
        [15, 30, 45, 60, 75]
    ];
}

test('closeBotKartela does not paste a called row onto a purchased card', () => {
    const grid = [
        [10, 2, 3, 4, 5],
        [21, 17, 18, 19, 20],
        [38, 32, 'FREE', 34, 35],
        [57, 47, 48, 49, 50],
        [68, 62, 63, 64, 65]
    ];
    const snapshot = JSON.parse(JSON.stringify(grid));
    const called = [42, 7, 30, 47, 60, 64, 36, 37, 51, 65, 22, 57, 23, 66, 32, 67, 8, 5, 18, 45, 24];
    const closed = engine.closeBotKartela(grid, called, 24);
    assert.strictEqual(closed, grid);
    assert.deepStrictEqual(grid, snapshot);
    assert.deepStrictEqual(
        [closed[0][0], closed[1][0], closed[2][0], closed[3][0], closed[4][0]],
        [10, 21, 38, 57, 68]
    );
    assert.ok(engine.gridColumnsAreUnique(closed));
    assert.strictEqual(engine.checkBingo(closed, called), false);
    const again = engine.closeBotKartela(closed, called, 24);
    assert.strictEqual(again, closed);
    assert.deepStrictEqual(again, snapshot);
});

test('closeBotKartela leaves an already closed kartela untouched', () => {
    const grid = rowWinGrid();
    const closed = engine.closeBotKartela(grid, [1, 2, 3, 4, 5], 5);
    assert.strictEqual(closed, grid);
});

test('split win keeps every bot kartela on its dealt numbers even if the helper no-ops', () => {
    const winGrid = rowWinGrid();
    const human = { phone: 'p', isBot: false, name: 'P', ticketsData: [{ id: 1, grid: winGrid }] };
    const bots = [];
    for (let i = 0; i < 4; i++) {
        const grid = openBotGrid();
        bots.push({
            name: 'Bot' + i,
            phone: 'bot' + i,
            isBot: true,
            ticketsData: [{ id: 210 + i, grid }]
        });
    }
    const claims = [{
        claimId: 'p:1',
        player: human,
        ticket: human.ticketsData[0]
    }];
    const called = [1, 2, 3, 4];
    const result = engine.resolveConcurrentClaims(claims, {
        calledNumbers: called,
        currentTurn: 5,
        numToCall: 5,
        botPlayers: bots,
        helpers: {
            makeNaturalBotTicket: (tix) => { tix.grid = [[7, 24, 42, 47, 64]]; },
            getUnusedFakeTicketId: () => null,
            generateFixedCard: engine.generateFixedCard
        }
    });
    const botWinners = result.winners.filter((w) => w.player.isBot);
    assert.strictEqual(botWinners.length, 4);
    const full = called.concat([5]);
    botWinners.forEach((w) => {
        assert.deepStrictEqual(w.ticket.grid, openBotGrid());
        assert.deepStrictEqual(w.player.ticketsData[0].grid, openBotGrid());
        assert.ok(engine.gridColumnsAreUnique(w.ticket.grid));
        assert.strictEqual(engine.checkBingo(w.ticket.grid, full), false);
    });
    assert.strictEqual(result.winners[0].player.phone, 'p');
    assert.deepStrictEqual(result.winners[0].ticket.grid, winGrid);
    assert.deepStrictEqual(human.ticketsData[0].grid, winGrid);
});

test('called numbers are marked on bot and human cards without changing the assigned numbers', () => {
    const botCard = openBotGrid();
    const humanCard = rowWinGrid();
    const bot = { phone: 'bot', isBot: true, ticketsData: [{ id: 88, grid: botCard }] };
    const human = { phone: 'human', isBot: false, ticketsData: [{ id: 12, grid: humanCard }] };
    const players = { bot, human };
    const snapshot = JSON.parse(JSON.stringify(botCard));

    engine.markCalledNumbersOnPlayers(players, [11, 2]);
    engine.markCalledNumbersOnPlayers(players, [11, 2, 16]);

    assert.deepStrictEqual(bot.ticketsData[0].grid, snapshot);
    assert.strictEqual(bot.ticketsData[0].marks[0][0], 1, 'bot cell 11 was not marked');
    assert.strictEqual(human.ticketsData[0].marks[1][0], 1, 'human cell 2 was not marked');
    assert.strictEqual(bot.ticketsData[0].marks[1][0], 0, 'bot card marked a number it does not hold');
    assert.strictEqual(bot.ticketsData[0].marks, bot.ticketsData[0].marksObj);
    assert.strictEqual(bot.ticketsData[0].isClosed, undefined);
    assert.notStrictEqual(engine.closeWinningTicket(bot.ticketsData[0], [11, 16, 31, 46, 61]), true);
    assert.strictEqual(bot.ticketsData[0].isClosed, false);
    assert.notStrictEqual(bot.ticketsData[0].status, 'won');
    assert.deepStrictEqual(bot.ticketsData[0].grid, snapshot);
});

test('a bot card closes only when its original numbers complete a called pattern', () => {
    const grid = rowWinGrid();
    const snapshot = JSON.parse(JSON.stringify(grid));
    const ticket = { id: 12, grid, status: 'active', isClosed: false };
    assert.strictEqual(engine.closeWinningTicket(ticket, [1, 2, 3, 4]), false);
    assert.strictEqual(ticket.isClosed, false);
    assert.strictEqual(ticket.status, 'active');

    assert.strictEqual(engine.closeWinningTicket(ticket, [1, 2, 3, 4, 5]), true);
    assert.strictEqual(ticket.isClosed, true);
    assert.strictEqual(ticket.status, 'won');
    assert.deepStrictEqual(ticket.grid, snapshot);
    assert.strictEqual(ticket.marks[0][0], 1);
    assert.strictEqual(ticket.marks[4][0], 1);
    assert.strictEqual(ticket.marks[0][1], 0, 'an uncalled number on the card must stay unmarked');

    const dabbed = { id: 13, grid: rowWinGrid(), marks: engine.blankMarks().map((col) => col.map(() => 1)) };
    assert.strictEqual(engine.markedCardCompletes(dabbed, []), false, 'marks alone cannot complete a card');
});

test('history refuses a duplicate-column grid and keeps the dealt card', () => {
    const dealt = [
        [10, 2, 3, 4, 5],
        [21, 17, 18, 19, 20],
        [38, 32, 'FREE', 34, 35],
        [57, 47, 48, 49, 50],
        [68, 62, 63, 64, 65]
    ];
    const forged = JSON.parse(JSON.stringify(dealt));
    forged[0][0] = 7;
    forged[1][0] = 24;
    forged[2][0] = 42;
    forged[3][0] = 47;
    forged[4][0] = 64;
    assert.strictEqual(engine.gridColumnsAreUnique(dealt), true);
    assert.strictEqual(engine.gridColumnsAreUnique(forged), false);
    const ticket = { id: 436, grid: forged };
    assert.strictEqual(engine.playedGridForHistory(ticket, dealt), dealt);
    assert.strictEqual(engine.playedGridForHistory({ id: 436, grid: forged }, forged), null);
    assert.strictEqual(engine.playedGridForHistory(ticket, null), null);
});

test('admin snapshots keep the assigned bot grid and the closed mark state', () => {
    const locked = openBotGrid();
    const called = [1, 2, 3, 4, 5];
    const winner = { id: 88, grid: rowWinGrid(), status: 'active', isClosed: false };
    assert.strictEqual(engine.closeWinningTicket(winner, called), true);
    const players = [{
        phone: 'bot629',
        name: 'Bot',
        isBot: true,
        ticketsData: [{ id: 88, grid: rowWinGrid(), marks: winner.marks, isClosed: true, status: 'won' }]
    }];
    const entries = [{
        gameId: 42,
        phone: 'bot629',
        name: 'Bot',
        isBot: true,
        ticketId: 88,
        status: 'won',
        isClosed: true,
        grid: locked
    }];
    const game = { gameId: 42, ticketId: '88', playersData: players };
    engine.applyCardSnapshots(game, entries);
    assert.deepStrictEqual(game.playersData[0].ticketsData[0].grid, locked);
    assert.strictEqual(game.playersData[0].ticketsData[0].isClosed, true);
    assert.strictEqual(game.playersData[0].ticketsData[0].status, 'won');
    assert.ok(game.playersData[0].ticketsData[0].marks);

    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(server.includes('closeWinningTicket'), 'authentic winners must be closed with their purchased numbers');
    assert.ok(server.includes('chooseMixedCall'), 'mixed draws must go through the shared-ball picker');
    assert.ok(server.includes('claimSyntheticBot'), 'the vault fallback must still be able to close a bot share');
    const html = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    assert.ok(html.includes('CLOSED / WON'));
    assert.ok(html.includes('data-ticket-status'));
    assert.ok(html.includes('function adminCellMarked'));
});

test('bot kartela close stays synchronous and does not place a called number', () => {
    const called = [1, 16, 31, 46, 2, 17, 32, 47, 3, 18, 33, 48];
    for (let n = 61; n <= 75; n++) {
        const grid = openBotGrid();
        const snapshot = JSON.parse(JSON.stringify(grid));
        const started = Date.now();
        const closed = engine.closeBotKartela(grid, called, n);
        assert.ok(Date.now() - started < 50, 'close hung on ball ' + n);
        assert.strictEqual(closed, grid);
        assert.deepStrictEqual(closed, snapshot);
        assert.ok(engine.gridColumnsAreUnique(closed));
        assert.strictEqual(engine.checkBingo(closed, called.concat([n])), false);
    }
});

test('authentic shared ball closes the purchased user and bot cards without rewriting them', () => {
    const realGrid = [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 'FREE', 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65]
    ];
    const botGrid = [
        [2, 17, 33, 47, 61],
        [3, 18, 34, 48, 62],
        [4, 19, 'FREE', 49, 63],
        [5, 20, 35, 50, 64],
        [6, 21, 36, 51, 65]
    ];
    const extraGrid = [
        [8, 23, 38, 53, 61],
        [9, 24, 39, 54, 69],
        [10, 25, 'FREE', 55, 70],
        [11, 26, 40, 56, 71],
        [12, 27, 41, 57, 72]
    ];
    const realSnap = JSON.parse(JSON.stringify(realGrid));
    const botSnap = JSON.parse(JSON.stringify(botGrid));
    const called = [1, 16, 31, 46, 2, 17, 33, 47];
    const real = { isBot: false, phone: 'real', ticketsData: [{ id: 12, grid: realGrid }] };
    const bot = { isBot: true, phone: 'bot', ticketsData: [{ id: 88, grid: botGrid }] };
    const extra = { isBot: true, phone: 'extra', ticketsData: [{ id: 89, grid: extraGrid }] };
    const exact = engine.pickExactSharedOneAway([real], [bot], called, {
        pool: [61, 58, 6],
        botCount: 1,
        others: []
    });
    assert.strictEqual(exact, 61);
    const calledExtra = called.concat([8, 23, 38, 53]);
    assert.strictEqual(engine.pickExactSharedOneAway([real], [bot, extra], calledExtra, {
        pool: [61],
        botCount: 1
    }), 61, 'extra bots beyond the aimed count still share the ball');
    assert.strictEqual(engine.pickExactSharedOneAway([real], [bot, extra], calledExtra, {
        pool: [61],
        botCount: 2
    }), 61);
    const secondHuman = { isBot: false, phone: 'other', ticketsData: [{ id: 13, grid: JSON.parse(JSON.stringify(realGrid)) }] };
    assert.strictEqual(engine.pickExactSharedOneAway([real], [bot], called, {
        pool: [61],
        botCount: 1,
        others: [secondHuman]
    }), 61, 'a second eligible human on the same ball is a split');
    assert.strictEqual(engine.pickExactSharedOneAway([real], [], called, {
        pool: [61],
        botCount: 1,
        others: [secondHuman]
    }), 61, 'a human split is kept when the bot count does not match');

    const full = called.concat([61]);
    assert.strictEqual(engine.closeWinningTicket(real.ticketsData[0], full), true);
    assert.strictEqual(engine.closeWinningTicket(bot.ticketsData[0], full), true);
    assert.deepStrictEqual(real.ticketsData[0].grid, realSnap);
    assert.deepStrictEqual(bot.ticketsData[0].grid, botSnap);
    assert.strictEqual(real.ticketsData[0].isClosed, true);
    assert.strictEqual(bot.ticketsData[0].isClosed, true);
    assert.strictEqual(bot.ticketsData[0].status, 'won');
    assert.strictEqual(bot.ticketsData[0].marks[0][4], 1);
    assert.strictEqual(engine.closeWinningTicket(extra.ticketsData[0], full), false);
});

test('shared close accepts 3 to 5 bots and still prefers the aimed count', () => {
    const called = [1, 16, 31, 46, 2, 17, 32, 47];
    const real = {
        isBot: false,
        phone: 'real',
        ticketsData: [{ id: 1, grid: [
            [1, 16, 31, 46, 61],
            [2, 17, 32, 47, 62],
            [3, 18, 'FREE', 48, 63],
            [4, 19, 34, 49, 64],
            [5, 20, 35, 50, 65]
        ] }]
    };
    function botCard(id, closer, other) {
        return {
            isBot: true,
            phone: 'bot-' + id,
            ticketsData: [{ id: id, grid: [
                [1, 16, 31, 46, closer],
                [other, 17, 33, 48, 66],
                [3, 18, 'FREE', 49, 67],
                [4, 19, 34, 50, 68],
                [5, 20, 35, 51, 69]
            ] }]
        };
    }
    const oneBot = botCard(11, 61, 8);
    const many = [botCard(21, 62, 9), botCard(22, 62, 10), botCard(23, 62, 11), botCard(24, 62, 12)];
    assert.strictEqual(engine.pickExactSharedOneAway([real], many, called, {
        pool: [62],
        botCount: 1
    }), 62, 'four bots share when that is the only closing ball');
    assert.strictEqual(engine.pickExactSharedOneAway([real], [oneBot].concat(many), called, {
        pool: [61, 62],
        botCount: 1
    }), 62, 'bots that finish together are a shared close, not a solo bot');
    assert.strictEqual(engine.pickExactSharedOneAway([real], many.concat([botCard(25, 62, 13)]), called, {
        pool: [62],
        botCount: 5
    }), 62, 'five bots share when the aim is five');
});

test('bot-only close groups every bot on the same ball up to five', () => {
    const called = [1, 16, 31, 46];
    function botCard(id, closer) {
        return {
            isBot: true,
            phone: 'bot-' + id,
            ticketsData: [{ id: id, grid: [
                [1, 16, 31, 46, closer],
                [3, 18, 33, 48, 66],
                [4, 19, 'FREE', 49, 67],
                [5, 20, 34, 50, 68],
                [6, 21, 35, 51, 69]
            ] }]
        };
    }
    const solo = botCard(1, 58);
    const group = [2, 3, 4, 5, 6].map((id) => botCard(id, 61));
    const choice = engine.chooseDrawnBall({
        currentTurn: 18,
        finishCall: 18,
        forceWinner: 'bots',
        botCount: 0,
        called: called,
        pool: [58, 61, 6, 7],
        targetPlayers: [],
        botPlayers: [solo].concat(group),
        others: [],
        completing: [58, 61],
        botCompleting: [58, 61],
        userCompleting: [],
        fourCorner: [],
        blockedCompleting: [],
        rng: function () { return 0; }
    });
    assert.strictEqual(choice.num, 61);
    assert.strictEqual(choice.plan, 'shared');
    const six = [7, 8, 9, 10, 11, 12].map((id) => botCard(id, 61));
    const capped = engine.chooseDrawnBall({
        currentTurn: 18,
        finishCall: 18,
        forceWinner: 'bots',
        botCount: 0,
        called: called,
        pool: [61, 6],
        targetPlayers: [],
        botPlayers: six,
        others: [],
        completing: [61],
        botCompleting: [61],
        userCompleting: [],
        fourCorner: [],
        blockedCompleting: [],
        rng: function () { return 0; }
    });
    assert.strictEqual(capped.num, 61);
    assert.strictEqual(capped.plan, 'shared');
    const alone = engine.chooseDrawnBall({
        currentTurn: 18,
        finishCall: 18,
        forceWinner: 'bots',
        botCount: 0,
        called: called,
        pool: [58, 6],
        targetPlayers: [],
        botPlayers: [solo],
        others: [],
        completing: [58],
        botCompleting: [58],
        userCompleting: [],
        fourCorner: [],
        blockedCompleting: [],
        rng: function () { return 0; }
    });
    assert.strictEqual(alone.num, 58);
    assert.strictEqual(alone.plan, 'bot');
});

test('a bot-only close occasionally pays one bot and otherwise keeps the split', () => {
    const called = [1, 16, 31, 46];
    function botCard(id, closer) {
        return {
            isBot: true,
            phone: 'bot-' + id,
            ticketsData: [{ id: id, grid: [
                [1, 16, 31, 46, closer],
                [3, 18, 33, 48, 66],
                [4, 19, 'FREE', 49, 67],
                [5, 20, 34, 50, 68],
                [6, 21, 35, 51, 69]
            ] }]
        };
    }
    const solo = botCard(1, 58);
    const group = [2, 3, 4, 5, 6].map((id) => botCard(id, 61));
    const players = [solo].concat(group);
    const base = {
        currentTurn: 18,
        finishCall: 18,
        forceWinner: 'bots',
        botCount: 0,
        called: called,
        pool: [58, 61, 6, 7],
        targetPlayers: [],
        botPlayers: players,
        others: [],
        completing: [58, 61],
        botCompleting: [58, 61],
        userCompleting: [],
        fourCorner: [],
        blockedCompleting: [],
        rng: function () { return 0; }
    };
    const split = engine.chooseDrawnBall(Object.assign({}, base, { soloBotChance: 0 }));
    assert.strictEqual(split.num, 61);
    assert.strictEqual(split.plan, 'shared');
    const soloClose = engine.chooseDrawnBall(Object.assign({}, base, { soloBotChance: 1 }));
    assert.strictEqual(soloClose.num, 58);
    assert.strictEqual(soloClose.plan, 'bot');
    const indexed = engine.chooseDrawnBall(Object.assign({}, base, {
        soloBotChance: 1,
        lineIndex: engine.buildRoundLineIndex(players)
    }));
    assert.strictEqual(indexed.num, 58);
    assert.strictEqual(indexed.plan, 'bot');
    const missedRoll = engine.chooseDrawnBall(Object.assign({}, base, {
        soloBotChance: 0.15,
        rng: function () { return 0.9; }
    }));
    assert.strictEqual(missedRoll.num, 61);
    assert.strictEqual(missedRoll.plan, 'shared');
    const human = {
        isBot: false,
        phone: 'real',
        ticketsData: [{ id: 90, grid: [
            [1, 16, 31, 46, 58],
            [7, 17, 33, 48, 66],
            [8, 18, 'FREE', 49, 67],
            [9, 19, 34, 50, 68],
            [10, 20, 35, 51, 69]
        ] }]
    };
    const blockedSolo = engine.chooseDrawnBall(Object.assign({}, base, {
        soloBotChance: 1,
        targetPlayers: [human],
        userCompleting: [58]
    }));
    assert.strictEqual(blockedSolo.num, 61);
    assert.strictEqual(blockedSolo.plan, 'shared');
    const midRound = engine.chooseDrawnBall(Object.assign({}, base, {
        currentTurn: 10,
        finishCall: 18,
        soloBotChance: 1
    }));
    assert.notStrictEqual(midRound.plan, 'bot');
    assert.notStrictEqual(midRound.num, 58);
    assert.notStrictEqual(midRound.num, 61);
    const beforeSchedule = engine.chooseDrawnBall(Object.assign({}, base, {
        currentTurn: 16,
        finishCall: 18,
        soloBotChance: 1
    }));
    assert.notStrictEqual(beforeSchedule.plan, 'bot');
    assert.notStrictEqual(beforeSchedule.num, 58);
});

test('mixed ceiling lets a covered vault win alone and a tight vault request the bot share', () => {
    const realGrid = [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 'FREE', 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65]
    ];
    const botGrid = [
        [7, 17, 33, 47, 66],
        [8, 18, 34, 48, 67],
        [9, 19, 'FREE', 49, 68],
        [10, 20, 35, 50, 69],
        [11, 21, 36, 51, 70]
    ];
    const called = [1, 16, 31, 46];
    const real = { isBot: false, hasDeposited: true, phone: 'dep', ticketsData: [{ id: 12, grid: realGrid }] };
    const bot = { isBot: true, phone: 'bot', ticketsData: [{ id: 88, grid: botGrid }] };
    const base = {
        called,
        pool: [61, 7, 70],
        targetPlayers: [real],
        botPlayers: [bot],
        others: [],
        botCount: 1,
        mustWinNow: true,
        currentTurn: 26,
        fullPrize: 100,
        depositor: true,
        completing: [61],
        botCompleting: [],
        fourCorner: [],
        blockedCompleting: []
    };
    const solo = engine.chooseMixedCall(Object.assign({}, base, { vaultTwo: 150, virtualPool: 0 }));
    assert.strictEqual(solo.plan, 'solo');
    assert.strictEqual(solo.num, 61);
    const tight = engine.chooseMixedCall(Object.assign({}, base, { vaultTwo: 40, virtualPool: 1000 }));
    assert.strictEqual(tight.plan, 'synthetic');
    assert.strictEqual(tight.num, 61);
    const other = { isBot: false, phone: 'other', ticketsData: [{ id: 13, grid: realGrid }] };
    const crowded = engine.chooseMixedCall(Object.assign({}, base, {
        vaultTwo: 150,
        others: [other],
        pool: [61]
    }));
    assert.strictEqual(crowded.plan, 'shared');
    assert.strictEqual(crowded.num, 61);
    const early = engine.chooseMixedCall(Object.assign({}, base, {
        currentTurn: 16,
        mustWinNow: true,
        vaultTwo: 40,
        pool: [7, 61],
        completing: [61]
    }));
    assert.strictEqual(early.plan, 'build');
    assert.strictEqual(early.num, 7);
});

test('a mixed round with no safe ball before the ceiling is an emergency split', () => {
    const choice = engine.chooseMixedCall({
        called: [1, 2, 3],
        pool: [61],
        targetPlayers: [{ ticketsData: [{ id: 1, grid: rowWinGrid() }] }],
        botPlayers: [{ ticketsData: [{ id: 2, grid: openBotGrid() }] }],
        botCount: 1,
        mustWinNow: false,
        currentTurn: 10,
        completing: [61],
        fourCorner: [],
        blockedCompleting: []
    });
    assert.strictEqual(choice.plan, 'emergency');
    assert.strictEqual(choice.num, 61);
});

test('emergency vault settlement keeps the deficit and the normal path still clamps', () => {
    const start = { virtualPrizePool: 5, vaultTwoBalance: 10, vaultThreeBalance: 15 };
    const normal = engine.settleWinnerVault(start, {
        realMoneyOut: 40,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 1,
        totalWinners: 2,
        allowNegative: false
    });
    assert.strictEqual(normal.charged, 'vaultThreeBalance');
    assert.strictEqual(normal.balances.vaultThreeBalance, 0);
    assert.strictEqual(start.vaultThreeBalance, 15);

    const emergency = engine.settleWinnerVault(start, {
        realMoneyOut: 40,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 1,
        totalWinners: 2,
        allowNegative: true
    });
    assert.strictEqual(emergency.charged, 'vaultThreeBalance');
    assert.strictEqual(emergency.balances.vaultThreeBalance, -25);
    assert.strictEqual(emergency.balances.vaultTwoBalance, 10);
    assert.strictEqual(emergency.balances.virtualPrizePool, 5);

    const soloShort = engine.settleWinnerVault(start, {
        realMoneyOut: 40,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 0,
        totalWinners: 1,
        allowNegative: false
    });
    assert.strictEqual(soloShort.charged, 'virtualPrizePool');
    assert.strictEqual(soloShort.balances.vaultTwoBalance, 10);
    const soloEmergency = engine.settleWinnerVault(start, {
        realMoneyOut: 40,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 0,
        totalWinners: 1,
        allowNegative: true
    });
    assert.strictEqual(soloEmergency.charged, 'vaultTwoBalance');
    assert.strictEqual(soloEmergency.balances.vaultTwoBalance, -30);
});

test('winner cap keeps every real card and never pays more than five with injected bots', () => {
    const reals = [1, 2].map((id) => ({ player: { isBot: false, phone: 'p' + id }, ticket: { id } }));
    const bots = [3, 4, 5, 6].map((id) => ({ player: { isBot: true, phone: 'b' + id }, ticket: { id } }));
    const capped = engine.capWinnerList(reals.concat(bots), 5);
    assert.strictEqual(capped.length, 5);
    assert.strictEqual(capped.filter((w) => !w.player.isBot).length, 2);
    const manyReals = [1, 2, 3, 4, 5, 6].map((id) => ({ player: { isBot: false }, ticket: { id } }));
    assert.strictEqual(engine.capWinnerList(manyReals, 5).length, 6);
});

test('a committed player missing from a 5-seat room is paid and a quiet joiner stays on the roster', () => {
    const called = [1, 2, 3, 4, 5];
    const win = rowWinGrid();
    const quiet = [
        [10, 16, 31, 46, 61],
        [11, 17, 32, 47, 62],
        [12, 18, 'FREE', 48, 63],
        [13, 19, 34, 49, 64],
        [14, 20, 35, 50, 65]
    ];
    function seat(phone, id, grid, isBot) {
        return { phone: phone, isBot: !!isBot, ticketsData: [{ id: id, grid: grid.map((col) => col.slice()) }] };
    }
    const active = {
        u1: seat('u1', 1, win, false),
        u2: seat('u2', 2, win, false),
        b1: seat('b1', 3, win, true),
        b2: seat('b2', 4, win, true),
        b3: seat('b3', 5, win, true)
    };
    const indexed = engine.collectSameBallWinners(active, [], called);
    assert.strictEqual(indexed.length, 5, 'indexed room filled all 5 seats');
    const entries = [
        { phone: 'u3', name: 'Late', isBot: false, ticketId: 6, grid: win.map((col) => col.slice()), status: 'active' },
        { phone: 'u4', name: 'Quiet', isBot: false, ticketId: 7, grid: quiet, status: 'active' }
    ];
    const roster = engine.snapshotPlayers(active);
    engine.hydratePlayersFromEntries(roster, entries);
    roster.u3.hasDeposited = true;
    roster.u3.totalDeposited = 100;
    roster.u3.bonusBetAmount = 0;
    roster.u4.hasDeposited = true;
    roster.u4.totalDeposited = 50;
    roster.u4.bonusBetAmount = 0;
    const paid = engine.absorbMissedRealWinners(indexed, roster, entries, called);
    const realPaid = paid.filter((w) => !w.player.isBot).map((w) => w.player.phone);
    assert.ok(realPaid.indexOf('u1') !== -1);
    assert.ok(realPaid.indexOf('u2') !== -1);
    assert.ok(realPaid.indexOf('u3') !== -1, 'committed same-ball user was skipped');
    assert.strictEqual(realPaid.indexOf('u4'), -1);
    assert.strictEqual(paid.filter((w) => w.player.isBot).length, 2);
    assert.strictEqual(paid.length, 5);
    const outcome = engine.finalizeBingoRound(roster, entries, called, { totalPrize: 100 });
    assert.ok(outcome.history.participantPhones.indexOf('u3') !== -1);
    assert.ok(outcome.history.participantPhones.indexOf('u4') !== -1, 'quiet joiner was not marked win or loss');
    assert.ok(engine.checkBingo(quiet, called) === false);
});

test('a full room pays the missed depositor an even share, keeps every card, and uses the admin bonus chance', () => {
    const prize = 100;
    const called = [1, 2, 3, 4, 5];
    const win = rowWinGrid();
    const quietGrid = [
        [10, 16, 31, 46, 61],
        [11, 17, 32, 47, 62],
        [12, 18, 'FREE', 48, 63],
        [13, 19, 34, 49, 64],
        [14, 20, 35, 50, 65]
    ];
    function human(phone, id, grid, extra) {
        return Object.assign({
            phone: phone,
            name: phone,
            isBot: false,
            hasDeposited: true,
            totalDeposited: 100,
            bonusBetAmount: 0,
            realBetAmount: 10,
            ticketsData: [{ id: id, grid: grid.map((col) => col.slice()) }]
        }, extra || {});
    }
    const active = {
        u1: human('u1', 1, win),
        u2: human('u2', 2, win),
        b1: Object.assign(human('b1', 3, win), { isBot: true }),
        b2: Object.assign(human('b2', 4, win), { isBot: true }),
        b3: Object.assign(human('b3', 5, win), { isBot: true })
    };
    const indexed = engine.collectSameBallWinners(active, [], called);
    assert.strictEqual(indexed.length, 5, 'indexed room is already full');
    const entries = [
        { phone: 'late', name: 'Late', isBot: false, ticketId: 6, grid: win.map((col) => col.slice()), status: 'active', hasDeposited: true, totalDeposited: 80, bonusBetAmount: 0, realBetAmount: 10 },
        { phone: 'quiet', name: 'Quiet', isBot: false, ticketId: 7, grid: quietGrid.map((col) => col.slice()), status: 'active', hasDeposited: true, totalDeposited: 40, bonusBetAmount: 0, realBetAmount: 10 },
        { phone: 'quiet', name: 'Quiet', isBot: false, ticketId: 9, grid: quietGrid.map((col) => col.slice()), status: 'active', hasDeposited: true, totalDeposited: 40, bonusBetAmount: 0, realBetAmount: 10 },
        { phone: 'bonus', name: 'Bonus', isBot: false, ticketId: 8, grid: win.map((col) => col.slice()), status: 'active', hasDeposited: true, totalDeposited: 20, bonusBetAmount: 10, realBetAmount: 0 }
    ];
    function rosterFrom(list) {
        const snap = engine.snapshotPlayers(active);
        engine.hydratePlayersFromEntries(snap, list, (phone, tickets, phoneEntries) => {
            const sample = (phoneEntries && phoneEntries[0]) || {};
            const seat = {
                phone: phone,
                name: sample.name || phone,
                isBot: !!sample.isBot,
                ticketsData: tickets,
                tickets: tickets.length,
                hasDeposited: !!sample.hasDeposited,
                bonusBetAmount: Number(sample.bonusBetAmount) || 0,
                realBetAmount: Number(sample.realBetAmount) || 0
            };
            if (sample.totalDeposited != null && sample.totalDeposited !== '') seat.totalDeposited = Number(sample.totalDeposited) || 0;
            return seat;
        });
        return snap;
    }
    function cardIds(roster) {
        const ids = [];
        Object.keys(roster).forEach((phone) => {
            (roster[phone].ticketsData || []).forEach((ticket) => ids.push(Number(ticket.id)));
        });
        return ids.sort((a, b) => a - b);
    }
    function allowFor(percent, randomUnit) {
        return percent > 0 && (randomUnit * 100) < percent;
    }

    const deny = { allowBonusWin: allowFor(0, 0) };
    assert.strictEqual(deny.allowBonusWin, false);
    const rosterDeny = rosterFrom(entries);
    assert.deepStrictEqual(cardIds(rosterDeny), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const paidDeny = engine.absorbMissedRealWinners(indexed, rosterDeny, entries, called, null, deny);
    const deniedPhones = paidDeny.filter((w) => !w.player.isBot).map((w) => w.player.phone);
    assert.ok(deniedPhones.indexOf('late') !== -1, 'late depositor was left out of the split');
    assert.ok(deniedPhones.indexOf('u1') !== -1 && deniedPhones.indexOf('u2') !== -1);
    assert.ok(deniedPhones.indexOf('bonus') !== -1, 'a closed bonus card was skipped');
    assert.strictEqual(deniedPhones.indexOf('quiet'), -1);
    const denyShare = engine.computeEvenSplit(prize, paidDeny.length);
    assert.strictEqual(denyShare, Number((prize / paidDeny.length).toFixed(2)));
    assert.strictEqual(Number((denyShare * paidDeny.length).toFixed(2)), prize);
    assert.deepStrictEqual(cardIds(rosterDeny), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'a denied or quiet card was eaten');

    const allow = { allowBonusWin: allowFor(100, 0.99) };
    assert.strictEqual(allow.allowBonusWin, true);
    assert.strictEqual(allowFor(40, 0.39), true);
    assert.strictEqual(allowFor(40, 0.40), false);
    const rosterAllow = rosterFrom(entries);
    const paidAllow = engine.absorbMissedRealWinners(indexed.slice(), rosterAllow, entries, called, null, allow);
    const allowedPhones = paidAllow.filter((w) => !w.player.isBot).map((w) => w.player.phone);
    assert.ok(allowedPhones.indexOf('bonus') !== -1, '100% bonus chance excluded the bonus card');
    assert.ok(allowedPhones.indexOf('late') !== -1);
    const allowShare = engine.computeEvenSplit(prize, paidAllow.length);
    assert.strictEqual(allowShare, Number((prize / paidAllow.length).toFixed(2)));
    paidAllow.forEach((winner) => {
        assert.strictEqual(engine.computeEvenSplit(prize, paidAllow.length), allowShare);
        if (!winner.player.isBot) assert.ok(allowedPhones.indexOf(winner.player.phone) !== -1);
    });
    assert.deepStrictEqual(cardIds(rosterAllow), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const trimmed = engine.dropCommittedEntries(entries, [9]);
    const rosterTrim = rosterFrom(trimmed);
    const left = cardIds(rosterTrim);
    assert.strictEqual(left.indexOf(9), -1);
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((id) => assert.ok(left.indexOf(id) !== -1, 'card ' + id + ' was lost while releasing 9'));
});

test('fallback replaceGrid updates one card and freezeGrid still keeps the first grid', () => {
    const ledger = engine.createRoundCardLedger();
    const purchased = openBotGrid();
    ledger.freezeGrid(9, 88, purchased);
    const other = openBotGrid();
    other[0][0] = 1;
    assert.deepStrictEqual(ledger.freezeGrid(9, 88, other), purchased);
    assert.deepStrictEqual(ledger.replaceGrid(9, 88, other), other);
    assert.deepStrictEqual(ledger.getGrid(9, 88), other);
    assert.notDeepStrictEqual(ledger.getGrid(9, 88), purchased);
});

test('pre-round line index matches grid scans and does not rewrite a closed card', () => {
    const real = {
        phone: 'real',
        isBot: false,
        hasDeposited: true,
        ticketsData: [{ id: 12, grid: rowWinGrid() }]
    };
    const bot = {
        phone: 'bot',
        isBot: true,
        ticketsData: [{ id: 40, grid: engine.generateFixedCard(40, 3) }]
    };
    const players = [real, bot];
    const index = engine.buildRoundLineIndex(players);
    const called = [1, 2, 3, 4];
    index.syncCalled(called);
    const away = index.oneAwayNumbers([real], {});
    assert.deepStrictEqual(away, engine.oneAwayNumbers(real.ticketsData[0].grid, called));
    const restricted = index.restrictedHits([5, 10], (player) => player.phone === 'real');
    assert.ok(restricted.blocked.indexOf(5) !== -1);
    index.noteCalled(5);
    assert.strictEqual(index.hasComplete(), true);
    assert.strictEqual(engine.checkBingo(real.ticketsData[0].grid, called.concat([5])), true);
    const closed = engine.closeWinningTicket(real.ticketsData[0], called.concat([5]));
    assert.strictEqual(closed, true);
    assert.strictEqual(real.ticketsData[0].isClosed, true);
    assert.deepStrictEqual(real.ticketsData[0].grid, rowWinGrid());
});

test('finish calls rotate through 14-23 without repeating back to back', () => {
    engine.resetFinishRotation();
    const seq = [];
    for (let i = 0; i < 10; i++) seq.push(engine.pullFinishCall());
    seq.forEach((n) => {
        assert.ok(n >= 14 && n <= 23, 'finish ' + n + ' left the window');
    });
    assert.strictEqual(new Set(seq).size, 10, 'a cycle should cover every call from 14 through 23');
    for (let i = 1; i < seq.length; i++) {
        assert.notStrictEqual(seq[i], seq[i - 1], 'back-to-back rounds landed on ' + seq[i]);
    }
    const again = engine.pullFinishCall();
    assert.ok(again >= 14 && again <= 23);
    assert.notStrictEqual(again, seq[seq.length - 1]);
    engine.resetFinishRotation();
});

test('personal standing follows cards played outside the top 10', () => {
    const season = 'S9';
    const players = [];
    for (let i = 0; i < 12; i++) {
        players.push({
            phone: '09' + String(100 + i),
            name: 'P' + i,
            seasonId: season,
            seasonCardsPlayed: 100 - i
        });
    }
    players.push({ phone: '0999', name: 'Sara', seasonId: season, seasonCardsPlayed: 3 });
    const ranked = engine.shapeCardsLeaderboard(players);
    const sara = players[players.length - 1];
    const ahead = players.filter((p) => p.seasonCardsPlayed > 0 && (
        p.seasonCardsPlayed > sara.seasonCardsPlayed ||
        (p.seasonCardsPlayed === sara.seasonCardsPlayed && String(p.phone) < String(sara.phone))
    )).length;
    const standing = engine.shapePersonalStanding(sara, ahead, season);
    const fromBoard = ranked.find((row) => row.phone === '0999');
    assert.strictEqual(standing.rank, fromBoard.rank);
    assert.strictEqual(standing.rank, 13);
    assert.ok(standing.rank > 10);
    assert.strictEqual(standing.cardsPlayed, 3);
    const tied = [
        { phone: '0912', name: 'B', seasonId: season, seasonCardsPlayed: 5 },
        { phone: '0910', name: 'A', seasonId: season, seasonCardsPlayed: 5 }
    ];
    const tieBoard = engine.shapeCardsLeaderboard(tied);
    assert.strictEqual(tieBoard[0].phone, '0910');
    const aheadB = tied.filter((p) => p.seasonCardsPlayed > 5 || (p.seasonCardsPlayed === 5 && p.phone < '0912')).length;
    assert.strictEqual(engine.shapePersonalStanding(tied[0], aheadB, season).rank, tieBoard[1].rank);
    const stale = engine.shapePersonalStanding({ phone: '0999', name: 'Sara', seasonId: 'old', seasonCardsPlayed: 50 }, 0, season);
    assert.strictEqual(stale.rank, null);
    assert.strictEqual(stale.cardsPlayed, 0);
    const zero = engine.shapePersonalStanding({ phone: '0900', name: 'New', seasonId: season, seasonCardsPlayed: 0 }, 0, season);
    assert.strictEqual(zero.rank, null);
    const filter = engine.cardStandingAheadFilter(season, 3, '0999');
    assert.strictEqual(filter.seasonId, season);
    assert.deepStrictEqual(filter.$or[0], { seasonCardsPlayed: { $gt: 3 } });
    assert.deepStrictEqual(filter.$or[1], { seasonCardsPlayed: 3, phone: { $lt: '0999' } });

    const fs = require('fs');
    const path = require('path');
    ['../public/index.html', '../publicindex.html'].forEach((file) => {
        const html = fs.readFileSync(path.join(__dirname, file), 'utf8');
        assert.ok(/id="occupied-cards-count"/.test(html), file);
        assert.ok(/Occupied Cards:/.test(html), file);
        assert.ok(/የተያዙ ካርዶች:/.test(html), file);
        assert.ok(/Your Rank:/.test(html), file);
        assert.ok(/የእርስዎ ደረጃ:/.test(html), file);
        assert.ok(/#rank-page\.active-page #my-rank-banner\.show/.test(html), file);
        assert.ok(/function noteTakenTickets/.test(html), file);
        assert.ok(/function holdPendingOccupied/.test(html), file);
        assert.ok(/noteTakenTickets\(ticketsArr\)/.test(html), file);
        assert.ok(/hideMyRankBanner\(\)/.test(html), file);
        assert.ok(/encodeURIComponent\(currentUser\.phone\)/.test(html), file);
        assert.ok(/syncOccupiedFromStatus\(data\)/.test(html), file);
    });
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(/resolvePersonalStanding/.test(server));
    assert.ok(/req\.query\.phone/.test(server));
    assert.ok(/shapePersonalStanding/.test(server));
    assert.ok(/Object\.assign\(\{\}, payload, \{ me \}\)/.test(server));
});

test('a closed human stays the winner after the bonus filter', () => {
    const closed = { player: { phone: 'closer', isBot: false, bonusBetAmount: 10, hasDeposited: true }, ticket: { id: 22 }, authenticClose: true };
    const bot = { player: { phone: 'bot', isBot: true }, ticket: { id: 3 }, authenticClose: true };
    const filtered = engine.dropDeniedBonusWinners([closed, bot], { allowBonusWin: false });
    assert.deepStrictEqual(filtered.map((w) => w.player.phone), ['bot']);
    const restored = engine.restoreLockedHumanWinners(filtered, [closed, bot]);
    assert.deepStrictEqual(restored.map((w) => w.player.phone), ['bot', 'closer']);
});

test('a short vault records the exact minus after a full user payout', () => {
    const settled = engine.settleWinnerVault(
        { virtualPrizePool: 3, vaultTwoBalance: 80, vaultThreeBalance: 4 },
        {
            realMoneyOut: 10,
            isWinnerDepositor: false,
            realWinnersCount: 1,
            botWinnersCount: 0,
            totalWinners: 1,
            allowNegative: true
        }
    );
    assert.strictEqual(settled.charged, 'virtualPrizePool');
    assert.strictEqual(settled.balances.virtualPrizePool, -7);
    const solo = engine.settleWinnerVault(
        { virtualPrizePool: 3, vaultTwoBalance: 3, vaultThreeBalance: 4 },
        {
            realMoneyOut: 10,
            isWinnerDepositor: true,
            realWinnersCount: 1,
            botWinnersCount: 0,
            totalWinners: 1,
            allowNegative: true
        }
    );
    assert.strictEqual(solo.charged, 'vaultTwoBalance');
    assert.strictEqual(solo.balances.vaultTwoBalance, -7);
});

test('round ids increment from the highest stored round and never repeat', async () => {
    let stored = 5600;
    let history = 5600;
    const pending = [];
    const ids = engine.createRoundIdAllocator({
        highest: async function () { return history; },
        read: async function () { return stored; },
        compareAndSet: async function (observed, next, base) {
            if (stored > base) return false;
            stored = next;
            return true;
        }
    });
    const first = await ids.allocate();
    const second = await ids.allocate();
    assert.strictEqual(first, 5601);
    assert.strictEqual(second, 5602);
    for (let i = 0; i < 20; i++) pending.push(ids.allocate());
    const batch = await Promise.all(pending);
    const unique = new Set(batch);
    assert.strictEqual(unique.size, batch.length);
    const sorted = batch.slice().sort((a, b) => a - b);
    assert.strictEqual(sorted[0], 5603);
    assert.strictEqual(sorted[sorted.length - 1], 5622);
    history = 5700;
    const afterHistory = await ids.allocate();
    assert.strictEqual(afterHistory, 5701);
});

test('server pays a locked user before bot-card lock and issues sequential round ids', () => {
    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.ok(server.includes('restoreLockedHumanWinners(winners, submittedWinners)'));
    assert.ok(server.includes('lockBotPaymentCardsAfterPayout'));
    assert.ok(server.includes('createRoundIdAllocator'));
    assert.ok(!/gameId = Math\.floor\(Math\.random\(\) \* 9000\)/.test(server));
    const payAt = server.indexOf('user.mainBalance += splitPrize');
    const lockAt = server.indexOf('await lockBotPaymentCardsAfterPayout(winners)');
    assert.ok(payAt !== -1 && lockAt > payAt, 'bot card lock must run after the user credit');
    const lockBody = server.slice(server.indexOf('async function lockBotPaymentCardsAfterPayout'), server.indexOf('async function declareWinners'));
    assert.ok(lockBody.includes('catch'), 'bot card lock must fail soft');
    assert.ok(!lockBody.includes('mainBalance'), 'bot card lock must not touch the user payout');
});

test('every block of 10 games gives the bot at least 3 solo wins', () => {
    const controller = engine.createBotWinController();
    const scheduled = [];
    for (let i = 0; i < 10; i++) {
        const must = controller.mustSoloNow();
        scheduled.push(must);
        const block = controller.recordCompletedGame(must);
        if (i === 9) {
            assert.strictEqual(block.closed, true);
            assert.strictEqual(block.met, true);
            assert.strictEqual(block.soloWins, 3);
            assert.strictEqual(block.carried, 0);
        }
    }
    assert.deepStrictEqual(scheduled, [true, false, false, true, false, false, true, false, false, false]);
    assert.strictEqual(scheduled.filter(Boolean).length, engine.SOLO_WIN_QUOTA);
    assert.strictEqual(controller.snapshot().played, 0);

    const missed = engine.createBotWinController();
    let solos = 0;
    for (let i = 0; i < 10; i++) {
        const must = missed.mustSoloNow();
        const won = i === 0 ? false : must;
        if (won) solos += 1;
        const block = missed.recordCompletedGame(won);
        if (i === 9) {
            assert.strictEqual(block.met, true);
            assert.ok(block.soloWins >= 3);
        }
    }
    assert.ok(solos >= 3);

    const dry = engine.createBotWinController();
    for (let i = 0; i < 10; i++) dry.recordCompletedGame(false);
    assert.strictEqual(dry.snapshot().carried, 3);
    assert.strictEqual(dry.mustSoloNow(), true);
    assert.strictEqual(engine.isBotSoloWin([{ player: { isBot: true } }]), true);
    assert.strictEqual(engine.isBotSoloWin([
        { player: { isBot: true } },
        { player: { isBot: false } }
    ]), false);
});

test('scheduled bot solo keeps the vault intact and will not skip a locked human', () => {
    const covered = {
        configuredForce: 'ai',
        virtualPrizePool: 0,
        vaultTwoBalance: 500,
        vaultThreeBalance: 40,
        finalTotalPrize: 100,
        depositorCount: 2,
        eligibleBonusCount: 0,
        eligibleRealCount: 2,
        botCount: 3,
        soloBotWinPercent: 15,
        decoyChance: 0,
        rng: function () { return 0.99; }
    };
    const forced = engine.planRoundWinner(Object.assign({ humanLocked: false }, covered), engine.createBotWinController());
    assert.strictEqual(forced.mustSolo, true);
    assert.strictEqual(forced.quotaForced, true);
    assert.strictEqual(forced.forceWinner, 'bots');
    assert.strictEqual(forced.soloBotChance, 1);
    assert.strictEqual(forced.vaultSafe, true);
    const balances = { virtualPrizePool: 0, vaultTwoBalance: 500, vaultThreeBalance: 40 };
    const settled = engine.settleWinnerVault(balances, {
        realMoneyOut: 0,
        isWinnerDepositor: false,
        realWinnersCount: 0,
        botWinnersCount: 1,
        totalWinners: 1,
        allowNegative: false
    });
    assert.strictEqual(settled.charged, null);
    assert.strictEqual(settled.balances.vaultTwoBalance, 500);
    assert.strictEqual(settled.balances.vaultThreeBalance, 40);
    assert.strictEqual(settled.balances.virtualPrizePool, 0);
    assert.strictEqual(balances.vaultTwoBalance, 500);

    const locked = engine.planRoundWinner(Object.assign({ humanLocked: true }, covered), engine.createBotWinController());
    assert.strictEqual(locked.quotaForced, false);
    assert.strictEqual(locked.forceWinner, 'mix_dep');
    assert.strictEqual(locked.mixBotCount, 0);

    const noBots = engine.planRoundWinner(Object.assign({}, covered, { botCount: 0, humanLocked: false }), engine.createBotWinController());
    assert.strictEqual(noBots.quotaForced, false);
    assert.strictEqual(noBots.forceWinner, 'real');

    const met = engine.createBotWinController();
    met.recordCompletedGame(true);
    assert.strictEqual(met.mustSoloNow(), false);
    const quiet = engine.planRoundWinner(Object.assign({ humanLocked: false }, covered), met);
    assert.strictEqual(quiet.quotaForced, false);
    assert.strictEqual(quiet.forceWinner, 'mix_dep');

    const poor = engine.planVaultForce({
        virtualPrizePool: 5,
        vaultTwoBalance: 0,
        vaultThreeBalance: 0,
        finalTotalPrize: 100,
        depositorCount: 2,
        eligibleBonusCount: 0,
        decoyChance: 0,
        rng: function () { return 0.99; }
    });
    assert.strictEqual(poor.forceWinner, 'bots');
    assert.strictEqual(poor.reason, 'underfunded');
    assert.strictEqual(poor.vaultSafe, true);
});

test('zero-deposit players stay untargeted while admin search, vault, and the bot controller stay wired', () => {
    const zero = {
        phone: '0911000000',
        name: 'Zero Deposit',
        isBot: false,
        hasDeposited: true,
        totalDeposited: 0,
        realBetAmount: 20,
        bonusBetAmount: 0
    };
    const deny = { allowBonusWin: false, activeCooldowns: {}, timeBans: {} };
    assert.strictEqual(engine.bonusWinDenied(zero, deny), true);
    assert.strictEqual(engine.canTargetForWin(zero, deny), false);
    const { userMatchesAdminSearch } = require('../adminUserSearch');
    assert.strictEqual(userMatchesAdminSearch('0911000000', zero), true);
    assert.strictEqual(userMatchesAdminSearch('zero deposit', zero), true);

    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const routes = fs.readFileSync(path.join(__dirname, '../bots/bot.routes.js'), 'utf8');
    [
        'createBotWinController',
        'planRoundWinner',
        'recordCompletedGame',
        'clampSoloBotPercent',
        'buildAdminUserSearchQuery',
        'canTargetForWin',
        'settleWinnerVault',
        'dropDeniedBonusWinners'
    ].forEach((token) => {
        assert.ok(server.indexOf(token) !== -1, 'server is missing ' + token);
    });
    assert.ok(routes.indexOf('applyBotMasterSettings') !== -1, 'bot routes bypass the controller');
    const settings = {};
    engine.applyBotMasterSettings(settings, {
        isBotSystemActive: true,
        botWinnerForce: 'ai',
        botDist1: 1,
        botDist2: 2,
        botDist3: 3,
        botDist4: 4,
        soloBotWinPercent: 140
    });
    assert.strictEqual(settings.botWinnerForce, 'ai');
    assert.strictEqual(settings.soloBotWinPercent, 100);
    assert.strictEqual(engine.clampSoloBotPercent('nope'), 15);
});

test('multi-way splits stay inside the cap and a four-corner does not skip the five-line', () => {
    const called = [1, 16, 31, 46, 2, 17, 32, 47];
    const real = {
        isBot: false,
        phone: 'real',
        ticketsData: [{ id: 1, grid: [
            [1, 16, 31, 46, 61],
            [2, 17, 32, 47, 62],
            [3, 18, 'FREE', 48, 63],
            [4, 19, 34, 49, 64],
            [5, 20, 35, 50, 65]
        ] }]
    };
    function botCard(id, closer) {
        return {
            isBot: true,
            phone: 'bot-' + id,
            ticketsData: [{ id: id, grid: [
                [1, 16, 31, 46, closer],
                [3, 18, 33, 48, 66],
                [4, 19, 'FREE', 49, 67],
                [5, 20, 34, 50, 68],
                [6, 21, 35, 51, 69]
            ] }]
        };
    }
    const four = [2, 3, 4, 5].map((id) => botCard(id, 58));
    const six = [6, 7, 8, 9, 10, 11].map((id) => botCard(id, 61));
    const players = four.concat(six);
    const base = {
        currentTurn: 18,
        finishCall: 18,
        forceWinner: 'bots',
        botCount: 0,
        called: [1, 16, 31, 46],
        pool: [58, 61],
        targetPlayers: [],
        botPlayers: players,
        others: [],
        completing: [58, 61],
        botCompleting: [58, 61],
        userCompleting: [],
        fourCorner: [],
        blockedCompleting: [],
        soloBotChance: 0,
        rng: function () { return 0; }
    };
    const scan = engine.chooseDrawnBall(base);
    const indexed = engine.chooseDrawnBall(Object.assign({}, base, {
        lineIndex: engine.buildRoundLineIndex(players)
    }));
    assert.strictEqual(scan.num, 58);
    assert.strictEqual(scan.plan, 'shared');
    assert.strictEqual(indexed.num, 58);
    assert.strictEqual(indexed.plan, 'shared');
    assert.ok(engine.splitRank(4) > engine.splitRank(6));
    assert.ok(engine.splitRank(5) > engine.splitRank(4));

    const tight = [21, 22, 23].map((id) => botCard(id, 62));
    const wide = [31, 32, 33, 34, 35, 36].map((id) => botCard(id, 61));
    assert.strictEqual(engine.pickExactSharedOneAway([real], wide.concat(tight), called, {
        pool: [61, 62],
        botCount: 1
    }), 62, 'an in-cap bot group is the split, not the overflowing ball');

    const cornerSkip = engine.chooseDrawnBall({
        currentTurn: 23,
        finishCall: 18,
        forceWinner: 'real',
        botCount: 0,
        called: [],
        pool: [1, 61],
        targetPlayers: [],
        botPlayers: [],
        others: [],
        completing: [61],
        botCompleting: [],
        userCompleting: [],
        fourCorner: [1],
        blockedCompleting: [],
        rng: function () { return 0; }
    });
    assert.strictEqual(cornerSkip.num, 61);
    assert.strictEqual(cornerSkip.plan, 'emergency');

    const win = rowWinGrid();
    const seated = {};
    [1, 2].forEach((id) => {
        seated['h' + id] = { phone: 'h' + id, isBot: false, ticketsData: [{ id: id, grid: win }] };
    });
    [3, 4, 5, 6, 7, 8].forEach((id) => {
        seated['b' + id] = { phone: 'b' + id, isBot: true, ticketsData: [{ id: id, grid: win }] };
    });
    const cappedRound = engine.finalizeBingoRound(seated, [], [1, 2, 3, 4, 5], {
        calledNumbers: [1, 2, 3, 4, 5],
        currentTurn: 16,
        totalPrize: 100
    });
    assert.strictEqual(cappedRound.winners.length, 5);
    assert.strictEqual(cappedRound.winners.filter((w) => !w.player.isBot).length, 2);
    assert.ok(cappedRound.winners.some((w) => w.player.phone === 'h1'));
    assert.ok(cappedRound.winners.some((w) => w.player.phone === 'h2'));
});

test('bot names stay unique without a trailing capital letter', () => {
    const pool = engine.MALE_ETH_BOT_NAMES;
    const names = engine.generateUniqueBotNames(300, [], pool);
    assert.strictEqual(names.length, 300);
    const keys = new Set(names.map((name) => name.trim().toLowerCase()));
    assert.strictEqual(keys.size, 300);
    names.forEach((name) => {
        assert.ok(!/[A-Z]$/.test(name), name);
        assert.ok(!/[0-9]$/.test(name), name);
        assert.ok(name.indexOf(' ') === -1, name);
    });
    assert.ok(engine.MALE_ETH_BOT_NAMES.length >= 500);
    assert.ok(names.every((name) => name.indexOf('-') === -1 && name.indexOf('.') === -1));
    assert.ok(names.indexOf('Abebe') !== -1);
    assert.ok(names.indexOf('Abebe-Kebede') === -1);
    const overflow = engine.generateUniqueBotNames(8, [], ['Abebe', 'Kebede', 'Chala', 'Hagos']);
    assert.deepStrictEqual(overflow.slice(0, 4), ['Abebe', 'Kebede', 'Chala', 'Hagos']);
    const marks = overflow.slice(4).map((name) => name.replace(/^[A-Za-z]+/, ''));
    assert.strictEqual(marks.length, 4);
    assert.strictEqual(new Set(marks).size, marks.length);
    assert.deepStrictEqual(marks, ['-a', '.b', '-c', '.d']);
    const blocked = engine.generateUniqueBotNames(3, ['Abebe', 'Kebede'], ['Abebe', 'Kebede', 'Chala']);
    assert.deepStrictEqual(blocked, ['Chala', 'Abebe-a', 'Kebede.b']);
    const given = new Set(pool.map((name) => name.toLowerCase()));
    names.forEach((name) => {
        const parts = name.split(/[-.]/);
        assert.ok(given.has(parts[0].toLowerCase()), name);
        assert.ok(parts.length <= 2, name);
        if (parts.length === 2) {
            assert.ok(/^[a-z]*$/.test(parts[1]), name);
            assert.ok(!given.has(parts[1]), name);
        }
    });
    const suffixed = engine.generateUniqueBotNames(3, [], ['AbebeA', 'KebedeB', 'Chala']);
    assert.deepStrictEqual(suffixed, ['Abebe', 'Kebede', 'Chala']);
    const more = engine.generateUniqueBotNames(40, names, pool);
    assert.strictEqual(more.length, 40);
    more.forEach((name) => {
        assert.ok(!keys.has(name.trim().toLowerCase()));
        assert.ok(!/[A-Z]$/.test(name), name);
    });
    const fs = require('fs');
    const path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const routes = fs.readFileSync(path.join(__dirname, '../bots/bot.routes.js'), 'utf8');
    assert.ok(server.includes('generateUniqueBotNames'));
    assert.ok(routes.includes('generateUniqueBotNames'));
    assert.ok(!/fromCharCode\(65 \+ \(guard % 26\)\)/.test(server));
    assert.ok(!routes.includes('fromCharCode'));
    assert.ok(server.includes('isActive: false'));
    const renameStart = server.indexOf("app.post('/api/admin/bots-rename-all'");
    const renameEnd = server.indexOf("app.post('/api/admin/delete-bot'");
    const rename = server.slice(renameStart, renameEnd);
    assert.ok(rename.includes('botListFilter(req.body.search)'));
    assert.ok(rename.includes("sort({ _id: -1 })"));
    assert.ok(rename.includes('selectBotsForRename'));
    assert.ok(rename.includes('planUniqueInactiveRenames'));
    assert.ok(rename.includes('applyBotUsernameStyles'));
    assert.ok(rename.includes('styleAt: req.body.styleAt === true'));
    assert.ok(rename.includes('styleCaps: req.body.styleCaps === true'));
    assert.ok(rename.includes('styleHyphen: req.body.styleHyphen === true'));
    assert.ok(!rename.includes('planInactiveBotRenames'));
    assert.ok(rename.includes('modifiedCount'));
    assert.ok(!rename.includes('isActive: false'));
    assert.ok(rename.includes('collectInactiveUserNames'));
    assert.ok(rename.includes("$nin: ['banned', 'Banned', 'BANNED', 'deleted', 'Deleted', 'DELETED', 'disabled', 'Disabled', 'DISABLED']"));
    assert.ok(rename.includes("status: { $in: ['inactive', 'Inactive', 'INACTIVE', 'idle', 'Idle', 'IDLE'] }"));
    assert.ok(rename.includes('lastActive: { $lt: idleBefore }'));
    assert.ok(!rename.includes("$nin: ['active', 'Active', 'ACTIVE']"));
    assert.ok(!rename.includes('$sample'));
    assert.ok(!rename.includes('User.aggregate'));
    assert.ok(!/(^|[^A-Za-z])User\.update/.test(rename));
    assert.ok(!/(^|[^A-Za-z])User\.bulkWrite/.test(rename));
    assert.ok(!rename.includes('assignUniqueBotNames'));
    const picked = engine.selectInactiveBotsForRename([
        { name: 'Abebe', isActive: true },
        { name: 'Kebede', isActive: false },
        { name: 'Real', isActive: false, password: 'secret', status: 'active', mainBalance: 20 },
        { name: 'Player', status: 'active', playBalance: 5 },
        { name: 'Chala', isActive: false, phone: '0911' }
    ]);
    assert.deepStrictEqual(picked.map((bot) => bot.name), ['Kebede', 'Chala']);
    assert.ok(server.includes('cardStakeFromWallets'));
    assert.ok(routes.includes('.skip('));
    assert.ok(routes.includes('.limit(limit)'));
    const page = engine.pageBotList(
        Array.from({ length: 120 }, (_, i) => ({ name: 'Bot' + i + 'a', phone: '09' + i, isActive: true })),
        { page: 2, limit: 50 }
    );
    assert.strictEqual(page.bots.length, 50);
    assert.strictEqual(page.total, 120);
    assert.strictEqual(page.page, 2);
    const found = engine.pageBotList(
        [{ name: 'Abebe', phone: '0911000001' }, { name: 'Kebede', phone: '0922000002' }, { name: 'Abebe9', phone: '093' }],
        { search: '0911' }
    );
    assert.deepStrictEqual(found.bots.map((bot) => bot.name), ['Abebe']);
    const openStake = engine.cardStakeFromWallets(4, 20, 10, true);
    assert.strictEqual(openStake.ok, true);
    assert.strictEqual(openStake.playDeducted, 4);
    assert.strictEqual(openStake.mainDeducted, 6);
    const shutStake = engine.cardStakeFromWallets(4, 20, 10, false);
    assert.strictEqual(shutStake.ok, true);
    assert.strictEqual(shutStake.allowMain, false);
    assert.strictEqual(shutStake.blocked, true);
    assert.strictEqual(shutStake.playDeducted, 4);
    assert.strictEqual(shutStake.mainDeducted, 6);
    assert.ok(server.includes('vaultBlockedAmount'));
    assert.ok(server.includes('if(req.body.clearVaultTransferred === true) s.vaultTransferredAmount = 0;'));
    assert.ok(server.includes('if(req.body.clearVaultBlocked === true) s.vaultBlockedAmount = 0;'));
    const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    assert.ok(admin.includes("clearVaultLedger('transferred')"));
    assert.ok(admin.includes("clearVaultLedger('blocked')"));
    const renameUi = admin.slice(admin.indexOf('async function randomizeAllBotNames'), admin.indexOf('async function deleteBot'));
    assert.ok(renameUi.includes('search: search'));
    assert.ok(renameUi.includes('await loadBotDB(1)'));
    const playOnly = engine.cardStakeFromWallets(12, 20, 10, false);
    assert.strictEqual(playOnly.ok, true);
    assert.strictEqual(playOnly.mainDeducted, 0);
    assert.strictEqual(playOnly.playDeducted, 10);
});

test('bot rename copies names only from inactive users', () => {
    const now = new Date('2026-11-16T00:00:00.000Z').getTime();
    const idleAt = new Date(now - engine.INACTIVE_PLAYER_IDLE_MS - 1000);
    const recentAt = new Date(now - engine.INACTIVE_PLAYER_IDLE_MS + 60000);
    const users = [
        { name: 'Sara', status: 'active', password: 'secret', mainBalance: 50, playBalance: 12, lastActive: recentAt },
        { name: 'Marta', status: 'banned', mainBalance: 0, lastActive: idleAt },
        { name: 'Helen', status: 'inactive', playBalance: 3, lastActive: recentAt },
        { name: 'Missing' },
        { name: 'Blank', status: ' ' },
        { name: 'ActiveCaps', status: 'Active', lastActive: recentAt },
        { name: 'user12', status: 'banned' },
        { name: '0911223344', status: 'inactive' },
        { name: 'Al', status: 'banned' },
        { name: 'Yonas', status: 'banned', lastActive: idleAt },
        { name: 'Marta', status: 'disabled', lastActive: idleAt },
        { name: 'Gone', status: 'deleted', lastActive: idleAt },
        { name: 'Dawit', status: 'active', password: 'secret', lastActive: idleAt },
        { name: 'Recent', status: 'active', lastActive: recentAt }
    ];
    const snapshot = structuredClone(users);
    const pool = engine.collectInactiveUserNames(users, now);
    assert.deepStrictEqual(pool, ['Helen', 'Dawit']);
    assert.ok(pool.indexOf('Marta') === -1);
    assert.ok(pool.indexOf('Yonas') === -1);
    assert.ok(pool.indexOf('Gone') === -1);
    assert.deepStrictEqual(users, snapshot);
    pool.forEach((name) => assert.ok(name !== 'Sara' && name !== 'ActiveCaps' && name !== 'Missing'));

    const bots = [
        { _id: 'b1', name: 'OldOne', isActive: false, phone: '0911000001' },
        { _id: 'b2', name: 'OldTwo', isActive: true, phone: '0922000002' },
        { _id: 'b3', name: 'OldThree', isActive: false, phone: '0933000003' },
        { _id: 'b4', name: 'OldFour', isActive: false, phone: '0944000004' },
        { _id: 'b5', name: 'Sara', isActive: false, password: 'secret', status: 'active', mainBalance: 9 }
    ];
    const updates = engine.planInactiveBotRenames(bots.concat(users), {
        pool: pool,
        exclusivePool: true,
        reserved: ['Yonas']
    });
    assert.deepStrictEqual(updates.map((row) => String(row._id)), ['b1', 'b3', 'b4']);
    assert.deepStrictEqual(updates.map((row) => row.name), ['Helen', 'Dawit', 'Helen-a']);
    updates.forEach((row) => {
        assert.ok(engine.nameComesFromBotList(row.name, pool), row.name);
        assert.ok(row.name.indexOf('Sara') === -1);
        assert.ok(row.name.indexOf('ActiveCaps') === -1);
    });
    assert.deepStrictEqual(users, snapshot);
    assert.strictEqual(bots[1].name, 'OldTwo');
    assert.strictEqual(bots[4].name, 'Sara');

    const shown = engine.planInactiveBotRenames([
        { _id: 'p1', name: 'VisibleOne', isActive: true, phone: '0911' },
        { _id: 'p2', name: 'VisibleTwo', isActive: true, phone: '0922' },
        { _id: 'p3', name: 'Sara', isActive: true, password: 'secret', status: 'active', mainBalance: 4 }
    ], {
        pool: pool,
        exclusivePool: true,
        includeActive: true,
        reserved: ['Yonas']
    });
    assert.deepStrictEqual(shown.map((row) => String(row._id)), ['p1', 'p2']);
    assert.deepStrictEqual(shown.map((row) => row.name), ['Helen', 'Dawit']);
    shown.forEach((row) => assert.ok(row.name.indexOf('Sara') === -1));

    const activeOnly = engine.collectInactiveUserNames([
        { name: 'Sara', status: 'active', lastActive: recentAt },
        { name: 'Kebede', status: 'ACTIVE', lastActive: recentAt },
        { name: 'Dawit', status: 'banned', lastActive: idleAt },
        { name: 'Gone', status: 'deleted', lastActive: idleAt }
    ], now);
    assert.deepStrictEqual(activeOnly, []);
    const none = engine.planInactiveBotRenames(
        [{ _id: 'b9', name: 'Old', isActive: false }],
        { pool: activeOnly, exclusivePool: true }
    );
    assert.deepStrictEqual(none, []);
});

test('bot generation and rename never repeat a username', () => {
    function assertUnique(list, label) {
        const keys = list.map((name) => engine.botNameKey(name)).filter(Boolean);
        assert.strictEqual(new Set(keys).size, keys.length, label);
    }

    const many = engine.generateUniqueBotNames(520, [' abebe ', 'KEBEDE'], engine.MALE_ETH_BOT_NAMES);
    assert.ok(many.length >= 500);
    assertUnique(many, 'generated batch');
    many.forEach((name) => {
        assert.notStrictEqual(engine.botNameKey(name), 'abebe');
        assert.notStrictEqual(engine.botNameKey(name), 'kebede');
    });

    const repeatedPool = engine.generateUniqueBotNames(40, ['Yonas', 'yonas-a'], ['Yonas', ' yonas ', 'YONAS']);
    assertUnique(repeatedPool, 'repeated pool');
    repeatedPool.forEach((name) => {
        assert.notStrictEqual(engine.botNameKey(name), 'yonas');
        assert.notStrictEqual(engine.botNameKey(name), 'yonas-a');
    });
    assert.strictEqual(repeatedPool.length, 40);

    const marks = engine.generateUniqueBotNames(60, ['Yonas'], ['Yonas']);
    assert.ok(marks.length > 0);
    assertUnique(marks, 'marks');
    const stuck = [
        { _id: 'a', name: 'Other', isActive: false },
        { _id: 'b', name: 'Yonas', isActive: false },
        { _id: 'c', name: 'Helen', isActive: true }
    ];
    const updates = engine.planInactiveBotRenames(stuck, {
        pool: ['Yonas'],
        exclusivePool: true,
        reserved: marks
    });
    assert.deepStrictEqual(updates, []);
    const roster = stuck.map((bot) => bot.name);
    assertUnique(roster, 'unchanged roster');

    const batch = [];
    for (let i = 0; i < 24; i++) {
        batch.push({ _id: 'n' + i, name: 'Old' + i, isActive: false });
    }
    batch.push({ _id: 'live', name: 'Marta', isActive: true });
    const renamed = engine.planInactiveBotRenames(batch, {
        pool: ['Marta', 'Helen'],
        exclusivePool: true,
        reserved: ['Marta', ' marta ']
    });
    const byId = {};
    renamed.forEach((row) => { byId[String(row._id)] = row.name; });
    const finalNames = batch.map((bot) => byId[String(bot._id)] || bot.name);
    assertUnique(finalNames, 'renamed roster');
    assert.strictEqual(byId.live, undefined);
    renamed.forEach((row) => {
        assert.notStrictEqual(engine.botNameKey(row.name), 'marta');
        assert.ok(engine.nameComesFromBotList(row.name, ['Marta', 'Helen']));
    });
    assert.ok(renamed.length >= 20);
});

test('a 300-bot join keeps every bot when four cards each would overflow the deck', () => {
    const bots = [];
    for (let i = 0; i < 206; i++) bots.push({ name: 'Hidden' + i, phone: '08' + i });
    for (let i = 0; i < 320; i++) {
        bots.push({ name: 'Visible' + i + 'a', phone: '07' + String(i).padStart(4, '0') });
    }
    bots.push({ name: 'Visible0a', phone: '070000' });
    const picked = engine.takeJoinableBots(bots, 300, ['070000']);
    assert.strictEqual(picked.length, 300);
    assert.ok(picked.every((bot) => !/[0-9]$/.test(bot.name)));
    assert.ok(!picked.some((bot) => bot.phone === '070000'));

    const heavy = engine.buildBotJoinQueue(bots, 300, [0, 0, 0, 300], 700, ['070000']);
    assert.strictEqual(heavy.length, 300);
    const heavyCards = heavy.reduce((sum, item) => sum + item.tixCount, 0);
    assert.ok(heavyCards <= 700);
    assert.ok(heavyCards >= 300);
    assert.ok(heavy.every((item) => item.tixCount >= 1 && item.tixCount <= 4));

    const plan = engine.expandBotTicketPlan(300, [5, 4, 3, 3]);
    assert.strictEqual(plan.length, 300);
    assert.strictEqual(plan.reduce((sum, n) => sum + n, 0), 680);
    const fitted = engine.fitBotTicketCounts(plan, 700);
    assert.strictEqual(fitted.length, 300);
    assert.strictEqual(fitted.reduce((sum, n) => sum + n, 0), 680);

    const fours = engine.fitBotTicketCounts(Array(300).fill(4), 700);
    assert.strictEqual(fours.length, 300);
    assert.strictEqual(fours.reduce((sum, n) => sum + n, 0), 700);

    function leftAfter(startClock, queued) {
        let clock = startClock;
        let waiting = queued;
        while (clock > 0 && waiting > 0) {
            clock -= 1;
            if (clock > 0) waiting -= engine.botsToReleaseThisTick(waiting, clock, function () { return 0; });
        }
        return waiting;
    }
    assert.strictEqual(leftAfter(40, 300), 0);
    assert.strictEqual(leftAfter(8, 300), 0);
    assert.strictEqual(engine.botsToReleaseThisTick(300, 2, function () { return 0; }), 300);
});

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('card lookups stay cheap after the board passes a 3,000 ETB stake', () => {
    const board = engine.createCardBoard(engine.TOTAL_CARDS);
    const started = process.hrtime.bigint();
    for (let i = 1; i <= 400; i++) board.markTaken(i, 'p' + (i % 80));
    let hits = 0;
    for (let n = 0; n < 50000; n++) {
        const id = (n % engine.TOTAL_CARDS) + 1;
        if (board.isTaken(id)) hits++;
        board.ownerOf(id);
    }
    assert.strictEqual(board.freeCount(), engine.TOTAL_CARDS - 400);
    let pulled = 0;
    while (board.takeRandomFree() != null) pulled++;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.strictEqual(board.takenCount(), 400);
    assert.strictEqual(pulled, engine.TOTAL_CARDS - 400);
    assert.strictEqual(board.freeCount(), 0);
    assert.ok(hits > 20000);
    assert.ok(ms < 200, 'high-stake board work took ' + ms.toFixed(1) + 'ms');
    board.markFree(12);
    assert.strictEqual(board.isTaken(12), false);
    assert.strictEqual(board.ownerOf(12), null);
    assert.strictEqual(board.freeCount(), 1);
    assert.strictEqual(board.takeRandomFree(), 12);
});

test('bots buy cards on a staggered human schedule instead of one burst', () => {
    function assertSchedule(seed, counts, windowMs) {
        const plan = engine.planHumanBotCardDelays(counts, { windowMs: windowMs, rng: mulberry32(seed) });
        const expected = counts.reduce((sum, n) => sum + n, 0);
        assert.strictEqual(plan.length, expected, 'seed ' + seed + ' dropped a card');
        const byBot = new Map();
        for (let i = 0; i < plan.length; i++) {
            const step = plan[i];
            assert.ok(step.delayMs >= 0 && step.delayMs <= windowMs, 'delay outside the countdown');
            const prev = byBot.get(step.botIndex);
            if (prev != null) assert.ok(step.delayMs > prev, 'bot ' + step.botIndex + ' bought two cards at once');
            byBot.set(step.botIndex, step.delayMs);
        }
        return plan;
    }

    const wide = assertSchedule(7, Array(40).fill(2), 35000);
    const starts = wide.filter((step) => step.cardIndex === 0).map((step) => step.delayMs);
    const uniqueStarts = new Set(starts);
    assert.ok(uniqueStarts.size > 15, 'bot start times are still synchronized');
    assert.ok(Math.max.apply(null, wide.map((step) => step.delayMs)) - Math.min.apply(null, wide.map((step) => step.delayMs)) > 12000, 'purchases still land in one clump');
    let crowded = 0;
    for (let i = 0; i < wide.length; i++) {
        let near = 0;
        for (let j = i + 1; j < wide.length; j++) {
            const gap = wide[j].delayMs - wide[i].delayMs;
            if (gap > 250) break;
            near++;
        }
        if (near > crowded) crowded = near;
    }
    assert.ok(crowded <= 3, 'more than a few cards share the same moment (' + crowded + ')');

    const oneBot = assertSchedule(3, [4], 20000);
    const gaps = [];
    for (let i = 1; i < oneBot.length; i++) gaps.push(oneBot[i].delayMs - oneBot[i - 1].delayMs);
    assert.strictEqual(new Set(gaps).size, gaps.length, 'one bot used a fixed gap between cards');
    gaps.forEach((gap) => assert.ok(gap >= 200, 'gap ' + gap + ' is not a human click'));

    const tight = assertSchedule(11, Array(30).fill(1), 1500);
    assert.ok(tight[tight.length - 1].delayMs <= 1500);
    assert.ok(tight[tight.length - 1].delayMs > tight[0].delayMs, 'a short countdown still dumps every bot together');

    const urgent = engine.planHumanBotCardDelays([1, 2, 3], { windowMs: 0, rng: mulberry32(1) });
    assert.strictEqual(urgent.length, 6);
    urgent.forEach((step) => assert.strictEqual(step.delayMs, 0));

    for (let seed = 1; seed <= 8; seed++) {
        assertSchedule(seed, [1, 2, 3, 4, 2, 1, 4, 3], 30000);
    }
});

Promise.all(pendingTests).then(() => {
    console.log('\n' + passed + ' tests passed');
}).catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
