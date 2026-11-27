'use strict';

const { TOTAL_CARDS } = require('./cardShuffle');

function cloneGrid(grid) {
    if (!Array.isArray(grid)) return grid;
    return grid.map((col) => (Array.isArray(col) ? col.slice() : col));
}

/**
 * Per-round card exclusivity and frozen 5x5 layouts.
 * One card index can be held by only one player or bot.
 * The first grid stored for a card id is the only grid for that round.
 */
function createRoundCardLedger() {
    const rounds = new Map();

    function bucket(roundId) {
        const key = String(roundId);
        let found = rounds.get(key);
        if (!found) {
            found = { selected: new Set(), owners: new Map(), grids: new Map() };
            rounds.set(key, found);
        }
        return found;
    }

    function normalizeId(cardId) {
        const id = Number(cardId);
        if (!Number.isInteger(id) || id < 1 || id > TOTAL_CARDS) return null;
        return id;
    }

    function isSelected(roundId, cardId) {
        return bucket(roundId).selected.has(Number(cardId));
    }

    function ownerOf(roundId, cardId) {
        const owner = bucket(roundId).owners.get(Number(cardId));
        return owner == null ? null : owner;
    }

    function isHeldByOther(roundId, cardId, holder) {
        const owner = ownerOf(roundId, cardId);
        if (!owner) return false;
        return owner !== String(holder);
    }

    function tryReserve(roundId, cardId, holder) {
        const id = normalizeId(cardId);
        if (id == null) return { ok: false, reason: 'RANGE', id: Number(cardId) };
        const board = bucket(roundId);
        const want = String(holder || '');
        const existing = board.owners.get(id);
        if (existing && existing !== want) {
            return { ok: false, reason: 'TAKEN', id, owner: existing };
        }
        board.owners.set(id, want);
        board.selected.add(id);
        return { ok: true, id };
    }

    function release(roundId, cardIds, holder) {
        const board = bucket(roundId);
        const want = holder == null ? null : String(holder);
        const ids = Array.isArray(cardIds) ? cardIds : [cardIds];
        ids.forEach((cardId) => {
            const id = Number(cardId);
            if (!board.selected.has(id)) return;
            if (want && board.owners.get(id) !== want) return;
            board.selected.delete(id);
            board.owners.delete(id);
        });
    }

    function freezeGrid(roundId, cardId, grid) {
        const id = Number(cardId);
        const board = bucket(roundId);
        if (!board.grids.has(id)) board.grids.set(id, cloneGrid(grid));
        return cloneGrid(board.grids.get(id));
    }

    // Fallback bot closes only. The first freeze still wins for every normal card.
    function replaceGrid(roundId, cardId, grid) {
        const id = Number(cardId);
        if (!Number.isInteger(id) || id <= 0 || !Array.isArray(grid)) return null;
        const board = bucket(roundId);
        board.grids.set(id, cloneGrid(grid));
        return cloneGrid(board.grids.get(id));
    }

    function getGrid(roundId, cardId) {
        const stored = bucket(roundId).grids.get(Number(cardId));
        return stored ? cloneGrid(stored) : null;
    }

    function selectedIds(roundId) {
        return Array.from(bucket(roundId).selected);
    }

    function selectedSet(roundId) {
        return new Set(bucket(roundId).selected);
    }

    function selectedCount(roundId) {
        return bucket(roundId).selected.size;
    }

    function clearRound(roundId) {
        rounds.delete(String(roundId));
    }

    return {
        isSelected,
        ownerOf,
        isHeldByOther,
        tryReserve,
        release,
        freezeGrid,
        replaceGrid,
        getGrid,
        selectedIds,
        selectedSet,
        selectedCount,
        clearRound
    };
}

module.exports = {
    TOTAL_CARDS,
    cloneGrid,
    createRoundCardLedger
};
