'use strict';

const { formatEatDateTimeExact } = require('./eatTime');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 15;
const ADMIN_DEFAULT_LIMIT = 15;
const ADMIN_MAX_LIMIT = 30;

function parseHistoryLimit(raw) {
    const n = parseInt(raw, 10);
    if (!n || n < 1) return DEFAULT_LIMIT;
    return Math.min(MAX_LIMIT, n);
}

function parseAdminHistoryLimit(raw) {
    const n = parseInt(raw, 10);
    if (!n || n < 1) return ADMIN_DEFAULT_LIMIT;
    return Math.min(ADMIN_MAX_LIMIT, n);
}

function playerHistoryFilter(phone, before) {
    const want = String(phone || '');
    const q = {
        $or: [
            { participantPhones: want },
            { 'playersData.phone': want }
        ]
    };
    if (before) {
        const d = before instanceof Date ? before : new Date(before);
        if (!isNaN(d.getTime())) q.date = { $lt: d };
    }
    return q;
}

function playerHistoryProjection(phone) {
    return {
        gameId: 1,
        roundId: 1,
        date: 1,
        ticketId: 1,
        winnerPhone: 1,
        winnerPhoneList: 1,
        winnerPayout: 1,
        prize: 1,
        calledNumbers: 1,
        playersData: { $elemMatch: { phone: String(phone) } }
    };
}

function adminHistoryListProjection() {
    return {
        gameId: 1,
        date: 1,
        winnerName: 1,
        winnerPhone: 1,
        ticketId: 1,
        prize: 1,
        adminProfit: 1,
        ticketPrice: 1,
        'playersData.phone': 1,
        'playersData.name': 1,
        'playersData.isBot': 1,
        'playersData.tickets': 1,
        'playersData.ticketsData.id': 1
    };
}

function cloneGrid(grid) {
    if (!Array.isArray(grid)) return null;
    return grid.map((col) => (Array.isArray(col) ? col.slice() : col));
}

function cloneMarks(marks) {
    if (!Array.isArray(marks)) return null;
    return marks.map((col) => (Array.isArray(col) ? col.slice() : col));
}

function ticketMarkState(card) {
    if (!card) return { marks: null, isClosed: false, status: '' };
    const marks = cloneMarks(card.marks || card.marksObj);
    const status = card.status ? String(card.status) : '';
    const isClosed = !!(card.isClosed || status === 'won');
    return { marks, isClosed, status: isClosed ? (status || 'won') : status };
}

function cardIdOf(card) {
    const raw = card && (card.ticketId != null ? card.ticketId : card.id);
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * One grid per card id. A snapshot locked at assignment (round entry) wins
 * over a later copy on the player record, so a rewritten winner payload
 * cannot change the numbers for that kartela.
 */
function collectCardSnapshots(playersData, entries) {
    const byId = new Map();

    function put(card, locked) {
        const id = cardIdOf(card);
        const grid = cloneGrid(card && card.grid);
        if (id == null || !grid) return;
        const prev = byId.get(id);
        const state = ticketMarkState(card);
        if (prev && prev.locked && !locked) {
            if (state.marks) {
                prev.marks = state.marks;
                prev.marksObj = state.marks;
            }
            if (state.isClosed) {
                prev.isClosed = true;
                prev.status = state.status || 'won';
            } else if (state.status && !prev.status) {
                prev.status = state.status;
            }
            return;
        }
        byId.set(id, {
            id,
            ticketId: id,
            phone: card.phone != null ? String(card.phone) : (prev ? prev.phone : ''),
            name: card.name != null ? String(card.name) : (prev ? prev.name : ''),
            isBot: card.isBot != null ? !!card.isBot : !!(prev && prev.isBot),
            grid,
            marks: state.marks || (prev && prev.marks) || null,
            marksObj: state.marks || (prev && prev.marks) || null,
            isClosed: state.isClosed || !!(prev && prev.isClosed),
            status: state.status || (prev && prev.status) || (state.isClosed ? 'won' : 'active'),
            locked: !!locked || !!(prev && prev.locked)
        });
    }

    (entries || []).forEach((entry) => {
        if (!entry || entry.status === 'cancelled') return;
        put(entry, true);
    });
    (playersData || []).forEach((player) => {
        (player && player.ticketsData || []).forEach((ticket) => {
            put({
                id: ticket && ticket.id,
                grid: ticket && ticket.grid,
                marks: ticket && (ticket.marks || ticket.marksObj),
                marksObj: ticket && (ticket.marksObj || ticket.marks),
                isClosed: ticket && ticket.isClosed,
                status: ticket && ticket.status,
                phone: player.phone,
                name: player.name,
                isBot: player.isBot
            }, false);
        });
    });

    return Array.from(byId.values()).map((card) => ({
        id: card.id,
        ticketId: card.ticketId,
        phone: card.phone,
        name: card.name,
        isBot: card.isBot,
        grid: card.grid,
        marks: card.marks,
        marksObj: card.marksObj,
        isClosed: !!card.isClosed,
        status: card.status || (card.isClosed ? 'won' : 'active')
    }));
}

/**
 * Admin phone / bet search. The grid saved on the player at the end of the
 * round is the one the line index played (assignedCardGrid). A RoundEntry
 * locked at buy-in, or left behind when a game id is reused, must not
 * replace it or add cards from that older round.
 */
function keepPlayedSearchGrids(game, entries) {
    if (!game) return game;
    const played = new Map();
    const known = new Set();
    (game.playersData || []).forEach((player) => {
        const phone = String(player && player.phone || '');
        (player.ticketsData || []).forEach((ticket) => {
            const id = cardIdOf(ticket);
            if (id == null) return;
            known.add(phone + ':' + id);
            const grid = cloneGrid(ticket && ticket.grid);
            if (grid) played.set(phone + ':' + id, grid);
        });
    });

    (entries || []).forEach((entry) => {
        if (!entry || entry.status === 'cancelled') return;
        const id = cardIdOf(entry);
        if (id == null) return;
        const key = String(entry.phone) + ':' + id;
        if (!known.has(key)) return;
        const ticketOwner = (game.playersData || []).find((player) => String(player && player.phone) === String(entry.phone));
        const ticket = ticketOwner && (ticketOwner.ticketsData || []).find((row) => cardIdOf(row) === id);
        const grid = played.get(key);
        if (ticket && grid) ticket.grid = cloneGrid(grid);
    });
    return game;
}

function applyCardSnapshots(game, entries) {
    if (!game) return game;
    const cards = collectCardSnapshots(game.playersData, entries);
    const byId = new Map(cards.map((card) => [card.id, card]));
    if (!Array.isArray(game.playersData)) game.playersData = [];
    const seen = new Set();

    game.playersData.forEach((player) => {
        (player.ticketsData || []).forEach((ticket) => {
            const id = cardIdOf(ticket);
            const snap = id == null ? null : byId.get(id);
            if (snap) {
                ticket.grid = cloneGrid(snap.grid);
                if (snap.marks) {
                    ticket.marks = cloneMarks(snap.marks);
                    ticket.marksObj = ticket.marks;
                }
                if (snap.isClosed || snap.status === 'won') {
                    ticket.isClosed = true;
                    ticket.status = 'won';
                }
            }
            if (id != null) seen.add(id);
        });
    });

    cards.forEach((card) => {
        if (seen.has(card.id)) return;
        let player = game.playersData.find((p) => String(p && p.phone) === String(card.phone));
        if (!player) {
            player = { phone: card.phone, name: card.name, isBot: !!card.isBot, tickets: 0, ticketsData: [] };
            game.playersData.push(player);
        }
        player.ticketsData = player.ticketsData || [];
        player.ticketsData.push({
            id: card.id,
            grid: cloneGrid(card.grid),
            marks: cloneMarks(card.marks),
            marksObj: cloneMarks(card.marks),
            isClosed: !!card.isClosed,
            status: card.status || (card.isClosed ? 'won' : 'active')
        });
        player.tickets = player.ticketsData.length;
        seen.add(card.id);
    });

    const winIds = winningTicketIdsFromGame(game);
    if (winIds.length && byId.get(winIds[0])) {
        game.winningGrid = cloneGrid(byId.get(winIds[0]).grid);
    }
    game.cards = cards;
    return game;
}

function cardNumbersFromGrid(grid) {
    const nums = [];
    if (!Array.isArray(grid)) return nums;
    for (let c = 0; c < grid.length; c++) {
        const col = grid[c] || [];
        for (let r = 0; r < col.length; r++) {
            if (col[r] !== 'FREE' && col[r] !== 'free') nums.push(Number(col[r]));
        }
    }
    return nums;
}

function winnerListFromGame(g) {
    if (Array.isArray(g && g.winnerPhoneList) && g.winnerPhoneList.length) {
        return g.winnerPhoneList.map(String).map((s) => s.trim()).filter(Boolean);
    }
    return String((g && g.winnerPhone) || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function userWinnerPhones(game) {
    const phones = winnerListFromGame(game);
    const bots = new Set();
    (game && game.playersData || []).forEach((player) => {
        if (player && player.isBot) bots.add(String(player.phone));
    });
    return phones.filter((phone) => !bots.has(String(phone)));
}

function gameHasUserWinner(game) {
    return userWinnerPhones(game).length > 0;
}

/**
 * Admin Winner History "User" view. A row stays when at least one winning
 * phone is not flagged as a bot. Phones with no player record stay, matching
 * the previous user-winner display.
 */
function userWinnerHistoryClause() {
    const phones = {
        $let: {
            vars: { listed: { $ifNull: ['$winnerPhoneList', []] } },
            in: {
                $cond: [
                    { $gt: [{ $size: '$$listed' }, 0] },
                    {
                        $filter: {
                            input: {
                                $map: {
                                    input: '$$listed',
                                    as: 'ph',
                                    in: { $trim: { input: { $toString: '$$ph' } } }
                                }
                            },
                            as: 'ph',
                            cond: { $ne: ['$$ph', ''] }
                        }
                    },
                    {
                        $filter: {
                            input: {
                                $map: {
                                    input: { $split: [{ $ifNull: ['$winnerPhone', ''] }, ','] },
                                    as: 'ph',
                                    in: { $trim: { input: '$$ph' } }
                                }
                            },
                            as: 'ph',
                            cond: { $ne: ['$$ph', ''] }
                        }
                    }
                ]
            }
        }
    };
    const botPhones = {
        $map: {
            input: {
                $filter: {
                    input: { $ifNull: ['$playersData', []] },
                    as: 'p',
                    cond: { $eq: ['$$p.isBot', true] }
                }
            },
            as: 'b',
            in: { $toString: { $ifNull: ['$$b.phone', ''] } }
        }
    };
    return {
        $expr: {
            $gt: [
                {
                    $size: {
                        $filter: {
                            input: phones,
                            as: 'ph',
                            cond: { $not: [{ $in: ['$$ph', botPhones] }] }
                        }
                    }
                },
                0
            ]
        }
    };
}

function winningTicketIdsFromGame(g) {
    return String((g && g.ticketId) || '').split(',').map((s) => Number(String(s).replace(/[^0-9]/g, ''))).filter(Boolean);
}

function historyWinnerCount(g, won) {
    const phones = winnerListFromGame(g);
    if (phones.length) return phones.length;
    const tickets = winningTicketIdsFromGame(g);
    if (tickets.length) return tickets.length;
    return won ? 1 : 0;
}

function historyRoundId(g) {
    const raw = g && g.roundId != null && g.roundId !== '' ? g.roundId : (g && g.gameId);
    const n = Number(raw);
    return Number.isFinite(n) ? n : (raw == null ? null : raw);
}

function cellMarked(val, calledSet) {
    if (val === 'FREE' || val === 'free') return true;
    const n = Number(val);
    return Number.isFinite(n) && calledSet.has(n);
}

function patternGap(grid, cells, calledSet) {
    let missing = 0;
    for (let i = 0; i < cells.length; i++) {
        const col = grid && grid[cells[i][0]];
        const val = col && col[cells[i][1]];
        if (!col || col.length <= cells[i][1]) return null;
        if (!cellMarked(val, calledSet)) missing += 1;
    }
    return missing;
}

function linesNeededForGrid(grid, called) {
    if (!Array.isArray(grid) || grid.length < 5) return null;
    const calledSet = new Set((called || []).map((n) => Number(n)));
    const patterns = [];
    for (let c = 0; c < 5; c++) patterns.push([[c, 0], [c, 1], [c, 2], [c, 3], [c, 4]]);
    for (let r = 0; r < 5; r++) patterns.push([[0, r], [1, r], [2, r], [3, r], [4, r]]);
    patterns.push([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
    patterns.push([[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]]);
    patterns.push([[0, 0], [0, 4], [4, 0], [4, 4]]);
    let best = null;
    patterns.forEach((cells) => {
        const gap = patternGap(grid, cells, calledSet);
        if (gap == null) return;
        if (best == null || gap < best) best = gap;
    });
    return best;
}

function linesNeededForTickets(tickets, called) {
    let best = null;
    (tickets || []).forEach((ticket) => {
        const gap = linesNeededForGrid(ticket && ticket.grid, called);
        if (gap == null) return;
        if (best == null || gap < best) best = gap;
    });
    return best;
}

function historySplitPayout(g, winnerCount) {
    const prize = Number((g && g.prize) || 0);
    const stored = Number((g && g.winnerPayout) || 0);
    const count = Math.max(1, Number(winnerCount) || 1);
    const computed = Number((prize / count).toFixed(2));
    if (count > 1 && stored > 0 && prize > 0 && Math.abs(stored - prize) < 0.011) {
        return computed;
    }
    if (stored > 0) return stored;
    return computed;
}

function shapeHistoryRounds(games, phone) {
    const want = String(phone || '');
    return (games || []).map((g) => {
        const player = (g.playersData || []).find((p) => String(p.phone) === want) || {};
        const tickets = player.ticketsData || [];
        const cardIds = tickets.map((t) => Number(t.id)).filter(Boolean);
        const winnerList = winnerListFromGame(g);
        const winningTicketIds = winningTicketIdsFromGame(g);
        const won = winnerList.some((w) => w === want || w.indexOf(want) !== -1)
            || cardIds.some((id) => winningTicketIds.indexOf(id) !== -1);
        const winnerCount = historyWinnerCount(g, won);
        const cardNumberSet = new Set();
        tickets.forEach((t) => cardNumbersFromGrid(t.grid).forEach((n) => cardNumberSet.add(n)));
        return {
            gameId: g.gameId,
            roundId: historyRoundId(g),
            date: g.date,
            eatDateTime: formatEatDateTimeExact(g.date),
            cardIds,
            calledNumbers: g.calledNumbers || [],
            matchedNumbers: (g.calledNumbers || []).filter((n) => cardNumberSet.has(Number(n))),
            won,
            linesNeeded: linesNeededForTickets(tickets, g.calledNumbers || []),
            winnerCount,
            payout: won ? historySplitPayout(g, winnerCount) : 0,
            prizePool: Number(g.prize || 0)
        };
    });
}

module.exports = {
    DEFAULT_LIMIT,
    MAX_LIMIT,
    ADMIN_DEFAULT_LIMIT,
    ADMIN_MAX_LIMIT,
    parseHistoryLimit,
    parseAdminHistoryLimit,
    playerHistoryFilter,
    playerHistoryProjection,
    adminHistoryListProjection,
    shapeHistoryRounds,
    cloneGrid,
    collectCardSnapshots,
    keepPlayedSearchGrids,
    applyCardSnapshots,
    cardNumbersFromGrid,
    winnerListFromGame,
    userWinnerPhones,
    gameHasUserWinner,
    userWinnerHistoryClause,
    winningTicketIdsFromGame,
    historyWinnerCount,
    historySplitPayout,
    historyRoundId,
    linesNeededForGrid
};
