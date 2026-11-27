'use strict';

const engine = require('./game');

function cloneGrid(grid) {
    if (!Array.isArray(grid)) return null;
    return grid.map((col) => (Array.isArray(col) ? col.slice() : col));
}

function sameDayKey(record, now) {
    const key = engine.eatDayKey(now);
    return !!(record && record.eatDayKey === key);
}

/**
 * The grid an admin should see is the round's assigned card, dabbed with
 * the numbers that have actually been called. A buy-in copy on the ticket
 * is only a fallback when the round has not frozen a layout yet.
 */
function snapshotLiveTicket(ticket, called, gridOf) {
    if (!ticket) return null;
    let assigned = null;
    if (typeof gridOf === 'function') {
        try { assigned = gridOf(ticket); } catch (err) { assigned = null; }
    }
    const grid = cloneGrid(assigned) || cloneGrid(ticket.grid);
    if (!grid) return null;
    const isClosed = !!(ticket.isClosed || ticket.status === 'won' || ticket.status === 'closed');
    const copy = {
        id: Number(ticket.id),
        grid,
        marks: null,
        marksObj: null,
        isClosed,
        status: isClosed ? 'won' : 'active'
    };
    engine.markCalledNumbersOnTicket(copy, called || []);
    let patternComplete = false;
    try {
        patternComplete = !!engine.markedCardCompletes(copy, called || []);
    } catch (err) {
        patternComplete = false;
    }
    if (isClosed) {
        copy.isClosed = true;
        copy.status = 'won';
    } else if (patternComplete) {
        copy.isClosed = false;
        copy.status = 'pattern';
    }
    const marks = copy.marks || [];
    const markedCells = [];
    for (let c = 0; c < 5; c++) {
        for (let r = 0; r < 5; r++) {
            if (marks[c] && Number(marks[c][r])) {
                markedCells.push({ c, r, value: grid[c] ? grid[c][r] : null });
            }
        }
    }
    return {
        id: copy.id,
        grid: copy.grid,
        marks: copy.marks,
        marksObj: copy.marks,
        markedCells,
        isClosed: !!copy.isClosed,
        status: copy.status || 'active',
        patternComplete
    };
}

function playersForAdmin(players, called, gridOf) {
    return (players || []).filter(Boolean).map((player) => {
        const ticketsData = (player.ticketsData || [])
            .map((ticket) => snapshotLiveTicket(ticket, called, gridOf))
            .filter(Boolean);
        return {
            name: player.name,
            phone: player.phone,
            tickets: Number(player.tickets) || ticketsData.length,
            isBot: !!player.isBot,
            ticketsData
        };
    });
}

function liveRoundForPhone(player, ctx) {
    if (!player || !Array.isArray(player.ticketsData) || !player.ticketsData.length) return null;
    ctx = ctx || {};
    const cards = player.ticketsData
        .map((ticket) => snapshotLiveTicket(ticket, ctx.calledNumbers || [], ctx.gridOf))
        .filter(Boolean);
    if (!cards.length) return null;
    return {
        live: true,
        gameId: ctx.gameId,
        gameState: ctx.gameState || '',
        calledNumbers: (ctx.calledNumbers || []).slice(),
        cards
    };
}

function findLiveSearchMatch(players, search, ctx) {
    const raw = String(search || '').trim();
    if (!raw) return null;
    ctx = ctx || {};
    const asNumber = Number(raw);
    const idSearch = Number.isInteger(asNumber) && String(asNumber) === raw;
    const matched = [];
    (players || []).forEach((player) => {
        if (!player) return;
        const phone = String(player.phone || '');
        const phoneHit = phone.indexOf(raw) !== -1;
        const tickets = player.ticketsData || [];
        const idHit = idSearch && tickets.some((ticket) => Number(ticket && ticket.id) === asNumber);
        if (!phoneHit && !idHit) return;
        const ticketsData = tickets
            .map((ticket) => snapshotLiveTicket(ticket, ctx.calledNumbers || [], ctx.gridOf))
            .filter(Boolean);
        if (!ticketsData.length) return;
        matched.push({
            name: player.name,
            phone,
            tickets: Number(player.tickets) || ticketsData.length,
            isBot: !!player.isBot,
            ticketsData
        });
    });
    if (!matched.length) return null;
    return {
        live: true,
        gameId: ctx.gameId,
        roundId: ctx.gameId,
        gameState: ctx.gameState || '',
        date: ctx.date || new Date().toISOString(),
        calledNumbers: (ctx.calledNumbers || []).slice(),
        ticketPrice: ctx.ticketPrice,
        playersData: matched
    };
}

function decoratePlayedGame(game) {
    if (!game || !Array.isArray(game.playersData)) return game;
    const called = Array.isArray(game.calledNumbers) ? game.calledNumbers : [];
    game.playersData.forEach((player) => {
        if (!player || !Array.isArray(player.ticketsData)) return;
        player.ticketsData = player.ticketsData.map((ticket) => {
            const snap = snapshotLiveTicket(ticket, called, (row) => row && row.grid);
            if (!snap) return ticket;
            return Object.assign({}, ticket, snap);
        });
    });
    return game;
}

function playerFromUser(user, now) {
    const loss = engine.rolloverDailyLoss(user, now);
    const sameDay = sameDayKey(user, now);
    const deposited = Number(user && user.totalDeposited) || 0;
    return {
        phone: String(user && user.phone || ''),
        name: (user && (user.name || user.firstName)) || '',
        isBot: false,
        totalDeposited: deposited,
        totalWithdrawn: Number(user && user.totalWithdrawn) || 0,
        depositTodayEtb: sameDay ? (Number(user.depositTodayEtb) || 0) : 0,
        dailyRealBets: loss.dailyRealBets,
        dailyWins: loss.dailyWins,
        eatDayKey: loss.eatDayKey,
        won: Number(user && user.won) || 0,
        roundsTodayWithoutWin: sameDay ? (Number(user.roundsTodayWithoutWin) || 0) : 0,
        winsToday: sameDay ? (Number(user.winsToday) || 0) : 0,
        hasDeposited: deposited > 0
    };
}

function targetReason(player, ctx) {
    if (engine.meetsDailyLossTarget(player, ctx)) return 'Daily loss target';
    if ((Number(player.depositTodayEtb) || 0) >= engine.LARGE_DAILY_DEPOSIT_ETB) return 'Daily deposit';
    if ((Number(player.totalDeposited) || 0) >= engine.LARGE_LIFETIME_DEPOSIT_ETB) return 'Lifetime deposit';
    return 'Small depositor';
}

/**
 * 60% target group is the large-depositor / daily-loss pool.
 * 40% users are the other eligible standard depositors.
 * Cooldown and bonus-credit players stay out of both lists.
 */
function partitionTargetUsers(users, ctx) {
    ctx = ctx || {};
    const now = ctx.now || Date.now();
    const target60 = [];
    const users40 = [];
    (users || []).forEach((user) => {
        if (!user || user.isBot) return;
        const player = playerFromUser(user, now);
        if (!player.phone) return;
        if (!engine.isTargetPoolBaseEligible(player, ctx)) return;
        const large = engine.isLargeDepositor(player, ctx);
        const row = {
            phone: player.phone,
            name: player.name,
            group: large ? 'target60' : 'users40',
            groupLabel: large ? '60% Target' : '40% Users',
            dailyNetLoss: engine.dailyNetLossOf(player, ctx),
            meetsDailyLossTarget: engine.meetsDailyLossTarget(player, ctx),
            depositTodayEtb: player.depositTodayEtb,
            totalDeposited: player.totalDeposited,
            reason: large ? targetReason(player, ctx) : 'Small depositor'
        };
        if (large) target60.push(row);
        else users40.push(row);
    });
    target60.sort((a, b) => b.dailyNetLoss - a.dailyNetLoss || b.totalDeposited - a.totalDeposited || a.phone.localeCompare(b.phone));
    users40.sort((a, b) => b.totalDeposited - a.totalDeposited || a.phone.localeCompare(b.phone));
    return { target60, users40 };
}

function activePlayerRows(players, ctx) {
    ctx = ctx || {};
    const called = ctx.calledNumbers || [];
    const rows = [];
    (players || []).forEach((player) => {
        if (!player || player.isBot) return;
        const ticketsData = (player.ticketsData || [])
            .map((ticket) => snapshotLiveTicket(ticket, called, ctx.gridOf))
            .filter(Boolean);
        if (!ticketsData.length && !(Number(player.tickets) > 0)) return;
        rows.push({
            phone: String(player.phone || ''),
            name: player.name || '',
            tickets: Number(player.tickets) || ticketsData.length,
            cardIds: ticketsData.map((ticket) => ticket.id).filter(Boolean),
            gameId: ctx.gameId,
            gameState: ctx.gameState || '',
            inCooldown: engine.isPunishedPlayer(String(player.phone || ''), ctx),
            seated: true,
            ticketsData
        });
    });
    rows.sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.phone.localeCompare(b.phone));
    return rows;
}

function attachCooldownSeats(cooldownUsers, activeRows) {
    const byPhone = {};
    (activeRows || []).forEach((row) => { byPhone[row.phone] = row; });
    return (cooldownUsers || []).map((user) => {
        const seat = byPhone[user.phone];
        return Object.assign({}, user, {
            seated: !!seat,
            tickets: seat ? seat.tickets : 0,
            cardIds: seat ? seat.cardIds.slice() : [],
            ticketsData: seat ? seat.ticketsData : [],
            gameId: seat ? seat.gameId : null,
            gameState: seat ? seat.gameState : ''
        });
    });
}

function filterBySearch(rows, search) {
    const query = String(search || '').trim().toLowerCase();
    if (!query) return rows || [];
    return (rows || []).filter((row) => {
        const phone = String(row && row.phone || '').toLowerCase();
        const name = String(row && row.name || '').toLowerCase();
        return phone.indexOf(query) !== -1 || name.indexOf(query) !== -1;
    });
}

function paginateRows(rows, page, pageSize) {
    const list = rows || [];
    const size = Math.min(30, Math.max(1, Number(pageSize) || 15));
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / size) || 1);
    let current = Math.max(1, Number(page) || 1);
    if (current > totalPages) current = totalPages;
    const start = (current - 1) * size;
    return {
        users: list.slice(start, start + size),
        total,
        page: current,
        pageSize: size,
        totalPages
    };
}

module.exports = {
    cloneGrid,
    snapshotLiveTicket,
    playersForAdmin,
    liveRoundForPhone,
    findLiveSearchMatch,
    decoratePlayedGame,
    partitionTargetUsers,
    activePlayerRows,
    attachCooldownSeats,
    filterBySearch,
    paginateRows
};
