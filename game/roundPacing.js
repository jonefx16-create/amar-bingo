'use strict';

const MIN_CALLS_BEFORE_RESOLVE = 13;
const HARD_CAP_CALLS = 23;
const FINISH_CALL_MIN = 14;
const FINISH_CALL_MAX = HARD_CAP_CALLS;
// Bot cards: calls 1–10 stay scattered so no card is one number away yet.
const SCATTER_CALL_END = 10;
// Bot cards: calls 11–13 fill lines up to one number left. The winning ball is 14–23.
const LINE_BUILD_START = 11;
const LINE_BUILD_END = 13;
// User cards: calls 1–9 scatter. Calls 10–14 fill one line to exactly one away.
// The winning ball is still taken from 14–23.
const USER_LINE_START = 10;
const USER_LINE_END = 14;
const SHARED_READY_MIN = 14;
const SHARED_READY_MAX = 18;

let finishDeck = [];
let lastFinishCall = null;

function canResolveRound(drawCount) {
    return Number(drawCount) >= MIN_CALLS_BEFORE_RESOLVE;
}

function isPastHardCap(drawCount) {
    return Number(drawCount) >= HARD_CAP_CALLS;
}

function shouldForceResolution(drawCount, dynamicWinTurn) {
    const turn = Number(drawCount);
    if (turn < MIN_CALLS_BEFORE_RESOLVE) return false;
    if (turn >= HARD_CAP_CALLS) return true;
    if (dynamicWinTurn && turn >= dynamicWinTurn) return true;
    return false;
}

function clampFinishCall(call) {
    const n = Number(call);
    if (!Number.isInteger(n)) return FINISH_CALL_MIN;
    if (n < FINISH_CALL_MIN) return FINISH_CALL_MIN;
    if (n > FINISH_CALL_MAX) return FINISH_CALL_MAX;
    return n;
}

function shuffleNumbers(list, rng) {
    const arr = list.slice();
    const rand = typeof rng === 'function' ? rng : Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

function refillFinishDeck(rng) {
    const span = [];
    for (let n = FINISH_CALL_MIN; n <= FINISH_CALL_MAX; n++) span.push(n);
    finishDeck = shuffleNumbers(span, rng);
    if (lastFinishCall != null && finishDeck[0] === lastFinishCall) {
        const swapAt = finishDeck.findIndex((n, i) => i > 0 && Math.abs(n - lastFinishCall) >= 2);
        if (swapAt > 0) {
            const tmp = finishDeck[0];
            finishDeck[0] = finishDeck[swapAt];
            finishDeck[swapAt] = tmp;
        }
    }
}

/**
 * Next round's winning call. Values cover 14 through 23 before repeating,
 * and back-to-back rounds land on different calls so the pace keeps moving.
 */
function pullFinishCall(rng) {
    if (!finishDeck.length) refillFinishDeck(rng);
    let idx = 0;
    if (lastFinishCall != null) {
        const spaced = finishDeck.findIndex((n) => Math.abs(n - lastFinishCall) >= 2);
        if (spaced >= 0) idx = spaced;
    }
    const pick = finishDeck.splice(idx, 1)[0];
    lastFinishCall = pick;
    return pick;
}

function resetFinishRotation() {
    finishDeck = [];
    lastFinishCall = null;
}

function isLineBuildTurn(drawCount) {
    const turn = Number(drawCount);
    return turn >= LINE_BUILD_START && turn <= LINE_BUILD_END;
}

/**
 * Prefer numbers that complete nobody before the 13-call threshold.
 * If no such number exists, the caller may still draw, but must not resolve.
 */
function pickPreThresholdNumber(safePool, completingNums) {
    const blocked = new Set(completingNums || []);
    const absoluteSafe = (safePool || []).filter((n) => !blocked.has(n));
    if (absoluteSafe.length === 0) return null;
    return absoluteSafe[Math.floor(Math.random() * absoluteSafe.length)];
}

module.exports = {
    MIN_CALLS_BEFORE_RESOLVE,
    HARD_CAP_CALLS,
    FINISH_CALL_MIN,
    FINISH_CALL_MAX,
    SCATTER_CALL_END,
    LINE_BUILD_START,
    LINE_BUILD_END,
    USER_LINE_START,
    USER_LINE_END,
    SHARED_READY_MIN,
    SHARED_READY_MAX,
    canResolveRound,
    isPastHardCap,
    shouldForceResolution,
    clampFinishCall,
    pullFinishCall,
    resetFinishRotation,
    isLineBuildTurn,
    pickPreThresholdNumber
};
