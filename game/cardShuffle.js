'use strict';

const TOTAL_CARDS = 700;
const DEFAULT_CARD_COUNT = TOTAL_CARDS;

function defaultCardOrder(count) {
    const n = parseInt(count, 10) || DEFAULT_CARD_COUNT;
    const order = [];
    for (let i = 1; i <= n; i++) order.push(i);
    return order;
}

function normalizeCardOrder(order, count) {
    const n = parseInt(count, 10) || DEFAULT_CARD_COUNT;
    const seen = new Set();
    const next = [];
    (order || []).forEach((id) => {
        const num = Number(id);
        if (num >= 1 && num <= n && !seen.has(num)) {
            seen.add(num);
            next.push(num);
        }
    });
    for (let i = 1; i <= n; i++) {
        if (!seen.has(i)) next.push(i);
    }
    return next;
}

function shuffleCardOrder(order, rng, count) {
    return defaultCardOrder(count);
}

function nextCardGridSeed(rng) {
    const rand = rng || Math.random;
    let seed = 0;
    while (!seed) {
        seed = (Math.floor(rand() * 0xffffffff) >>> 0);
    }
    return seed;
}

function previewShuffledGrids(seed, ids) {
    const { generateFixedCard } = require('./cardGeneration');
    return (ids || [1, 2, 3]).map((id) => ({
        id: Number(id),
        grid: generateFixedCard(id, seed)
    }));
}

module.exports = {
    TOTAL_CARDS,
    DEFAULT_CARD_COUNT,
    defaultCardOrder,
    normalizeCardOrder,
    shuffleCardOrder,
    nextCardGridSeed,
    previewShuffledGrids
};
