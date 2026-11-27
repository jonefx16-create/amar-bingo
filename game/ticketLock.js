'use strict';

const PENDING_TTL_MS = 4000;

function normalizeIds(ids) {
    const out = [];
    const seen = new Set();
    (ids || []).forEach((id) => {
        const n = Number(id);
        if (!Number.isInteger(n) || n <= 0 || seen.has(n)) return;
        seen.add(n);
        out.push(n);
    });
    return out;
}

function createTicketLockBoard() {
    const pending = new Map();

    function isPending(id) {
        return pending.has(Number(id));
    }

    function isStale(id, now) {
        const rec = pending.get(Number(id));
        if (!rec) return false;
        const t = now == null ? Date.now() : Number(now);
        return !rec.at || (t - rec.at) > PENDING_TTL_MS;
    }

    function pendingIds() {
        return Array.from(pending.keys());
    }

    function pendingIdsForPhone(phone) {
        const key = String(phone || '');
        const ids = [];
        pending.forEach((rec, id) => {
            if (rec && rec.phone === key) ids.push(id);
        });
        return ids;
    }

    function owner(id) {
        const rec = pending.get(Number(id));
        return rec ? rec.phone : null;
    }

    function tryClaim(ids, phone, now) {
        const nums = normalizeIds(ids);
        if (nums.length === 0) return { ok: false, conflict: null };
        const t = now == null ? Date.now() : Number(now);
        const wantPhone = String(phone);
        // Unconfirmed reservations are never a public "taken" hold. Steal any
        // stale or other-phone pending so an available card is selectable.
        nums.forEach((n) => {
            pending.set(n, { phone: wantPhone, at: t });
        });
        return { ok: true, ids: nums };
    }

    function release(ids, phone) {
        const wantPhone = phone == null ? null : String(phone);
        normalizeIds(ids).forEach((id) => {
            if (wantPhone) {
                const rec = pending.get(id);
                if (!rec || rec.phone !== wantPhone) return;
            }
            pending.delete(id);
        });
    }

    function expireOlderThan(ms, now) {
        const ttl = ms == null ? PENDING_TTL_MS : Number(ms);
        const cutoff = (now == null ? Date.now() : Number(now)) - ttl;
        const dropped = [];
        pending.forEach((rec, id) => {
            if (!rec || rec.at < cutoff) {
                pending.delete(id);
                dropped.push(id);
            }
        });
        return dropped;
    }

    function mergePublicTaken(committedIds) {
        const set = new Set();
        (committedIds || []).forEach((id) => {
            const n = Number(id);
            if (Number.isInteger(n) && n > 0) set.add(n);
        });
        return Array.from(set);
    }

    function clear() {
        pending.clear();
    }

    return {
        isPending,
        isStale,
        pendingIds,
        pendingIdsForPhone,
        owner,
        tryClaim,
        release,
        expireOlderThan,
        mergePublicTaken,
        clear
    };
}

function dropCommittedEntries(cache, ids) {
    const drop = new Set(normalizeIds(ids));
    if (!drop.size) return Array.isArray(cache) ? cache.slice() : [];
    return (cache || []).filter((entry) => {
        const id = Number(entry && (entry.ticketId != null ? entry.ticketId : entry.id));
        return !drop.has(id);
    });
}

function slimLockedTickets(tickets) {
    return (tickets || []).map((t) => {
        const out = {
            id: Number(t && t.id),
            grid: t && t.grid
        };
        if (t && t.marksObj) out.marksObj = t.marksObj;
        return out;
    }).filter((t) => Number.isInteger(t.id) && t.id > 0);
}

function committedLockAck(seated, ids, gameId) {
    const want = normalizeIds(ids);
    if (!seated || !Array.isArray(seated.ticketsData) || want.length === 0) return null;
    const seatedIds = new Set(seated.ticketsData.map((t) => Number(t && t.id)));
    if (!want.every((id) => seatedIds.has(id))) return null;
    return {
        ticketIds: want,
        myTickets: slimLockedTickets(seated.ticketsData),
        gameId,
        committed: true
    };
}

module.exports = {
    PENDING_TTL_MS,
    createTicketLockBoard,
    normalizeIds,
    slimLockedTickets,
    committedLockAck,
    dropCommittedEntries
};
