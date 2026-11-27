'use strict';

function ticketKey(id) {
    return String(Number(id) || id);
}

function cloneTicket(ticket) {
    if (!ticket) return ticket;
    return {
        id: Number(ticket.id),
        grid: Array.isArray(ticket.grid) ? ticket.grid.map((col) => Array.isArray(col) ? col.slice() : col) : ticket.grid,
        paidFromPlay: ticket.paidFromPlay,
        paidFromMain: ticket.paidFromMain,
        paidFromBonus: ticket.paidFromBonus,
        mainWalletBlocked: !!ticket.mainWalletBlocked,
        platformFee: ticket.platformFee,
        netToPool: ticket.netToPool,
        cardFilter: ticket.cardFilter,
        marks: ticket.marks || ticket.marksObj,
        marksObj: ticket.marksObj || ticket.marks,
        isClosed: !!ticket.isClosed,
        status: ticket.status || (ticket.isClosed ? 'won' : 'active')
    };
}

function clonePlayer(player) {
    if (!player) return player;
    return Object.assign({}, player, {
        ticketsData: (player.ticketsData || []).map(cloneTicket)
    });
}

function listParticipatingCards(activePlayers) {
    const cards = [];
    const players = Object.values(activePlayers || {});
    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        if (!player) continue;
        const tickets = player.ticketsData || [];
        for (let t = 0; t < tickets.length; t++) {
            const ticket = tickets[t];
            if (!ticket) continue;
            cards.push({
                phone: player.phone,
                ticketId: Number(ticket.id),
                active: Array.isArray(ticket.grid) && ticket.grid.length === 5,
                isBot: !!player.isBot,
                ticket
            });
        }
    }
    return cards;
}

/**
 * Merge committed round-entry tickets into the in-memory seat map.
 * Never drops a card that already exists; never skips a committed card
 * that is missing from memory (the #504 race).
 */
function hydratePlayersFromEntries(activePlayers, entries, builder) {
    const seated = activePlayers || {};
    const grouped = {};
    (entries || []).forEach((entry) => {
        if (!entry || entry.status === 'cancelled') return;
        const phone = String(entry.phone);
        if (!grouped[phone]) grouped[phone] = [];
        grouped[phone].push(entry);
    });

    const seatByPhone = {};
    Object.keys(seated).forEach((key) => {
        const player = seated[key];
        if (!player) return;
        seatByPhone[String(player.phone || key)] = { key, player };
    });

    Object.keys(grouped).forEach((phone) => {
        const committedTickets = grouped[phone].map((entry) => {
            if (entry.ticket) return cloneTicket(entry.ticket);
            return cloneTicket({
                id: Number(entry.ticketId),
                grid: entry.grid,
                paidFromPlay: entry.paidFromPlay,
                paidFromMain: entry.paidFromMain,
                paidFromBonus: entry.paidFromBonus,
                mainWalletBlocked: !!entry.mainWalletBlocked,
                platformFee: entry.platformFee,
                netToPool: entry.netToPool,
                cardFilter: entry.cardFilter
            });
        });

        const found = seatByPhone[phone];
        if (!found) {
            const built = builder ? builder(phone, committedTickets, grouped[phone]) : null;
            const sample = grouped[phone][0] || {};
            const seat = built || {
                phone,
                name: sample.name || phone,
                isBot: !!sample.isBot,
                ticketsData: committedTickets,
                tickets: committedTickets.length,
                inactive: false,
                bonusBetAmount: committedTickets.reduce((sum, ticket) => sum + (Number(ticket && ticket.paidFromBonus) || 0), 0)
            };
            seat.phone = seat.phone || phone;
            seat.inactive = false;
            seat.ticketsData = committedTickets;
            seat.tickets = committedTickets.length;
            (seat.ticketsData || []).forEach((ticket) => { if (ticket) ticket.inactive = false; });
            seated[phone] = seat;
            return;
        }

        found.player.inactive = false;
        const existing = found.player.ticketsData || [];
        const seen = new Set(existing.map((t) => ticketKey(t && t.id)));
        committedTickets.forEach((ticket) => {
            const key = ticketKey(ticket.id);
            if (seen.has(key)) {
                existing.forEach((t) => {
                    if (ticketKey(t && t.id) === key) t.inactive = false;
                });
                return;
            }
            ticket.inactive = false;
            existing.push(ticket);
            seen.add(key);
        });
        found.player.ticketsData = existing;
        found.player.tickets = existing.length;
    });

    return seated;
}

function snapshotPlayers(activePlayers) {
    const snap = {};
    Object.keys(activePlayers || {}).forEach((phone) => {
        snap[phone] = clonePlayer(activePlayers[phone]);
    });
    return snap;
}

function createRoundRegistry() {
    let pending = 0;
    const queues = {};
    let frozen = false;
    let committedSnapshot = null;

    function beginRegistration() {
        pending += 1;
        let released = false;
        return function endRegistration() {
            if (released) return;
            released = true;
            pending = Math.max(0, pending - 1);
        };
    }

    function hasPending() {
        return pending > 0;
    }

    function pendingCount() {
        return pending;
    }

    function enqueue(phone, fn) {
        if (frozen) {
            return Promise.reject(Object.assign(new Error('ROUND_FROZEN'), { code: 'ROUND_FROZEN' }));
        }
        const key = String(phone || '');
        pending += 1;
        const prev = queues[key] || Promise.resolve();
        const run = prev.then(fn, fn);
        const tracked = run.then((value) => value, (err) => { throw err; }).finally(() => {
            pending = Math.max(0, pending - 1);
            if (queues[key] === tracked) delete queues[key];
        });
        queues[key] = tracked.catch(() => {});
        return tracked;
    }

    function freeze(activePlayers) {
        frozen = true;
        committedSnapshot = snapshotPlayers(activePlayers || {});
        return committedSnapshot;
    }

    function isFrozen() {
        return frozen;
    }

    function getCommittedSnapshot() {
        return committedSnapshot;
    }

    function thaw() {
        frozen = false;
        committedSnapshot = null;
        pending = 0;
    }

    function canAcceptRegistration() {
        return !frozen;
    }

    return {
        beginRegistration,
        hasPending,
        pendingCount,
        enqueue,
        freeze,
        isFrozen,
        getCommittedSnapshot,
        thaw,
        canAcceptRegistration
    };
}

function ticketRoundId(ticket) {
    if (!ticket) return null;
    if (ticket.roundId != null && ticket.roundId !== '') return Number(ticket.roundId);
    if (ticket.gameId != null && ticket.gameId !== '') return Number(ticket.gameId);
    return null;
}

function stampTicketsForRound(tickets, roundId) {
    const round = Number(roundId);
    return (tickets || []).map((ticket) => {
        if (!ticket) return ticket;
        ticket.roundId = round;
        ticket.gameId = round;
        return ticket;
    });
}

function ticketsForActiveRound(tickets, roundId) {
    const round = Number(roundId);
    if (!Number.isFinite(round)) return [];
    return (tickets || []).filter((ticket) => {
        const bound = ticketRoundId(ticket);
        return bound == null || bound === round;
    });
}

function rejectStaleRound(requestRound, activeRound) {
    if (requestRound == null || requestRound === '') return false;
    const requested = Number(requestRound);
    const active = Number(activeRound);
    if (!Number.isFinite(requested) || !Number.isFinite(active)) return true;
    return requested !== active;
}

module.exports = {
    ticketKey,
    cloneTicket,
    clonePlayer,
    listParticipatingCards,
    hydratePlayersFromEntries,
    snapshotPlayers,
    createRoundRegistry,
    ticketRoundId,
    stampTicketsForRound,
    ticketsForActiveRound,
    rejectStaleRound,
    rejectEvalForRound: rejectStaleRound
};
