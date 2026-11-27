'use strict';

/**
 * Locks the old division, payout, and vault rules, and the few places
 * this change is allowed to differ.
 *
 * Run: node game/divisionGuard.test.js
 */

const assert = require('assert');
const engine = require('./index');

let passed = 0;
function test(name, fn) {
    fn();
    passed += 1;
    console.log('ok - ' + name);
}

function rowGrid() {
    return [
        [1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 'FREE', 48, 63],
        [4, 19, 34, 49, 64],
        [5, 20, 35, 50, 65]
    ];
}

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

function draw(extra) {
    return engine.chooseDrawnBall(Object.assign({
        currentTurn: 18,
        finishCall: 18,
        called: [1, 16, 31, 46],
        fourCorner: [],
        blockedCompleting: [],
        rng: function () { return 0; },
        soloBotChance: 0
    }, extra));
}

test('the three draw profiles still map the same way', () => {
    assert.strictEqual(engine.drawProfile('bots', 0), 'bot');
    assert.strictEqual(engine.drawProfile('bots', 4), 'bot');
    assert.strictEqual(engine.drawProfile('real', 0), 'user');
    assert.strictEqual(engine.drawProfile('real', 3), 'user');
    assert.strictEqual(engine.drawProfile('mix', 1), 'mixed');
    assert.strictEqual(engine.drawProfile('mix_dep', 1), 'mixed');
    assert.strictEqual(engine.drawProfile('mix_dep', 0), 'user');
});

test('even-split payout math is unchanged', () => {
    assert.strictEqual(engine.computeEvenSplit(100, 1), 100);
    assert.strictEqual(engine.computeEvenSplit(100, 2), 50);
    assert.strictEqual(engine.computeEvenSplit(100, 3), 33.33);
    assert.strictEqual(engine.computeEvenSplit(100, 4), 25);
    assert.strictEqual(engine.computeEvenSplit(100, 5), 20);
    assert.strictEqual(engine.computeEvenSplit(80, 3), 26.67);
    const share = engine.computeEvenSplit(100, 5);
    assert.strictEqual(Number((share * 5).toFixed(2)), 100);
});

test('vault routing for user, mixed, and bot results is unchanged', () => {
    const start = { virtualPrizePool: 50, vaultTwoBalance: 80, vaultThreeBalance: 40 };

    const userSolo = engine.settleWinnerVault(start, {
        realMoneyOut: 40,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 0,
        totalWinners: 1,
        allowNegative: false
    });
    assert.strictEqual(userSolo.charged, 'vaultTwoBalance');
    assert.strictEqual(userSolo.balances.vaultTwoBalance, 40);
    assert.strictEqual(userSolo.balances.vaultThreeBalance, 40);
    assert.strictEqual(userSolo.balances.virtualPrizePool, 50);

    const userShort = engine.settleWinnerVault(start, {
        realMoneyOut: 100,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 0,
        totalWinners: 1,
        allowNegative: false
    });
    assert.strictEqual(userShort.charged, 'virtualPrizePool');
    assert.strictEqual(userShort.balances.vaultTwoBalance, 80);
    assert.strictEqual(userShort.balances.virtualPrizePool, 0);

    const mixedPair = engine.settleWinnerVault(start, {
        realMoneyOut: 25,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 1,
        totalWinners: 2,
        allowNegative: false
    });
    assert.strictEqual(mixedPair.charged, 'vaultThreeBalance');
    assert.strictEqual(mixedPair.balances.vaultThreeBalance, 15);
    assert.strictEqual(mixedPair.balances.vaultTwoBalance, 80);

    const wideSplit = engine.settleWinnerVault(start, {
        realMoneyOut: 20,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 4,
        totalWinners: 5,
        allowNegative: false
    });
    assert.strictEqual(wideSplit.charged, 'virtualPrizePool');
    assert.strictEqual(wideSplit.balances.virtualPrizePool, 30);
    assert.strictEqual(wideSplit.balances.vaultTwoBalance, 80);
    assert.strictEqual(wideSplit.balances.vaultThreeBalance, 40);

    const botOnly = engine.settleWinnerVault(start, {
        realMoneyOut: 0,
        isWinnerDepositor: false,
        realWinnersCount: 0,
        botWinnersCount: 1,
        totalWinners: 1,
        allowNegative: false
    });
    assert.strictEqual(botOnly.charged, null);
    assert.strictEqual(botOnly.balances.virtualPrizePool, 50);
    assert.strictEqual(botOnly.balances.vaultTwoBalance, 80);
    assert.strictEqual(botOnly.balances.vaultThreeBalance, 40);
    assert.strictEqual(start.vaultTwoBalance, 80);
});

test('the old vault winner plan is unchanged when the solo quota is not forcing', () => {
    const quiet = engine.createBotWinController();
    quiet.recordCompletedGame(true);
    assert.strictEqual(quiet.mustSoloNow(), false);

    const base = {
        humanLocked: false,
        botCount: 3,
        depositorCount: 2,
        eligibleRealCount: 2,
        eligibleBonusCount: 0,
        soloBotWinPercent: 15,
        decoyChance: 0,
        rng: function () { return 0.99; },
        virtualPrizePool: 0,
        vaultTwoBalance: 0,
        vaultThreeBalance: 0,
        finalTotalPrize: 100,
        mixBotCount: 1
    };

    const covered = engine.planRoundWinner(Object.assign({}, base, {
        configuredForce: 'bots',
        vaultTwoBalance: 500
    }), quiet);
    assert.strictEqual(covered.quotaForced, false);
    assert.strictEqual(covered.forceWinner, 'bots');

    const aiCovered = engine.planRoundWinner(Object.assign({}, base, {
        configuredForce: 'ai',
        vaultTwoBalance: 500
    }), quiet);
    assert.strictEqual(aiCovered.quotaForced, false);
    assert.strictEqual(aiCovered.forceWinner, 'mix_dep');
    assert.strictEqual(aiCovered.mixBotCount, 0);

    const aiVaultThree = engine.planVaultForce({
        virtualPrizePool: 10,
        vaultTwoBalance: 20,
        vaultThreeBalance: 60,
        finalTotalPrize: 100,
        depositorCount: 2,
        eligibleBonusCount: 0,
        decoyChance: 0,
        mixBotCount: 4,
        rng: function () { return 0.99; }
    });
    assert.strictEqual(aiVaultThree.forceWinner, 'mix_dep');
    assert.strictEqual(aiVaultThree.mixBotCount, 1);

    const aiUnderfunded = engine.planVaultForce({
        virtualPrizePool: 5,
        vaultTwoBalance: 0,
        vaultThreeBalance: 0,
        finalTotalPrize: 100,
        depositorCount: 2,
        eligibleBonusCount: 0,
        decoyChance: 0,
        rng: function () { return 0.99; }
    });
    assert.strictEqual(aiUnderfunded.forceWinner, 'bots');
    assert.strictEqual(aiUnderfunded.reason, 'underfunded');

    const aiSplit = engine.planVaultForce({
        virtualPrizePool: 80,
        vaultTwoBalance: 0,
        vaultThreeBalance: 0,
        finalTotalPrize: 100,
        depositorCount: 2,
        eligibleBonusCount: 0,
        decoyChance: 0,
        rng: function () { return 0.99; }
    });
    assert.strictEqual(aiSplit.forceWinner, 'mix_dep');
    assert.strictEqual(aiSplit.mixBotCount, 1);

    const userPlan = engine.planRoundWinner(Object.assign({}, base, { configuredForce: 'real' }), quiet);
    assert.strictEqual(userPlan.forceWinner, 'real');
    const mixPlan = engine.planRoundWinner(Object.assign({}, base, { configuredForce: 'mix' }), quiet);
    assert.strictEqual(mixPlan.forceWinner, 'mix');

    const behind = engine.planRoundWinner(Object.assign({}, base, { configuredForce: 'bots' }), quiet);
    assert.strictEqual(behind.quotaForced, false);
    assert.strictEqual(behind.forceWinner, 'bots');
    assert.ok(behind.soloBotChance > 0.15);

    const met = engine.createBotWinController();
    for (let i = 0; i < 8; i++) met.recordCompletedGame(met.mustSoloNow());
    assert.strictEqual(met.snapshot().soloWins, 3);
    assert.strictEqual(met.mustSoloNow(), false);
    const botPlan = engine.planRoundWinner(Object.assign({}, base, { configuredForce: 'bots' }), met);
    assert.strictEqual(botPlan.forceWinner, 'bots');
    assert.strictEqual(botPlan.soloBotChance, 0.15);
});

test('user, bot-group, and mixed closes still pick the same ball when nobody overflows the cap', () => {
    const human = {
        isBot: false,
        phone: 'real',
        hasDeposited: true,
        ticketsData: [{ id: 1, grid: rowGrid() }]
    };
    const oneBot = botCard(11, 61);
    const group = [2, 3, 4, 5, 6].map((id) => botCard(id, 61));
    const solo = botCard(1, 58);

    const user = draw({
        forceWinner: 'real',
        botCount: 0,
        pool: [61, 6],
        targetPlayers: [human],
        botPlayers: [],
        others: [],
        completing: [61],
        botCompleting: [],
        userCompleting: [61]
    });
    assert.strictEqual(user.num, 61);
    assert.strictEqual(user.plan, 'solo');

    const bots = draw({
        forceWinner: 'bots',
        botCount: 0,
        pool: [58, 61],
        targetPlayers: [],
        botPlayers: [solo].concat(group),
        others: [],
        completing: [58, 61],
        botCompleting: [58, 61],
        userCompleting: []
    });
    assert.strictEqual(bots.num, 61);
    assert.strictEqual(bots.plan, 'shared');

    const indexedBots = draw({
        forceWinner: 'bots',
        botCount: 0,
        pool: [58, 61],
        targetPlayers: [],
        botPlayers: [solo].concat(group),
        others: [],
        completing: [58, 61],
        botCompleting: [58, 61],
        userCompleting: [],
        lineIndex: engine.buildRoundLineIndex([solo].concat(group))
    });
    assert.strictEqual(indexedBots.num, 61);
    assert.strictEqual(indexedBots.plan, 'shared');

    const called = [1, 16, 31, 46, 2, 17, 32, 47];
    assert.strictEqual(engine.pickExactSharedOneAway([human], [oneBot].concat(group), called, {
        pool: [61, 62],
        botCount: 1
    }), 61);
    assert.ok(engine.splitRank(5) > engine.splitRank(4));
    assert.ok(engine.splitRank(4) > engine.splitRank(2));
    assert.ok(engine.splitRank(2) > engine.splitRank(1));
});

test('the quota is the only new override, and it does not touch a locked human or an empty bot room', () => {
    const fresh = engine.createBotWinController();
    const room = {
        configuredForce: 'real',
        botCount: 4,
        depositorCount: 2,
        eligibleRealCount: 2,
        eligibleBonusCount: 0,
        soloBotWinPercent: 15,
        humanLocked: false,
        virtualPrizePool: 500,
        vaultTwoBalance: 500,
        vaultThreeBalance: 500,
        finalTotalPrize: 100
    };
    const forced = engine.planRoundWinner(room, fresh);
    assert.strictEqual(forced.mustSolo, true);
    assert.strictEqual(forced.quotaForced, true);
    assert.strictEqual(forced.forceWinner, 'bots');
    assert.strictEqual(forced.soloBotChance, 1);

    const locked = engine.planRoundWinner(Object.assign({}, room, { humanLocked: true }), fresh);
    assert.strictEqual(locked.quotaForced, false);
    assert.strictEqual(locked.forceWinner, 'real');

    const noBots = engine.planRoundWinner(Object.assign({}, room, { botCount: 0 }), fresh);
    assert.strictEqual(noBots.quotaForced, false);
    assert.strictEqual(noBots.forceWinner, 'real');

    const flags = [];
    const schedule = engine.createBotWinController();
    for (let i = 0; i < 10; i++) {
        flags.push(schedule.mustSoloNow());
        schedule.recordCompletedGame(flags[i]);
    }
    assert.deepStrictEqual(flags, [true, false, false, true, false, false, true, false, false, false]);
    assert.strictEqual(flags.filter(Boolean).length, 3);
});

test('overflowing bot groups are the split fix; a normal 2-to-5 split is not', () => {
    const four = [2, 3, 4, 5].map((id) => botCard(id, 58));
    const six = [6, 7, 8, 9, 10, 11].map((id) => botCard(id, 61));
    const players = four.concat(six);
    const choice = draw({
        forceWinner: 'bots',
        botCount: 0,
        pool: [58, 61],
        targetPlayers: [],
        botPlayers: players,
        others: [],
        completing: [58, 61],
        botCompleting: [58, 61],
        userCompleting: []
    });
    assert.strictEqual(choice.num, 58);
    assert.strictEqual(choice.plan, 'shared');
    assert.ok(engine.splitRank(4) > engine.splitRank(6));

    const human = { isBot: false, phone: 'h1', ticketsData: [{ id: 1, grid: rowGrid() }] };
    const seated = { h1: human, h2: { isBot: false, phone: 'h2', ticketsData: [{ id: 2, grid: rowGrid() }] } };
    [3, 4, 5].forEach((id) => {
        seated['b' + id] = { isBot: true, phone: 'b' + id, ticketsData: [{ id: id, grid: rowGrid() }] };
    });
    const normal = engine.finalizeBingoRound(seated, [], [1, 2, 3, 4, 5], {
        calledNumbers: [1, 2, 3, 4, 5],
        currentTurn: 16,
        totalPrize: 100
    });
    assert.strictEqual(normal.winners.length, 5);
    assert.strictEqual(normal.history.winnerPayout, 20);

    const crowded = {};
    [1, 2].forEach((id) => {
        crowded['h' + id] = { isBot: false, phone: 'h' + id, ticketsData: [{ id: id, grid: rowGrid() }] };
    });
    [3, 4, 5, 6, 7, 8].forEach((id) => {
        crowded['b' + id] = { isBot: true, phone: 'b' + id, ticketsData: [{ id: id, grid: rowGrid() }] };
    });
    const capped = engine.finalizeBingoRound(crowded, [], [1, 2, 3, 4, 5], {
        calledNumbers: [1, 2, 3, 4, 5],
        currentTurn: 16,
        totalPrize: 100
    });
    assert.strictEqual(capped.winners.length, 5);
    assert.strictEqual(capped.winners.filter((w) => !w.player.isBot).length, 2);
    assert.strictEqual(capped.history.winnerPayout, 20);
});

function lineHits(grid, called) {
    const marked = new Set(called);
    function hits(cells) {
        let n = 0;
        for (let i = 0; i < cells.length; i++) {
            const val = cells[i];
            if (val === 'FREE' || marked.has(val)) n += 1;
        }
        return n;
    }
    const lines = [];
    for (let r = 0; r < 5; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) row.push(grid[c][r]);
        lines.push(row);
    }
    for (let c = 0; c < 5; c++) lines.push(grid[c]);
    const diag = [];
    const anti = [];
    for (let i = 0; i < 5; i++) {
        diag.push(grid[i][i]);
        anti.push(grid[i][4 - i]);
    }
    lines.push(diag, anti);
    let best = 0;
    for (let i = 0; i < lines.length; i++) {
        const n = hits(lines[i]);
        if (n > best) best = n;
    }
    return best;
}

test('user cards fill a line on calls 10-14 and win on the rotated call, not call 23', () => {
    assert.strictEqual(engine.SOLO_WIN_QUOTA, 3);
    assert.strictEqual(engine.USER_LINE_START, 10);
    assert.strictEqual(engine.USER_LINE_END, 14);
    const human = {
        isBot: false,
        phone: 'real',
        hasDeposited: true,
        ticketsData: [{ id: 1, grid: rowGrid() }]
    };
    const ends = [];
    [14, 15, 18, 23, 16].forEach((finish) => {
        const index = engine.buildRoundLineIndex([human]);
        let pool = [];
        for (let n = 1; n <= 75; n++) pool.push(n);
        const called = [];
        let end = null;
        let bestAt9 = 0;
        let bestAt14 = 0;
        for (let turn = 1; turn <= engine.HARD_CAP_CALLS && end == null; turn++) {
            index.syncCalled(called);
            const completing = [];
            for (let i = 0; i < pool.length; i++) {
                const n = pool[i];
                if (engine.checkBingo(rowGrid(), called.concat([n]))) completing.push(n);
            }
            const choice = engine.chooseDrawnBall({
                currentTurn: turn,
                finishCall: finish,
                forceWinner: 'real',
                botCount: 0,
                called: called,
                pool: pool,
                targetPlayers: [human],
                botPlayers: [],
                others: [],
                completing: completing,
                fourCorner: [],
                blockedCompleting: [],
                lineIndex: index,
                useEarlyMap: true,
                rng: function () { return 0; }
            });
            assert.ok(choice && choice.num != null, 'call ' + turn);
            const before = lineHits(rowGrid(), called);
            if (turn < engine.USER_LINE_START) {
                assert.strictEqual(choice.plan, 'safe', 'call ' + turn + ' left the scatter phase');
                assert.strictEqual(index.leavesOneAway(choice.num), false, 'call ' + turn + ' left a line one away');
            } else if (turn <= engine.USER_LINE_END && turn < finish && before < 4) {
                assert.strictEqual(choice.plan, 'build', 'call ' + turn + ' did not fill the user line');
            }
            if (turn < engine.FINISH_CALL_MIN) {
                assert.strictEqual(engine.checkBingo(rowGrid(), called.concat([choice.num])), false);
            }
            pool = pool.filter((n) => n !== choice.num);
            called.push(choice.num);
            index.noteCalled(choice.num);
            if (turn === 9) bestAt9 = lineHits(rowGrid(), called);
            if (turn === 14) bestAt14 = lineHits(rowGrid(), called);
            if (engine.checkBingo(rowGrid(), called)) end = turn;
        }
        assert.ok(bestAt9 < 4, 'call 9 already had a one-away line (' + bestAt9 + ')');
        if (finish > 14) {
            assert.strictEqual(bestAt14, 4, 'call 14 best line was ' + bestAt14);
        }
        assert.strictEqual(end, finish, 'user round ended on ' + end + ' instead of ' + finish);
        ends.push(end);
    });
    assert.ok(ends.indexOf(23) !== -1);
    assert.ok(ends.filter((n) => n === 23).length === 1);

    const bot = { isBot: true, phone: 'bot', ticketsData: [{ id: 9, grid: rowGrid() }] };
    const botIndex = engine.buildRoundLineIndex([bot]);
    const botCall = engine.chooseDrawnBall({
        currentTurn: 10,
        finishCall: 18,
        forceWinner: 'bots',
        botCount: 1,
        called: [],
        pool: [1, 16, 31, 46, 61, 2, 17],
        targetPlayers: [],
        botPlayers: [bot],
        others: [],
        completing: [],
        fourCorner: [],
        blockedCompleting: [],
        lineIndex: botIndex,
        useEarlyMap: true,
        rng: function () { return 0; }
    });
    assert.strictEqual(botCall.plan, 'safe');
});

{
    const open = engine.planDepositVaultTransfer(100, {
        adminProfitPercent: 30,
        vaultTwoPercent: 10,
        vaultThreePercent: 10,
        vaultTransferEnabled: true
    });
    assert.strictEqual(open.vaultOneCut, 50);
    assert.strictEqual(open.vaultTwoCut, 10);
    assert.strictEqual(open.vaultThreeCut, 10);
    assert.strictEqual(open.mainWalletCut, 30);
    assert.strictEqual(open.transferred, 60);
    assert.strictEqual(open.blocked, 0);
    const shut = engine.planDepositVaultTransfer(100, {
        adminProfitPercent: 30,
        vaultTwoPercent: 10,
        vaultThreePercent: 10,
        vaultTransferEnabled: false
    });
    assert.deepStrictEqual(shut, open);
    assert.strictEqual(shut.vaultOneCut, 50);
    assert.strictEqual(shut.vaultTwoCut, 10);
    assert.strictEqual(shut.vaultThreeCut, 10);
    assert.strictEqual(shut.mainWalletCut, 30);
    assert.strictEqual(shut.transferred, 60);
    assert.strictEqual(shut.blocked, 0);
    const legacy = engine.planDepositVaultTransfer(100, {});
    assert.strictEqual(legacy.allow, true);
    assert.strictEqual(legacy.vaultOneCut, 50);
    assert.strictEqual(legacy.transferred, 60);
    passed++;
}

{
    const names = engine.selectInactiveBotUsernames([
        { name: 'Abebe', isActive: true },
        { name: 'Kebede', isActive: false },
        { name: ' kebede ', isActive: false },
        { name: '   ', isActive: false },
        { name: 'Chala', isActive: false }
    ]);
    assert.deepStrictEqual(names.map((bot) => bot.name), ['Kebede', 'Chala']);
    assert.deepStrictEqual(
        engine.assignUniqueBotNames(['Abebe', 'abebe', 'Kebede', 'Kebede', ''], ['Abebe']),
        ['Kebede']
    );
    assert.strictEqual(engine.botNameEndsWithNumber('Abebe4'), true);
    assert.strictEqual(engine.botNameEndsWithNumber('Kebede12'), true);
    assert.strictEqual(engine.botNameEndsWithNumber('Abebe'), false);
    assert.strictEqual(engine.botNameEndsWithNumber('Abebe.'), false);
    assert.deepStrictEqual(
        engine.selectVisibleBotUsers([
            { name: 'Abebe4' },
            { name: 'Chala' },
            { name: 'Kebede12' },
            { name: 'Dawit' }
        ]).map((bot) => bot.name),
        ['Chala', 'Dawit']
    );
    assert.deepStrictEqual(engine.assignUniqueBotNames(['Abebe4', 'Chala'], []), ['Chala']);
    passed++;
}

test('admin rename changes the bots on the list and still skips real players', () => {
    const fs = require('fs');
    const path = require('path');
    const shown = engine.selectBotsForRename([
        { _id: 'p1', name: 'VisibleOne', isActive: true },
        { _id: 'p2', name: 'VisibleTwo', isActive: false },
        { name: '   ', isActive: true },
        { _id: 'p3', name: 'Sara', isActive: true, password: 'secret', status: 'active', mainBalance: 9 }
    ]);
    assert.deepStrictEqual(shown.map((bot) => bot.name), ['VisibleOne', 'VisibleTwo']);
    const updates = engine.planUniqueInactiveRenames(shown, {
        pool: ['Marta', 'Helen', 'Sara', 'Marta', ' helen ']
    });
    assert.deepStrictEqual(updates.updates.map((row) => row.name), ['Marta', 'Helen']);
    assert.strictEqual(updates.skipped, 0);
    assert.ok(updates.updates.every((row) => row.name.indexOf('-') === -1 && row.name.indexOf('.') === -1));

    const copies = [
        { _id: 'a', name: 'Marta', isActive: true },
        { _id: 'b', name: 'Marta', isActive: true },
        { _id: 'c', name: 'Marta', isActive: true },
        { _id: 'd', name: 'Marta', isActive: true },
        { _id: 'e', name: 'OldBot', isActive: true }
    ];
    const unique = engine.planUniqueInactiveRenames(copies, {
        pool: ['Marta', 'marta', 'Helen', 'Yonas', 'Kebede', 'Dawit'],
        reserved: ['Yonas']
    });
    const finalNames = copies.map((bot) => {
        const row = unique.updates.find((item) => String(item._id) === String(bot._id));
        return row ? row.name : bot.name;
    });
    const keys = finalNames.map((name) => engine.botNameKey(name));
    assert.strictEqual(new Set(keys).size, keys.length);
    assert.ok(keys.indexOf('yonas') === -1);
    assert.ok(unique.updates.every((row) => !/[-.][a-z]{1,2}$/.test(row.name)));
    assert.deepStrictEqual(keys, ['marta', 'helen', 'kebede', 'dawit', 'oldbot']);
    assert.strictEqual(unique.skipped, 1);

    const short = engine.planUniqueInactiveRenames([
        { _id: 's1', name: 'One', isActive: true },
        { _id: 's2', name: 'Two', isActive: true },
        { _id: 's3', name: 'Three', isActive: true }
    ], { pool: ['Marta'] });
    assert.deepStrictEqual(short.updates.map((row) => row.name), ['Marta']);
    assert.strictEqual(short.skipped, 2);
    assert.ok(!short.updates.some((row) => row.name === 'Marta-a' || row.name === 'Marta.b'));

    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const rename = server.slice(server.indexOf("app.post('/api/admin/bots-rename-all'"), server.indexOf("app.post('/api/admin/delete-bot'"));
    assert.ok(rename.includes('planUniqueInactiveRenames'));
    assert.ok(!rename.includes('planInactiveBotRenames'));
    assert.ok(rename.includes('botListFilter(req.body.search)'));
    assert.ok(rename.includes("sort({ _id: -1 })"));
    assert.ok(!rename.includes('isActive: false'));
    assert.ok(rename.includes('modifiedCount'));
    const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
    const ui = admin.slice(admin.indexOf('async function randomizeAllBotNames'), admin.indexOf('async function deleteBot'));
    assert.ok(ui.includes('await loadBotDB(1)'));
    assert.ok(ui.includes('search: search'));
});

test('deposits always use the admin vault percents and the switch only blocks card purchases', () => {
    const fs = require('fs');
    const path = require('path');
    const rates = { adminProfitPercent: 30, vaultTwoPercent: 10, vaultThreePercent: 10 };
    const start = {
        virtualPrizePool: 1000,
        vaultTwoBalance: 200,
        vaultThreeBalance: 300,
        vaultTransferredAmount: 40,
        vaultBlockedAmount: 15,
        dailyHouseProfit: 7
    };
    const open = engine.applyDepositVaultSplit(start, 100, Object.assign({ vaultTransferEnabled: true }, rates));
    assert.strictEqual(open.plan.vaultOneCut, 50);
    assert.strictEqual(open.plan.vaultTwoCut, 10);
    assert.strictEqual(open.plan.vaultThreeCut, 10);
    assert.strictEqual(open.next.virtualPrizePool, 1050);
    assert.strictEqual(open.next.vaultTwoBalance, 210);
    assert.strictEqual(open.next.vaultThreeBalance, 310);
    assert.strictEqual(open.next.vaultTransferredAmount, 100);
    assert.strictEqual(open.next.vaultBlockedAmount, 15);
    assert.strictEqual(open.next.dailyHouseProfit, 37);
    assert.strictEqual(open.inc.virtualPrizePool, 50);
    assert.strictEqual(open.inc.vaultThreeBalance, 10);
    assert.strictEqual(open.inc.vaultTwoBalance, 10);
    assert.strictEqual(open.inc.vaultTransferredAmount, 60);
    assert.strictEqual(open.inc.vaultBlockedAmount, 0);
    assert.strictEqual(open.plan.vaultOneCut + open.plan.vaultTwoCut + open.plan.vaultThreeCut + open.plan.adminCut, 100);

    const shut = engine.applyDepositVaultSplit(open.next, 100, Object.assign({ vaultTransferEnabled: false }, rates));
    assert.deepStrictEqual(shut.plan, open.plan);
    assert.strictEqual(shut.next.virtualPrizePool, 1100);
    assert.strictEqual(shut.next.vaultThreeBalance, 320);
    assert.strictEqual(shut.next.vaultTwoBalance, 220);
    assert.strictEqual(shut.next.vaultTransferredAmount, 160);
    assert.strictEqual(shut.next.vaultBlockedAmount, 15);
    assert.strictEqual(shut.next.dailyHouseProfit, 67);
    assert.strictEqual(shut.inc.virtualPrizePool, 50);
    assert.strictEqual(shut.inc.vaultThreeBalance, 10);
    assert.strictEqual(shut.inc.vaultTwoBalance, 10);
    assert.strictEqual(shut.inc.vaultTransferredAmount, 60);
    assert.strictEqual(shut.inc.vaultBlockedAmount, 0);

    const custom = { adminProfitPercent: 20, vaultTwoPercent: 25, vaultThreePercent: 5, vaultTransferEnabled: false };
    const customOff = engine.applyDepositVaultSplit({
        virtualPrizePool: 0,
        vaultTwoBalance: 0,
        vaultThreeBalance: 0,
        vaultTransferredAmount: 0,
        vaultBlockedAmount: 8
    }, 200, custom);
    assert.strictEqual(customOff.next.virtualPrizePool, 100);
    assert.strictEqual(customOff.next.vaultTwoBalance, 50);
    assert.strictEqual(customOff.next.vaultThreeBalance, 10);
    assert.strictEqual(customOff.next.vaultTransferredAmount, 110);
    assert.strictEqual(customOff.next.vaultBlockedAmount, 8);
    assert.strictEqual(customOff.plan.adminCut, 40);

    const cardOn = engine.cardStakeFromWallets(4, 20, 10, true);
    assert.strictEqual(cardOn.ok, true);
    assert.strictEqual(cardOn.blocked, false);
    assert.strictEqual(cardOn.playDeducted, 4);
    assert.strictEqual(cardOn.mainDeducted, 6);
    const cardOff = engine.cardStakeFromWallets(4, 20, 10, false);
    assert.strictEqual(cardOff.ok, true);
    assert.strictEqual(cardOff.blocked, true);
    assert.strictEqual(cardOff.playDeducted, 4);
    assert.strictEqual(cardOff.mainDeducted, 6);

    const vault = fs.readFileSync(path.join(__dirname, 'vaultTransfer.js'), 'utf8');
    const planFn = vault.slice(vault.indexOf('function planDepositVaultTransfer'), vault.indexOf('function applyDepositVaultSplit'));
    assert.ok(!planFn.includes('vaultTransferEnabled'));
    const cardFn = vault.slice(vault.indexOf('function cardStakeFromWallets'), vault.indexOf('module.exports'));
    assert.ok(cardFn.includes('transferEnabled'));

    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const commit = server.slice(server.indexOf('function commitDepositVaultSplit'), server.indexOf('async function autoApprovePendingDeposits'));
    assert.ok(commit.includes('applyDepositVaultSplit'));
    assert.ok(!commit.includes('vaultTransferEnabled'));
    assert.ok(commit.includes('SystemSettings.updateOne({}, { $inc: booked.inc })'));
    assert.strictEqual(server.split('commitDepositVaultSplit(').length - 1, 4);
    const buy = server.slice(server.indexOf("socket.on('buy_tickets'"), server.indexOf("socket.on('cancel_ticket'"));
    assert.ok(buy.includes('cardStakeFromWallets'));
    assert.ok(buy.includes('GLOBAL_SETTINGS.vaultTransferEnabled'));
    assert.ok(buy.includes('vaultBlockedAmount'));
    assert.ok(buy.includes('virtualPrizePool: v1Cut, vaultThreeBalance: v3Cut'));
});

console.log('\n' + passed + ' division guards passed');
