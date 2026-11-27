'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('./game');
const view = require('./adminLiveView');

const liveGrid = [
    [1, 2, 3, 4, 5],
    [16, 17, 18, 19, 20],
    [31, 32, 'FREE', 34, 35],
    [46, 47, 48, 49, 50],
    [61, 62, 63, 64, 65]
];
const staleGrid = [
    [9, 9, 9, 9, 9],
    [9, 9, 9, 9, 9],
    [9, 9, 'FREE', 9, 9],
    [9, 9, 9, 9, 9],
    [9, 9, 9, 9, 9]
];

const ticket = { id: 12, grid: staleGrid.map((col) => col.slice()), status: 'active' };
const snap = view.snapshotLiveTicket(ticket, [1, 16, 99], () => liveGrid);
assert.deepStrictEqual(snap.grid, liveGrid, 'admin snapshot uses the live assigned grid');
assert.strictEqual(snap.marks[0][0], 1, 'called number on the live grid is marked');
assert.strictEqual(snap.marks[1][0], 1, 'second called number is marked');
assert.ok(snap.markedCells.some((cell) => cell.value === 1 && cell.c === 0 && cell.r === 0), 'markedCells lists the dabbed live cell');
assert.ok(!snap.markedCells.some((cell) => cell.value === 99), 'a called number absent from the card is not a marked cell');
assert.strictEqual(snap.status, 'active');
assert.strictEqual(snap.isClosed, false);
assert.strictEqual(ticket.grid[0][0], 9, 'snapshot does not rewrite the seated ticket');
assert.ok(!ticket.marks, 'snapshot does not dab the seated ticket');

const closed = view.snapshotLiveTicket({ id: 4, grid: liveGrid, isClosed: true, status: 'won' }, [1], (row) => row.grid);
assert.strictEqual(closed.status, 'won');
assert.strictEqual(closed.isClosed, true);

const player = {
    phone: '0911223344',
    name: 'Abebe',
    isBot: false,
    tickets: 1,
    ticketsData: [{ id: 12, grid: staleGrid.map((col) => col.slice()) }]
};
const match = view.findLiveSearchMatch([player], '0911223344', {
    calledNumbers: [1, 16],
    gameId: 44,
    gameState: 'PLAYING',
    ticketPrice: 10,
    gridOf: () => liveGrid
});
assert.strictEqual(match.live, true);
assert.strictEqual(match.gameId, 44);
assert.deepStrictEqual(match.playersData[0].ticketsData[0].grid, liveGrid);
assert.strictEqual(match.calledNumbers.join(','), '1,16');
assert.strictEqual(view.findLiveSearchMatch([player], '0999', { gridOf: () => liveGrid, calledNumbers: [] }), null);
const byCard = view.findLiveSearchMatch([player], '12', { calledNumbers: [1], gameId: 44, gridOf: () => liveGrid });
assert.strictEqual(byCard.playersData[0].phone, '0911223344');

const round = view.liveRoundForPhone(player, { gameId: 44, gameState: 'PLAYING', calledNumbers: [1], gridOf: () => liveGrid });
assert.strictEqual(round.cards[0].grid[0][0], 1);
assert.strictEqual(round.cards[0].marks[0][0], 1);

const history = {
    calledNumbers: [1, 20],
    playersData: [{ phone: '0911', ticketsData: [{ id: 3, grid: liveGrid.map((col) => col.slice()) }] }]
};
view.decoratePlayedGame(history);
assert.strictEqual(history.playersData[0].ticketsData[0].grid[0][0], 1, 'played grid numbers stay');
assert.strictEqual(history.playersData[0].ticketsData[0].marks[0][0], 1);
assert.strictEqual(history.playersData[0].ticketsData[0].marks[1][4], 1);

const now = Date.UTC(2026, 10, 8, 9, 0, 0);
const today = engine.eatDayKey(now);
const grouped = view.partitionTargetUsers([
    { phone: '0911000001', name: 'Old', totalDeposited: 100, depositTodayEtb: 900, dailyRealBets: 800, dailyWins: 0, eatDayKey: '2000-01-01' },
    { phone: '0911000002', name: 'Big', totalDeposited: 3000, eatDayKey: today },
    { phone: '0911000003', name: 'Loss', totalDeposited: 200, depositTodayEtb: 0, dailyRealBets: 600, dailyWins: 0, eatDayKey: today },
    { phone: '0911000004', name: 'Today', totalDeposited: 200, depositTodayEtb: 500, dailyRealBets: 10, dailyWins: 0, eatDayKey: today },
    { phone: '0911000005', name: 'Ban', totalDeposited: 9000, eatDayKey: today },
    { phone: '0911000006', name: 'Small', totalDeposited: 80, eatDayKey: today }
], { now, activeCooldowns: { '0911000005': 4 }, timeBans: {} });
assert.deepStrictEqual(grouped.target60.map((row) => row.phone), ['0911000003', '0911000004', '0911000002']);
assert.strictEqual(grouped.target60[0].reason, 'Daily loss target');
assert.strictEqual(grouped.target60[0].meetsDailyLossTarget, true);
assert.strictEqual(grouped.target60[1].reason, 'Daily deposit');
assert.strictEqual(grouped.target60[2].reason, 'Lifetime deposit');
assert.deepStrictEqual(grouped.users40.map((row) => row.phone), ['0911000001', '0911000006']);
assert.strictEqual(grouped.users40[0].groupLabel, '40% Users');
assert.strictEqual(grouped.users40[0].depositTodayEtb, 0, 'a previous Ethiopia day does not stay in the target math');
assert.ok(!grouped.target60.concat(grouped.users40).some((row) => row.phone === '0911000005'), 'cooldown users are outside the 60/40 split');

const active = view.activePlayerRows([
    { phone: '0911', name: 'Play', isBot: false, tickets: 1, ticketsData: [{ id: 3, grid: liveGrid }] },
    { phone: '0912', name: 'Botty', isBot: true, tickets: 1, ticketsData: [{ id: 4, grid: liveGrid }] },
    { phone: '0913', name: 'Cool', isBot: false, tickets: 1, ticketsData: [{ id: 5, grid: liveGrid }] }
], { activeCooldowns: { '0913': 4 }, timeBans: {}, now, gameId: 8, gameState: 'PLAYING', calledNumbers: [1], gridOf: (row) => row.grid });
assert.deepStrictEqual(active.map((row) => row.phone), ['0913', '0911']);
assert.strictEqual(active[0].inCooldown, true);
assert.strictEqual(active[0].ticketsData[0].grid[0][0], 1);
const seated = view.attachCooldownSeats([
    { phone: '0913', name: 'Cool', remainingLabel: '2h 0m 0s' },
    { phone: '0914', name: 'Wait', remainingLabel: '1h 0m 0s' }
], active);
assert.strictEqual(seated[0].seated, true);
assert.strictEqual(seated[0].ticketsData.length, 1);
assert.strictEqual(seated[1].seated, false);
assert.deepStrictEqual(seated[1].cardIds, []);

const found = view.filterBySearch(grouped.users40, 'small');
assert.strictEqual(found.length, 1);
assert.strictEqual(found[0].phone, '0911000006');
const many = [];
for (let i = 0; i < 20; i++) many.push({ phone: '09' + i, name: 'U' + i });
const page = view.paginateRows(many, 2, 15);
assert.strictEqual(page.total, 20);
assert.strictEqual(page.page, 2);
assert.strictEqual(page.users.length, 5);
assert.strictEqual(page.totalPages, 2);
assert.strictEqual(view.paginateRows(many, 9, 15).page, 2);
assert.strictEqual(many.length, 20, 'paging does not drop source rows');

const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public/admin.html'), 'utf8');
assert.ok(server.indexOf("require('./adminLiveView')") !== -1);
assert.ok(server.indexOf("'/api/admin/audience'") !== -1);
assert.ok(server.indexOf('liveRound') !== -1);
assert.ok(server.indexOf('findLiveSearchMatch') !== -1);
assert.ok(server.indexOf('if (game && game.live)') !== -1);
assert.ok(html.indexOf('id="tab-target"') !== -1);
assert.ok(html.indexOf('id="tab-activity"') !== -1);
assert.ok(html.indexOf('loadAudience(') !== -1);
assert.ok(html.indexOf('ui-live-grid') !== -1);
assert.ok(html.indexOf('data.live') !== -1);

console.log('ok - admin live view');
