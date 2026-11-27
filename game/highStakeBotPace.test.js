'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const engine = require('./index');

function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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

const boardStarted = process.hrtime.bigint();
const board = engine.createCardBoard(engine.TOTAL_CARDS);
for (let i = 1; i <= 420; i++) board.markTaken(i, 'p' + (i % 80));
let hits = 0;
for (let n = 0; n < 50000; n++) {
    const id = (n % engine.TOTAL_CARDS) + 1;
    if (board.isTaken(id)) hits++;
    board.ownerOf(id);
}
assert.strictEqual(board.freeCount(), engine.TOTAL_CARDS - 420);
let pulled = 0;
while (board.takeRandomFree() != null) pulled++;
const boardMs = Number(process.hrtime.bigint() - boardStarted) / 1e6;
assert.strictEqual(board.takenCount(), 420);
assert.strictEqual(pulled, engine.TOTAL_CARDS - 420);
assert.strictEqual(board.freeCount(), 0);
assert.ok(hits > 20000);
assert.ok(boardMs < 200, 'high-stake board work took ' + boardMs.toFixed(1) + 'ms');
board.markFree(12);
assert.strictEqual(board.isTaken(12), false);
assert.strictEqual(board.ownerOf(12), null);
assert.strictEqual(board.freeCount(), 1);
assert.strictEqual(board.takeRandomFree(), 12);

const wide = assertSchedule(7, Array(40).fill(2), 35000);
const starts = wide.filter((step) => step.cardIndex === 0).map((step) => step.delayMs);
assert.ok(new Set(starts).size > 15, 'bot start times are still synchronized');
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

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const gridStart = html.indexOf('    function cardButtonList()');
const gridEnd = html.indexOf("    socket.on('game_status'");
const gridSrc = html.slice(gridStart, gridEnd);
assert.ok(gridSrc.includes('function renderGridTakenStates'));
assert.ok(gridSrc.includes('takenLookup'));
assert.ok(gridSrc.includes('btn.className !== nextClass'));
assert.ok(!gridSrc.includes('.includes('));
assert.ok(!/btn\.innerText\s*=/.test(gridSrc));
assert.ok(html.includes('function sameTakenIds'));
assert.ok(html.includes('data.takenCount'));

function paintBoard(takenIds) {
    const stats = { classWrites: 0, textWrites: 0 };
    const buttons = [];
    for (let i = 1; i <= 700; i++) {
        const btn = {
            _cardNum: i,
            _class: 'num-btn',
            _text: String(i),
            getAttribute(attr) { return attr === 'data-num' ? String(i) : null; }
        };
        Object.defineProperty(btn, 'className', {
            get() { return this._class; },
            set(value) { stats.classWrites += 1; this._class = value; }
        });
        Object.defineProperty(btn, 'textContent', {
            get() { return this._text; },
            set(value) { stats.textWrites += 1; this._text = value; }
        });
        buttons.push(btn);
    }
    const run = new Function('stats', 'buttons', 'takenIds', `
        let cardButtons = buttons;
        let takenLookup = new Set();
        let globalTakenTickets = takenIds.slice();
        let userTicketsData = [{ id: 12 }];
        function renderOccupiedCards() {}
        ${gridSrc}
        renderGridTakenStates();
        const firstWrites = stats.classWrites;
        renderGridTakenStates();
        const secondWrites = stats.classWrites - firstWrites;
        globalTakenTickets = takenIds.filter(function (id) { return id !== 50; }).concat([600]);
        const beforeSwap = stats.classWrites;
        renderGridTakenStates();
        return {
            firstWrites: firstWrites,
            secondWrites: secondWrites,
            swapWrites: stats.classWrites - beforeSwap,
            textWrites: stats.textWrites,
            mine: buttons[11].className,
            freed: buttons[49].className,
            gained: buttons[599].className,
            untouched: buttons[699].className
        };
    `);
    return run(stats, buttons, takenIds);
}

const taken = [];
for (let i = 1; i <= 420; i++) taken.push(i);
const painted = paintBoard(taken);
assert.strictEqual(painted.firstWrites, 420, 'first paint should touch only occupied cards');
assert.strictEqual(painted.secondWrites, 0, 'an unchanged board should not rewrite buttons');
assert.strictEqual(painted.swapWrites, 2, 'a same-length swap should update only the two cards that moved');
assert.strictEqual(painted.textWrites, 0);
assert.strictEqual(painted.mine, 'num-btn bought-by-me');
assert.strictEqual(painted.freed, 'num-btn');
assert.strictEqual(painted.gained, 'num-btn taken');
assert.strictEqual(painted.untouched, 'num-btn');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const unavailableStart = server.indexOf('function cardUnavailable');
const unavailable = server.slice(unavailableStart, server.indexOf('function countFreeCardIds'));
assert.ok(unavailable.includes('cardBoard.ownerOf'));
assert.ok(!unavailable.includes('globalTakenTickets.some'));
assert.ok(!unavailable.includes('seatedOwnerOfTicket('));
assert.ok(server.includes('function seatOneBotCard'));
assert.ok(server.includes('bookCardPurchase(1'));
assert.ok(server.includes('planHumanBotCardDelays'));
assert.ok(server.includes('armHumanBotPurchases();'));
assert.ok(server.includes('flushUnfiredBotCards();'));
assert.ok(!server.includes('botsToReleaseThisTick'));
assert.ok(server.includes('takenCount: globalTakenTickets.length'));

const renameStart = server.indexOf("app.post('/api/admin/bots-rename-all'");
const renameEnd = server.indexOf("app.post('/api/admin/delete-bot'");
const rename = server.slice(renameStart, renameEnd);
assert.ok(rename.includes('planUniqueInactiveRenames'));
assert.ok(rename.includes('applyBotUsernameStyles'));
assert.ok(rename.includes('styleAt: req.body.styleAt === true'));
assert.ok(rename.includes('styleCaps: req.body.styleCaps === true'));
assert.ok(rename.includes('styleHyphen: req.body.styleHyphen === true'));
assert.ok(rename.includes('collectInactiveUserNames'));
assert.ok(rename.includes("$nin: ['banned', 'Banned', 'BANNED', 'deleted', 'Deleted', 'DELETED', 'disabled', 'Disabled', 'DISABLED']"));
assert.ok(rename.includes("status: { $in: ['inactive', 'Inactive', 'INACTIVE', 'idle', 'Idle', 'IDLE'] }"));
assert.ok(rename.includes('lastActive: { $lt: idleBefore }'));
assert.ok(!rename.includes("$nin: ['active', 'Active', 'ACTIVE']"));

const idleNow = new Date('2026-11-16T00:00:00.000Z').getTime();
const justShort = new Date(idleNow - engine.INACTIVE_PLAYER_IDLE_MS + 1);
const justIdle = new Date(idleNow - engine.INACTIVE_PLAYER_IDLE_MS);
assert.deepStrictEqual(engine.collectInactiveUserNames([
    { name: 'Marta', status: 'banned', lastActive: justIdle },
    { name: 'Gone', status: 'deleted', lastActive: justIdle },
    { name: 'Recent', status: 'active', lastActive: justShort },
    { name: 'Quiet', status: 'active', lastActive: justIdle },
    { name: 'Helen', status: 'inactive', lastActive: justShort },
    { name: 'Sami', status: 'idle', lastActive: justShort }
], idleNow), ['Quiet', 'Helen', 'Sami']);
assert.ok(!rename.includes('planInactiveBotRenames'));
assert.ok(!/(^|[^A-Za-z])User\.update/.test(rename));
assert.ok(!/(^|[^A-Za-z])User\.bulkWrite/.test(rename));
assert.ok(rename.includes('BotUser.bulkWrite'));

const admin = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
assert.ok(admin.includes('id="bot-style-at"'));
assert.ok(admin.includes('id="bot-style-caps"'));
assert.ok(admin.includes('id="bot-style-hyphen"'));
const renameUi = admin.slice(admin.indexOf('async function randomizeAllBotNames'), admin.indexOf('async function deleteBot'));
assert.ok(renameUi.includes('search: search'));
assert.ok(renameUi.includes('await loadBotDB(1)'));
assert.ok(renameUi.includes('styleAt: styleAt'));
assert.ok(renameUi.includes('styleCaps: styleCaps'));
assert.ok(renameUi.includes('styleHyphen: styleHyphen'));

function poolNames(count) {
    const names = [];
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    for (let a = 0; a < 26 && names.length < count; a++) {
        for (let b = 0; b < 26 && names.length < count; b++) {
            names.push('Na' + alphabet[a] + alphabet[b] + 'el');
        }
    }
    return names;
}

function renameBatch(style, reserved) {
    const words = poolNames(110);
    const player = {
        _id: 'player-1',
        name: 'RealPerson',
        password: 'secret',
        status: 'active',
        mainBalance: 80,
        playBalance: 12,
        telegramId: 'tg-1'
    };
    const playerBefore = JSON.stringify(player);
    const now = new Date('2026-11-16T00:00:00.000Z').getTime();
    const idleAt = new Date(now - engine.INACTIVE_PLAYER_IDLE_MS - 1000);
    const recentAt = new Date(now - 2 * 24 * 60 * 60 * 1000);
    const activeUser = { name: 'ActiveSara', status: 'active', password: 'secret', mainBalance: 40, playBalance: 9, lastActive: recentAt };
    const users = [
        { name: 'Marta', status: 'banned', mainBalance: 0, lastActive: idleAt },
        { name: 'Helen', status: 'inactive', playBalance: 3, lastActive: recentAt },
        { name: 'Gone', status: 'deleted', lastActive: idleAt },
        { name: 'Blocked', status: 'disabled', lastActive: idleAt }
    ];
    for (let i = 0; i < words.length; i++) {
        users.push({ name: words[i], status: 'inactive', lastActive: recentAt });
    }
    users.push(activeUser);
    users.push({ name: 'QuietAbebe', status: 'active', password: 'secret', lastActive: idleAt });
    const pool = engine.collectInactiveUserNames(users, now);
    assert.ok(pool.indexOf('Marta') === -1);
    assert.ok(pool.indexOf('Gone') === -1);
    assert.ok(pool.indexOf('Blocked') === -1);
    assert.ok(pool.indexOf('Helen') !== -1);
    assert.ok(pool.indexOf('QuietAbebe') !== -1);
    assert.ok(pool.indexOf('ActiveSara') === -1);
    const bots = [];
    for (let i = 0; i < 100; i++) bots.push({ _id: 'bot-' + i, name: 'Old' + words[i], isActive: true });
    const planned = engine.planUniqueInactiveRenames(bots.concat([player]), {
        pool: pool,
        reserved: reserved || []
    });
    assert.strictEqual(JSON.stringify(player), playerBefore);
    assert.ok(!planned.updates.some((row) => String(row._id) === 'player-1'));
    const result = engine.applyBotUsernameStyles(planned.updates, {
        styleAt: style.at === true,
        styleCaps: style.caps === true,
        styleHyphen: style.hyphen === true,
        reserved: reserved || [],
        rng: mulberry32(style.seed || 4)
    });
    const keys = new Set();
    (reserved || []).forEach((name) => keys.add(engine.botNameKey(name)));
    const seenStyles = { at: 0, caps: 0, hyphen: 0 };
    planned.updates.forEach((row) => {
        const key = engine.botNameKey(row.name);
        assert.ok(key && !keys.has(key), 'duplicate name ' + row.name);
        keys.add(key);
        assert.ok(engine.styledNameUsesPool(row.name, pool), row.name + ' is not an inactive-user name');
        assert.ok(engine.botNameKey(row.name) !== engine.botNameKey('ActiveSara'));
        assert.ok(engine.botNameKey(row.name) !== engine.botNameKey('RealPerson'));
        if (row.nameStyle) seenStyles[row.nameStyle] += 1;
        else assert.ok(pool.some((name) => name === row.name), row.name + ' was changed without a style');
    });
    return { result: result, styles: seenStyles, updates: planned.updates };
}

const plain = renameBatch({ at: false, caps: false, hyphen: false, seed: 2 });
assert.strictEqual(plain.result.styled, 0);
assert.strictEqual(plain.styles.at + plain.styles.caps + plain.styles.hyphen, 0);

const allStyles = renameBatch({ at: true, caps: true, hyphen: true, seed: 9 }, ['Heldname', '@Naael', 'Naa-el']);
const expectedStyled = Math.round(allStyles.updates.length * engine.BOT_USERNAME_STYLE_SHARE);
assert.strictEqual(allStyles.updates.length, 100);
assert.strictEqual(expectedStyled, 10);
assert.strictEqual(allStyles.result.styled, 10);
assert.strictEqual(allStyles.styles.at + allStyles.styles.caps + allStyles.styles.hyphen, 10);
assert.ok(allStyles.styles.at > 0 && allStyles.styles.caps > 0 && allStyles.styles.hyphen > 0);
assert.ok(!allStyles.updates.some((row) => row.name === '@Naael' || row.name === 'Naa-el' || engine.botNameKey(row.name) === 'heldname'));

const onlyAt = renameBatch({ at: true, caps: false, hyphen: false, seed: 5 });
assert.strictEqual(onlyAt.result.styled, 10);
assert.strictEqual(onlyAt.styles.at, 10);
assert.strictEqual(onlyAt.styles.caps, 0);
assert.strictEqual(onlyAt.styles.hyphen, 0);
onlyAt.updates.forEach((row) => {
    if (row.nameStyle === 'at') assert.strictEqual(row.name.charAt(0), '@');
});

const onlyCaps = renameBatch({ at: false, caps: true, hyphen: false, seed: 6 });
assert.strictEqual(onlyCaps.result.styled, 10);
assert.strictEqual(onlyCaps.styles.caps, 10);
onlyCaps.updates.forEach((row) => {
    if (row.nameStyle === 'caps') assert.strictEqual(row.name, row.name.toUpperCase());
});

const onlyHyphen = renameBatch({ at: false, caps: false, hyphen: true, seed: 7 });
assert.strictEqual(onlyHyphen.result.styled, 10);
assert.strictEqual(onlyHyphen.styles.hyphen, 10);
onlyHyphen.updates.forEach((row) => {
    if (row.nameStyle === 'hyphen') assert.strictEqual(row.name.indexOf('-'), row.name.lastIndexOf('-'));
});

console.log('high-stake board, bot pace, and username styles passed (' + boardMs.toFixed(1) + 'ms board)');
