'use strict';

/**
 * Live-round verification.
 * Prints one line per check. Exits non-zero if any check fails.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const engine = require('./index');
const cooldown = require('../cooldownManager');
const { runTimingSimulation } = require('./roundTiming.sim');

const lines = [];
function log(msg) {
    lines.push(msg);
    console.log(msg);
}
function fail(msg) {
    log('FAIL: ' + msg);
    const err = new Error(msg);
    err.report = lines;
    throw err;
}
function check(cond, msg) {
    if (!cond) fail(msg);
    log('PASS: ' + msg);
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

function calledColumnStock(winNum) {
    const called = [];
    for (let col = 0; col < 5; col++) {
        for (let i = 1; i <= 6; i++) {
            const n = col * 15 + i;
            if (n !== winNum) called.push(n);
        }
    }
    called.push(winNum);
    return called;
}

function persistClosed(ticket, player) {
    return {
        phone: String(player.phone || ''),
        isBot: !!player.isBot,
        ticketId: Number(ticket.id),
        status: ticket.isClosed ? 'won' : (ticket.status || 'active'),
        isClosed: !!ticket.isClosed,
        marks: ticket.marks || ticket.marksObj || null,
        grid: ticket.grid
    };
}

function assertBotClosed(ticket, called, label) {
    check(ticket.isClosed === true, label + ' isClosed=true');
    check(ticket.status === 'won', label + ' status=won');
    check(Array.isArray(ticket.marks) && ticket.marks.length === 5, label + ' marks grid saved');
    check(ticket.marks[2][2] === 1, label + ' free center is marked');
    const marked = engine.markedCalledNumbers(ticket, called);
    check(marked.length > 0, label + ' called numbers are dabbed (' + marked.length + ' cells)');
    check(engine.markedCardCompletes(ticket, called), label + ' dabbed pattern is a real bingo');
    const saved = persistClosed(ticket, { phone: 'bot', isBot: true });
    check(saved.isClosed === true && saved.marks && saved.status === 'won', label + ' persist payload keeps marks and isClosed');
    log('  saved ' + JSON.stringify({ ticketId: saved.ticketId, isClosed: saved.isClosed, status: saved.status, marked: marked.slice(0, 6) }));
}

function section(title) {
    log('');
    log('== ' + title + ' ==');
}

function verifyScope() {
    section('No unintended changes');
    const diff = execSync('git diff --name-only origin/main...HEAD', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    log('files changed vs main: ' + diff.join(', '));
    const allowed = new Set([
        'game/eligibility.js',
        'game/gameEngine.test.js',
        'game/roundPacing.js',
        'game/winValidation.js',
        'game/roundTiming.sim.js',
        'game/liveVerify.sim.js',
        'package.json',
        'server.js'
    ]);
    diff.forEach((file) => {
        check(allowed.has(file), 'change stays in the draw-timing scope: ' + file);
    });
    ['public/index.html', 'publicindex.html', 'cooldownManager.js', 'game/commission.js', 'game/roundCards.js'].forEach((file) => {
        check(diff.indexOf(file) === -1, file + ' was not edited');
    });

    const one = engine.bookCardPurchase(1, 10);
    const two = engine.bookCardPurchase(2, 10);
    check(one.feePerTicket === 2 && one.netPerTicket === 8 && one.gross === 10, 'ticket purchase still books 2 ETB fee and 8 ETB pool');
    check(two.totalFee === 4 && two.totalNet === 16 && two.refundPerTicket === 10, 'two-card purchase and full-price refund are unchanged');
    log('  purchase ' + JSON.stringify(one));

    const ledger = engine.createRoundCardLedger();
    const gameId = 4401;
    const botPurchase = engine.bookCardPurchase(1, 10);
    const botGrid = engine.generateFixedCard(88, 3);
    const seat = ledger.tryReserve(gameId, 88, '0913000001');
    ledger.freezeGrid(gameId, 88, botGrid);
    const stolen = ledger.tryReserve(gameId, 88, '0913000002');
    check(seat.ok === true && stolen.ok === false && stolen.reason === 'TAKEN', 'bot seating reserves a card and a second player cannot take it');
    check(botPurchase.totalNet === 8, 'seated bot is charged with the same purchase split');
    check(JSON.stringify(ledger.getGrid(gameId, 88)) === JSON.stringify(botGrid), 'seated bot grid stays the frozen purchase');

    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const sharedAt = html.indexOf('በጋራ ሲያሸንፉ ቦክሱ እና ስም ዝርዝሩ ብቻ ይታያል');
    const sharedBranch = html.slice(sharedAt, sharedAt + 900);
    check(sharedAt !== -1, 'tie screen still has the shared-win branch');
    check(sharedBranch.indexOf('renderSplitBotKartelas') === -1, 'tie screen renders the winners list only');
    check(sharedBranch.indexOf('win-ticket-display') === -1, 'tie screen does not render a card grid');
    check(html.indexOf('function renderSplitBotKartelas') !== -1, 'solo and admin card helpers are still present');

    const punished = { phone: '0911220000', isBot: false, hasDeposited: true, realBetAmount: 10 };
    const coolCtx = { allowBonusWin: true, activeCooldowns: { '0911220000': 41 }, timeBans: {}, now: Date.now() };
    check(engine.isRestrictedFromWinning(punished, coolCtx) === true, 'a player on cooldown is still blocked from a solo payout');
    check(cooldown.penaltyKindForWinners(1) === 'solo', 'solo cooldown kind is unchanged');
    check(cooldown.penaltyKindForWinners(5) === 'shared', 'five-winner cooldown kind is unchanged');

    const cooldowns = { '0911220000': 41, '0911999999': 8 };
    const seated = { '0911220000': { isBot: false } };
    Object.keys(cooldowns).forEach((phone) => {
        if (!seated[phone]) return;
        if (cooldowns[phone] > 0) cooldowns[phone] -= 1;
        if (cooldowns[phone] <= 0) delete cooldowns[phone];
    });
    check(cooldowns['0911220000'] === 40, 'round reset decrements a seated cooldown 41 -> 40');
    check(cooldowns['0911999999'] === 8, 'round reset does not decrement a player who was not seated');

    const round = {
        gameState: 'FINISHED',
        calledNumbers: [1, 2, 3],
        activePlayers: { a: {} },
        dynamicWinTurn: 18,
        roundForceWinner: 'real',
        gameId
    };
    ledger.clearRound(round.gameId);
    round.gameState = 'WAITING';
    round.calledNumbers = [];
    round.activePlayers = {};
    round.dynamicWinTurn = null;
    round.roundForceWinner = null;
    round.gameId = 4402;
    check(round.gameState === 'WAITING' && round.calledNumbers.length === 0, 'round reset returns to waiting and clears the called balls');
    check(round.dynamicWinTurn == null && round.roundForceWinner == null, 'round reset clears the finish call and the locked winner profile');
    check(ledger.getGrid(gameId, 88) == null, 'round reset drops the previous card ledger');
    log('  reset gameId ' + gameId + ' -> ' + round.gameId);
}

function verifyAlternation() {
    section('Dynamic winner alternation');
    const report = runTimingSimulation();
    log(report.summary);
    const ends = report.rounds.map((r) => r.endCall);
    const unique = Array.from(new Set(ends));
    check(ends.every((n) => n >= 14 && n <= 23), 'every live round ended between call 14 and call 23');
    check(unique.length >= 8, 'finish calls spread across the window (' + unique.sort((a, b) => a - b).join(', ') + ')');
    check(ends.some((n, i) => i > 0 && n !== ends[i - 1]), 'back-to-back rounds do not stick to one call');
    report.rounds.forEach((round, i) => {
        log('  round ' + (i + 1) + ' ' + round.profile + ' scheduled=' + round.finishCall + ' ended=' + round.endCall + ' winners=' + round.winners + ' plan=' + round.plan);
        check(round.endCall === round.finishCall, round.profile + ' closed on its scheduled call ' + round.finishCall);
        if (round.profile === 'depositor' || round.profile === 'bonus' || round.profile === 'bot') {
            check(round.winners === 1, round.profile + ' stayed a pure solo round');
        }
        if (round.profile === 'mixed') {
            check(round.winners >= 2 && round.winners <= 5, 'shared round paid ' + round.winners + ' winners');
        }
    });
    const byProfile = {};
    report.rounds.forEach((round) => {
        if (!byProfile[round.profile]) byProfile[round.profile] = [];
        byProfile[round.profile].push(round.endCall);
    });
    log('  calls by profile ' + JSON.stringify(byProfile));
    check(new Set(byProfile.depositor).size > 1, 'pure depositor wins land on more than one call');
    check(new Set(byProfile.bot).size > 1, 'bot wins land on more than one call');
    check(new Set(byProfile.mixed).size > 1, 'shared wins land on more than one call');
    check(new Set(byProfile.bonus).size > 1, 'bonus-user wins land on more than one call');
}

function verifyNormalVaultAndSharedCards() {
    section('Normal rounds, vault floor, shared bot cards');
    const funded = engine.settleWinnerVault(
        { virtualPrizePool: 40, vaultTwoBalance: 200, vaultThreeBalance: 30 },
        { realMoneyOut: 80, isWinnerDepositor: true, realWinnersCount: 1, botWinnersCount: 0, totalWinners: 1, allowNegative: false }
    );
    log('  solo depositor vaultTwo 200 - 80 = ' + funded.balances.vaultTwoBalance + ' charged=' + funded.charged);
    check(funded.charged === 'vaultTwoBalance' && funded.balances.vaultTwoBalance === 120, 'funded solo depositor pays from vault two');
    check(funded.balances.virtualPrizePool >= 0 && funded.balances.vaultTwoBalance >= 0 && funded.balances.vaultThreeBalance >= 0, 'funded normal round stays at or above zero');

    const tight = engine.settleWinnerVault(
        { virtualPrizePool: 15, vaultTwoBalance: 10, vaultThreeBalance: 6 },
        { realMoneyOut: 80, isWinnerDepositor: true, realWinnersCount: 1, botWinnersCount: 0, totalWinners: 1, allowNegative: false }
    );
    log('  underfunded normal virtual ' + tight.balances.virtualPrizePool + ' vaultTwo ' + tight.balances.vaultTwoBalance + ' vaultThree ' + tight.balances.vaultThreeBalance);
    check(tight.balances.virtualPrizePool === 0 && tight.balances.vaultTwoBalance === 10 && tight.balances.vaultThreeBalance === 6, 'underfunded normal round clamps at zero');

    const sharedPrize = 90;
    const sharedSplit = engine.computeEvenSplit(sharedPrize, 2);
    const sharedVault = engine.settleWinnerVault(
        { virtualPrizePool: 40, vaultTwoBalance: 200, vaultThreeBalance: 50 },
        { realMoneyOut: sharedSplit, isWinnerDepositor: true, realWinnersCount: 1, botWinnersCount: 1, totalWinners: 2, allowNegative: false }
    );
    log('  normal shared user share ' + sharedSplit + ' vaultThree ' + sharedVault.balances.vaultThreeBalance);
    check(sharedVault.charged === 'vaultThreeBalance' && sharedVault.balances.vaultThreeBalance === 5, 'normal one-and-one depositor split charges vault three the user share only');
    check(sharedVault.balances.vaultThreeBalance >= 0, 'normal shared vault does not go negative');

    const called = [1, 16, 31, 46, 2, 17, 33, 47, 61];
    const bot = {
        phone: 'bot-shared',
        isBot: true,
        ticketsData: [{
            id: 88,
            status: 'active',
            isClosed: false,
            grid: [
                [2, 17, 33, 47, 61],
                [3, 18, 34, 48, 62],
                [4, 19, 'FREE', 49, 63],
                [5, 20, 35, 50, 64],
                [6, 21, 36, 51, 65]
            ]
        }]
    };
    const before = JSON.parse(JSON.stringify(bot.ticketsData[0].grid));
    check(engine.closeWinningTicket(bot.ticketsData[0], called) === true, 'normal shared bot card closes on the called ball');
    check(JSON.stringify(bot.ticketsData[0].grid) === JSON.stringify(before), 'normal shared bot card keeps its purchased numbers');
    assertBotClosed(bot.ticketsData[0], called, 'normal shared bot');
}

function verifyEmergency() {
    section('Emergency panic shield');
    const outsider = {
        phone: '0911555000',
        name: 'Unintended',
        isBot: false,
        hasDeposited: true,
        realBetAmount: 10,
        ticketsData: [{ id: 12, grid: rowGrid(), status: 'active', isClosed: false }]
    };
    const almost = [1, 2, 3, 4];
    check(engine.checkBingo(outsider.ticketsData[0].grid, almost) === false, 'unintended card is one number short');
    check(engine.checkBingo(outsider.ticketsData[0].grid, almost.concat([5])) === true, 'ball 5 would complete the unintended card');
    const blockedCtx = { allowBonusWin: true, activeCooldowns: { '0911555000': 12 }, timeBans: {}, now: Date.now() };
    check(engine.isRestrictedFromWinning(outsider, blockedCtx) === true, 'the completing player is restricted');

    const safeChoice = engine.chooseDrawnBall({
        currentTurn: 11,
        finishCall: 18,
        forceWinner: 'mix_dep',
        botCount: 0,
        called: almost,
        pool: [5, 22, 23, 24, 40, 41],
        targetPlayers: [{ phone: 'dep', isBot: false, hasDeposited: true, ticketsData: [{ id: 30, grid: engine.generateFixedCard(30, 4) }] }],
        botPlayers: [{ phone: 'b', isBot: true, ticketsData: [{ id: 31, grid: engine.generateFixedCard(31, 4) }] }],
        others: [outsider],
        completing: [5],
        blockedCompleting: [5],
        fourCorner: [],
        botCompleting: [],
        userCompleting: [5]
    });
    log('  while other balls remain, draw plan=' + safeChoice.plan + ' num=' + safeChoice.num);
    check(safeChoice.num !== 5 && safeChoice.plan !== 'emergency', 'the shielded draw does not hand the completing ball to the unintended player');

    const panic = engine.chooseDrawnBall({
        currentTurn: 12,
        finishCall: 18,
        forceWinner: 'real',
        botCount: 0,
        called: almost,
        pool: [5],
        targetPlayers: [],
        botPlayers: [],
        others: [outsider],
        completing: [5],
        blockedCompleting: [5],
        fourCorner: []
    });
    log('  no safe ball left, draw plan=' + panic.plan + ' num=' + panic.num);
    check(panic.plan === 'emergency' && panic.num === 5, 'the panic shield fires when the unintended line is the only ball left');

    const called = almost.concat([5]);
    const human = { player: outsider, ticket: outsider.ticketsData[0], authenticClose: true };
    check(engine.closeWinningTicket(human.ticket, called) === true, 'unintended card closes on its own numbers');
    const humanSnap = JSON.stringify(rowGrid());
    check(JSON.stringify(human.ticket.grid) === humanSnap, 'emergency does not rewrite the purchased human grid');

    const winners = [human];
    const seen = new Set([12]);
    const bots = [];
    for (let i = 0; i < 6; i++) {
        const grid = engine.generateFixedCard(500 + i, 11);
        bots.push({
            phone: 'panic-bot-' + i,
            name: 'Panic ' + i,
            isBot: true,
            ticketsData: [{ id: 500 + i, grid, status: 'active', isClosed: false }]
        });
    }
    const stock = calledColumnStock(5);
    let injected = 0;
    for (let i = 0; i < 4 && winners.length < 5; i++) {
        const bot = bots.pop();
        const ticket = bot.ticketsData[0];
        if (seen.has(ticket.id)) continue;
        seen.add(ticket.id);
        const dealt = JSON.parse(JSON.stringify(ticket.grid));
        const sealed = engine.closeBotKartela(ticket.grid, stock, 5);
        check(sealed === ticket.grid, 'panic close does not replace bot ' + ticket.id);
        check(JSON.stringify(ticket.grid) === JSON.stringify(dealt), 'panic bot ' + ticket.id + ' keeps purchased cells');
        check(engine.gridColumnsAreUnique(ticket.grid), 'panic bot ' + ticket.id + ' stays column-unique');
        const completed = engine.checkBingo(ticket.grid, stock);
        const closed = engine.closeWinningTicket(ticket, stock);
        check(closed === completed, 'panic bot ' + ticket.id + ' is marked won only when its own numbers complete');
        winners.push({ player: bot, ticket, syntheticClose: true });
        injected += 1;
    }
    log('  injected bots=' + injected + ' list before cap=' + winners.length);
    const capped = engine.capWinnerList(winners, 5);
    log('  winners after cap=' + capped.length + ' phones=' + capped.map((w) => w.player.phone).join(','));
    check(injected === 4, 'panic injects four bots immediately');
    check(capped.length === 5, 'panic split pays 5 winners');
    check(capped.filter((w) => w.player.isBot).length === 4, 'four of the five shares are bots');
    check(capped[0].player.phone === outsider.phone, 'the unintended real winner is kept');

    const prize = 100;
    const userShare = engine.computeEvenSplit(prize, capped.length);
    const realMoneyOut = userShare;
    log('  prize=' + prize + ' winners=' + capped.length + ' userSplit=' + userShare + ' vaultCharge=' + realMoneyOut);
    check(userShare === 20 && realMoneyOut === 20, 'the user is paid one split share, and the vault is charged that share');

    const before = { virtualPrizePool: 8, vaultTwoBalance: 12, vaultThreeBalance: 4 };
    const emergency = engine.settleWinnerVault(before, {
        realMoneyOut,
        isWinnerDepositor: true,
        realWinnersCount: 1,
        botWinnersCount: 4,
        totalWinners: 5,
        allowNegative: true
    });
    log('  emergency vault virtual ' + before.virtualPrizePool + ' -> ' + emergency.balances.virtualPrizePool + ' charged=' + emergency.charged);
    check(emergency.charged === 'virtualPrizePool', 'a five-way depositor panic charges the virtual vault');
    check(emergency.balances.virtualPrizePool === -12, 'insufficient vault accepts the negative balance 8 - 20 = -12');
    check(emergency.balances.vaultTwoBalance === 12 && emergency.balances.vaultThreeBalance === 4, 'the panic does not move the other vaults');

    capped.filter((w) => w.player.isBot).forEach((winner) => {
        const ticket = winner.ticket;
        if (engine.checkBingo(ticket.grid, stock)) {
            assertBotClosed(ticket, stock, 'emergency bot ' + ticket.id);
        } else {
            check(ticket.isClosed !== true, 'emergency bot ' + ticket.id + ' was not marked won on a dealt card');
            check(engine.gridColumnsAreUnique(ticket.grid), 'emergency bot ' + ticket.id + ' history grid stays column-unique');
            const saved = persistClosed(ticket, { phone: 'bot', isBot: true });
            check(JSON.stringify(saved.grid) === JSON.stringify(ticket.grid), 'emergency bot ' + ticket.id + ' persist keeps the dealt grid');
        }
    });
}

function main() {
    log('live round verification');
    verifyScope();
    verifyAlternation();
    verifyNormalVaultAndSharedCards();
    verifyEmergency();
    log('');
    log('ALL CHECKS PASSED');
}

try {
    main();
} catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
}
