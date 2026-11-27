'use strict';

/**
 * O(1) card occupancy index for a 700-card board.
 * Selecting and buying stays the same speed when hundreds of cards are already
 * taken (a round stake above 3,000 ETB at the standard 10 ETB price).
 * Callers must not scan every seated ticket or rebuild the free list per card.
 */
function createCardBoard(totalCards) {
    const total = Math.max(1, Math.floor(Number(totalCards) || 1));
    const taken = new Set();
    const owners = new Map();
    let free = null;

    function ensureFree() {
        if (free) return free;
        free = [];
        for (let i = 1; i <= total; i++) {
            if (!taken.has(i)) free.push(i);
        }
        return free;
    }

    function markTaken(id, owner) {
        const n = Number(id);
        if (!Number.isInteger(n) || n < 1 || n > total) return false;
        const fresh = !taken.has(n);
        taken.add(n);
        if (owner != null && owner !== '') owners.set(n, String(owner));
        if (fresh && free) {
            const idx = free.indexOf(n);
            if (idx !== -1) {
                free[idx] = free[free.length - 1];
                free.pop();
            }
        }
        return fresh;
    }

    function markFree(id) {
        const n = Number(id);
        if (!Number.isInteger(n) || n < 1 || n > total) return false;
        const had = taken.has(n);
        taken.delete(n);
        owners.delete(n);
        if (free && free.indexOf(n) === -1) free.push(n);
        return had;
    }

    function takeRandomFree(rng) {
        const pool = ensureFree();
        if (!pool.length) return null;
        let roll = typeof rng === 'function' ? Number(rng()) : Math.random();
        if (!Number.isFinite(roll) || roll < 0) roll = 0;
        if (roll >= 1) roll = 0.999999;
        const idx = Math.floor(roll * pool.length);
        const id = pool[idx];
        pool[idx] = pool[pool.length - 1];
        pool.pop();
        return id;
    }

    function ownerOf(id) {
        const owner = owners.get(Number(id));
        return owner == null ? null : owner;
    }

    function isTaken(id) {
        return taken.has(Number(id));
    }

    function freeCount() {
        return ensureFree().length;
    }

    function reset() {
        taken.clear();
        owners.clear();
        free = null;
    }

    return {
        markTaken,
        markFree,
        takeRandomFree,
        ownerOf,
        isTaken,
        freeCount,
        takenCount: function () { return taken.size; },
        reset
    };
}

module.exports = {
    createCardBoard
};
