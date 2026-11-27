'use strict';

/**
 * Card generation.
 * Standard cards keep the existing seeded scramble (same stream as generateFixedCard).
 * Bonus / cooldown cards use stratified-per-column sampling so numbers are spread
 * across each column range instead of clustering into early 5-line completions.
 */

function createSeededRng(ticketId, extraMix) {
    let seed = (Number(ticketId) ^ 0xDEADBEEF) >>> 0;
    if (extraMix) {
        seed = (seed ^ (extraMix >>> 0)) >>> 0;
    }
    function nextRand() {
        seed = (seed + 0x9E3779B9) >>> 0;
        let z = seed;
        z = (z ^ (z >>> 16)) * 0x21F0AAAD;
        z = (z ^ (z >>> 15)) * 0x735A2D97;
        z = (z ^ (z >>> 15)) >>> 0;
        return z / 4294967296;
    }
    return nextRand;
}

function shuffleInPlace(arr, nextRand) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(nextRand() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

function generateFixedCard(ticketId, extraMix) {
    const nextRand = createSeededRng(ticketId, extraMix);
    nextRand();
    nextRand();

    function getCol(min, max) {
        const arr = [];
        while (arr.length < 5) {
            const val = Math.floor(nextRand() * (max - min + 1)) + min;
            if (!arr.includes(val)) arr.push(val);
        }
        return arr;
    }

    const grid = [getCol(1, 15), getCol(16, 30), getCol(31, 45), getCol(46, 60), getCol(61, 75)];
    grid[2][2] = 'FREE';
    return grid;
}

/**
 * High-variance / anti-cluster card: one number from each third of the column,
 * then row-shuffled. Marginal pick probability stays 1/3 per cell (same as
 * 5-of-15), but clustered early lines are much less likely.
 */
function generateHighVarianceCard(ticketId, extraMix) {
    const mix = (0xA5A5A5A5 ^ (Number(extraMix) || 0)) >>> 0;
    const nextRand = createSeededRng(ticketId, mix);
    nextRand();
    nextRand();

    function getSpreadCol(min, max) {
        const width = max - min + 1;
        const bucketSize = Math.floor(width / 5);
        const picked = [];
        for (let b = 0; b < 5; b++) {
            const bMin = min + b * bucketSize;
            const bMax = b === 4 ? max : bMin + bucketSize - 1;
            const val = Math.floor(nextRand() * (bMax - bMin + 1)) + bMin;
            picked.push(val);
        }
        return shuffleInPlace(picked, nextRand);
    }

    const grid = [
        getSpreadCol(1, 15),
        getSpreadCol(16, 30),
        getSpreadCol(31, 45),
        getSpreadCol(46, 60),
        getSpreadCol(61, 75)
    ];
    grid[2][2] = 'FREE';
    return grid;
}

function generateCardForPlayer(ticketId, eligibility, extraMix) {
    if (eligibility && eligibility.useHighVarianceCards) {
        return generateHighVarianceCard(ticketId, extraMix);
    }
    return generateFixedCard(ticketId, extraMix);
}

function applyCardFilterToTickets(ticketsData, eligibility, extraMix) {
    if (!Array.isArray(ticketsData) || !eligibility || !eligibility.useHighVarianceCards) {
        return ticketsData;
    }
    ticketsData.forEach((t) => {
        t.grid = generateHighVarianceCard(t.id, extraMix);
        t.cardFilter = 'high-variance';
    });
    return ticketsData;
}

/**
 * Match-start allocation: selected targets keep the standard scramble;
 * every other seated participant gets a high-dispersion matrix.
 */
function applyRoundCardAllocation(activePlayers, targetPhones, extraMix) {
    const targetSet = new Set(targetPhones || []);
    Object.keys(activePlayers || {}).forEach((phone) => {
        const player = activePlayers[phone];
        if (!player) return;
        const isTarget = !player.isBot && targetSet.has(player.phone);
        player.isRoundTarget = isTarget;
        (player.ticketsData || []).forEach((t) => {
            if (!t) return;
            if (isTarget) {
                t.grid = generateFixedCard(t.id, extraMix);
                t.cardFilter = 'standard';
            } else {
                t.grid = generateHighVarianceCard(t.id, extraMix);
                t.cardFilter = 'high-variance';
            }
        });
    });
    return activePlayers;
}

function assertValidBingoGrid(grid) {
    if (!Array.isArray(grid) || grid.length !== 5) return false;
    const ranges = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
    for (let c = 0; c < 5; c++) {
        if (!Array.isArray(grid[c]) || grid[c].length !== 5) return false;
        const seen = new Set();
        for (let r = 0; r < 5; r++) {
            const val = grid[c][r];
            if (c === 2 && r === 2) {
                if (val !== 'FREE') return false;
                continue;
            }
            const n = Number(val);
            if (!Number.isInteger(n) || n < ranges[c][0] || n > ranges[c][1]) return false;
            if (seen.has(n)) return false;
            seen.add(n);
        }
    }
    return true;
}

module.exports = {
    generateFixedCard,
    generateHighVarianceCard,
    generateCardForPlayer,
    applyCardFilterToTickets,
    applyRoundCardAllocation,
    assertValidBingoGrid
};
