'use strict';

const { getEatParts, hourInRange, parseHmToMinutes } = require('./eatTime');
const { botNameEndsWithNumber } = require('./botController');

const MAX_BOTS_PER_ROUND = 360;
const MAX_RAMP_STEP = 2;
const CONTROL_MANUAL = 'manual';
const CONTROL_SCHEDULE = 'schedule';

function clampBotCount(n) {
    const v = parseInt(n, 10);
    if (!v || v < 0) return 0;
    return Math.min(MAX_BOTS_PER_ROUND, v);
}

function listBotSchedules(settings) {
    const set = settings || {};
    return [1, 2, 3, 4, 5, 6, 7].map((i) => {
        const d = set['botSchedule' + i];
        if (!d) return null;
        return {
            n: 'Slot ' + i,
            index: i,
            d: {
                start: d.start,
                end: d.end,
                min: clampBotCount(d.min),
                max: clampBotCount(d.max)
            }
        };
    }).filter(Boolean);
}

function slotContainsMinutes(mins, startVal, endVal) {
    const start = parseHmToMinutes(startVal);
    const end = parseHmToMinutes(endVal);
    if (start === end) return false;
    if (start < end) return mins >= start && mins < end;
    return mins >= start || mins < end;
}

function findActiveBotSchedule(settings, hourOrEat) {
    let mins;
    if (hourOrEat && typeof hourOrEat === 'object') {
        mins = (Number(hourOrEat.hour) || 0) * 60 + (Number(hourOrEat.minute) || 0);
    } else if (hourOrEat == null) {
        const eat = getEatParts();
        mins = (eat.hour * 60) + eat.minute;
    } else {
        mins = (Number(hourOrEat) || 0) * 60;
    }
    let found = null;
    listBotSchedules(settings).forEach((slot) => {
        if (slotContainsMinutes(mins, slot.d.start, slot.d.end)) found = slot;
    });
    return found;
}

function fallbackBotCount(settings) {
    const set = settings || {};
    const total = (Number(set.botDist1) || 0) + (Number(set.botDist2) || 0)
        + (Number(set.botDist3) || 0) + (Number(set.botDist4) || 0);
    return total > 0 ? total : 15;
}

function clampToMax(n, maxBots) {
    return Math.max(0, Math.min(maxBots, clampBotCount(n)));
}

function normalizeBotRampMinutes(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 30;
    return Math.max(1, Math.min(180, Math.round(n)));
}

function pickInRange(min, max, rng, maxBots) {
    const lo = clampToMax(min, maxBots);
    const hi = clampToMax(max, maxBots);
    const low = Math.min(lo, hi);
    const high = Math.max(lo, hi);
    const span = high - low;
    return low + (span ? Math.floor(rng() * (span + 1)) : 0);
}

function resolveBotControl(settings, eat) {
    const set = settings || {};
    if (!set.isBotScheduleActive) {
        const fb = fallbackBotCount(set);
        return {
            mode: CONTROL_MANUAL,
            slot: null,
            slotIndex: null,
            targetMin: fb,
            targetMax: fb
        };
    }
    const slot = findActiveBotSchedule(set, eat);
    if (slot) {
        let targetMin = slot.d.min;
        let targetMax = slot.d.max;
        if (targetMax < targetMin) targetMax = targetMin;
        return {
            mode: CONTROL_SCHEDULE,
            slot,
            slotIndex: slot.index,
            targetMin,
            targetMax
        };
    }
    const fb = fallbackBotCount(set);
    return {
        mode: CONTROL_SCHEDULE,
        slot: null,
        slotIndex: 0,
        targetMin: fb,
        targetMax: fb
    };
}

function createBotRampController(opts) {
    const maxBots = (opts && opts.maxBots) || MAX_BOTS_PER_ROUND;
    let mode = CONTROL_MANUAL;
    let lastCount = 0;
    let lastSlotIndex = null;
    let fromCount = 0;
    let toMin = 0;
    let toMax = 0;
    let rampStart = 0;
    let lastSlot = null;
    let lastProgress = 1;
    let lastRamping = false;

    function reset() {
        mode = CONTROL_MANUAL;
        lastCount = 0;
        lastSlotIndex = null;
        fromCount = 0;
        toMin = 0;
        toMax = 0;
        rampStart = 0;
        lastSlot = null;
        lastProgress = 1;
        lastRamping = false;
    }

    function summarize(slot, progress, targetMin, targetMax, ramping) {
        lastSlot = slot || null;
        lastProgress = progress;
        lastRamping = !!ramping;
        return {
            count: lastCount,
            slot: lastSlot,
            progress: lastProgress,
            targetMin,
            targetMax,
            ramping: lastRamping,
            lastCount,
            mode,
            source: mode
        };
    }

    function getStatus() {
        return {
            mode,
            source: mode,
            injected: lastCount,
            count: lastCount,
            ramping: lastRamping,
            progress: lastProgress,
            targetMin: toMin,
            targetMax: toMax,
            slot: lastSlot,
            slotIndex: lastSlotIndex
        };
    }

    // Admin direct control: jump to the exact requested count with no ramp.
    function applyManualOverride(targetCount) {
        const count = clampToMax(targetCount, maxBots);
        mode = CONTROL_MANUAL;
        lastCount = count;
        lastSlotIndex = null;
        fromCount = count;
        toMin = count;
        toMax = count;
        rampStart = 0;
        return summarize(null, 1, count, count, false);
    }

    function snapToScheduleSlot(resolved, now, rng) {
        mode = CONTROL_SCHEDULE;
        lastSlotIndex = resolved.slotIndex;
        toMin = resolved.targetMin;
        toMax = resolved.targetMax;
        lastCount = pickInRange(toMin, toMax, rng, maxBots);
        fromCount = lastCount;
        rampStart = now;
        return summarize(resolved.slot, 1, toMin, toMax, false);
    }

    function stepScheduleRamp(input, resolved) {
        const settings = (input && input.settings) || {};
        const now = input && input.now != null ? Number(input.now) : Date.now();
        const rng = (input && input.rng) || Math.random;
        const gameTimer = Math.max(10, Number(settings.gameTimer) || 40);
        const rampMinutes = normalizeBotRampMinutes(settings.botRampMinutes);
        const rampMs = Math.max(1, rampMinutes) * 60 * 1000;

        const progress = Math.min(1, (now - rampStart) / rampMs);
        const desiredMin = fromCount + ((toMin - fromCount) * progress);
        const desiredMax = fromCount + ((toMax - fromCount) * progress);
        const lo = Math.round(Math.min(desiredMin, desiredMax));
        const hi = Math.round(Math.max(desiredMin, desiredMax));
        let desired = lo;
        if (hi > lo) desired = lo + Math.floor(rng() * (hi - lo + 1));

        const midFrom = fromCount;
        const midTo = (toMin + toMax) / 2;
        const roundsInRamp = Math.max(1, Math.round(rampMs / (gameTimer * 1000)));
        const remainingRounds = Math.max(1, Math.ceil((1 - Math.min(0.999, progress)) * roundsInRamp));
        const remainingDelta = midTo - lastCount;
        const neededStep = Math.max(1, Math.ceil(Math.abs(remainingDelta) / remainingRounds));
        const rawStep = Math.max(1, Math.ceil(Math.abs(midTo - midFrom) / roundsInRamp));
        const maxStep = Math.max(MAX_RAMP_STEP, rawStep, neededStep);

        const previous = lastCount;
        let steerTo = desired;
        if (lastCount < toMin) steerTo = toMin;
        else if (lastCount > toMax) steerTo = toMax;
        let delta = steerTo - lastCount;
        if (delta === 0 && progress < 1 && lastCount !== Math.round(midTo)) {
            const toward = midTo - lastCount;
            if (toward > 0) delta = Math.min(maxStep, Math.max(1, neededStep));
            if (toward < 0) delta = -Math.min(maxStep, Math.max(1, neededStep));
        }
        if (delta > maxStep) delta = maxStep;
        if (delta < -maxStep) delta = -maxStep;

        if (delta !== 0) {
            const sign = delta > 0 ? 1 : -1;
            let step;
            if (neededStep > MAX_RAMP_STEP) {
                step = sign * Math.min(maxStep, Math.abs(delta), neededStep);
            } else {
                step = sign;
                if (Math.abs(delta) >= 2 && rng() < 0.4) step = sign * Math.min(2, Math.abs(delta));
                if (progress < 0.85 && rng() < 0.18) step = 0;
            }
            lastCount = Math.max(0, lastCount + step);
        }

        const windowComplete = progress >= 1 || remainingRounds <= 1;
        if (windowComplete) {
            if (lastCount < toMin) lastCount = toMin;
            if (lastCount > toMax) lastCount = toMax;
        }

        const applied = lastCount - previous;
        if (!windowComplete) {
            if (applied > maxStep) lastCount = previous + maxStep;
            if (applied < -maxStep) lastCount = previous - maxStep;
        } else {
            if (lastCount < toMin) lastCount = toMin;
            if (lastCount > toMax) lastCount = toMax;
        }

        lastCount = Math.max(0, Math.min(maxBots, lastCount));
        return summarize(resolved.slot, progress, resolved.targetMin, resolved.targetMax, progress < 1);
    }

    function nextCount(input) {
        const settings = (input && input.settings) || {};
        const now = input && input.now != null ? Number(input.now) : Date.now();
        const rng = (input && input.rng) || Math.random;
        const eat = getEatParts(now);
        const resolved = resolveBotControl(settings, eat);

        // Manual override: always the exact saved/applied count, never a schedule ramp.
        if (resolved.mode === CONTROL_MANUAL) {
            return applyManualOverride(resolved.targetMin);
        }

        mode = CONTROL_SCHEDULE;

        // First schedule tick, or admin just left manual mode: land on the live slot immediately.
        if (lastSlotIndex == null) {
            return snapToScheduleSlot(resolved, now, rng);
        }

        // Automatic shift between configured slots: start/continue the configured ramp.
        if (resolved.slotIndex !== lastSlotIndex) {
            fromCount = lastCount;
            toMin = resolved.targetMin;
            toMax = resolved.targetMax;
            rampStart = now;
            lastSlotIndex = resolved.slotIndex;
            return stepScheduleRamp(input, resolved);
        }

        // Admin edited the current slot's min/max: snap into the new band, do not start a ramp.
        if (toMin !== resolved.targetMin || toMax !== resolved.targetMax) {
            toMin = resolved.targetMin;
            toMax = resolved.targetMax;
            if (lastCount < toMin) lastCount = toMin;
            if (lastCount > toMax) lastCount = toMax;
            fromCount = lastCount;
            rampStart = now;
            lastCount = Math.max(0, Math.min(maxBots, lastCount));
            return summarize(resolved.slot, 1, toMin, toMax, false);
        }

        return stepScheduleRamp(input, resolved);
    }

    // Keep ManualOverride and ScheduleRunner in sync after an admin save.
    function syncControlMode(input) {
        const settings = (input && input.settings) || {};
        if (!settings.isBotScheduleActive) {
            return applyManualOverride(fallbackBotCount(settings));
        }
        if (mode !== CONTROL_SCHEDULE || lastSlotIndex == null) {
            const now = input && input.now != null ? Number(input.now) : Date.now();
            const rng = (input && input.rng) || Math.random;
            const eat = getEatParts(now);
            return snapToScheduleSlot(resolveBotControl(settings, eat), now, rng);
        }
        return getStatus();
    }

    return {
        nextCount,
        reset,
        applyManualOverride,
        syncControlMode,
        getLastCount: function () { return lastCount; },
        getMode: function () { return mode; },
        getStatus
    };
}

function collectBusyPhones(busyPhones) {
    const busy = new Set();
    if (!busyPhones || typeof busyPhones.forEach !== 'function') return busy;
    busyPhones.forEach((phone) => {
        const value = String(phone || '').trim();
        if (value) busy.add(value);
    });
    return busy;
}

/**
 * Eligible bots for one join request.
 * Number-suffixed names and phones already seated or queued are skipped,
 * and the scan continues until `amount` bots are found.
 */
function takeJoinableBots(bots, amount, busyPhones) {
    const want = Math.max(0, Math.floor(Number(amount) || 0));
    const busy = collectBusyPhones(busyPhones);
    const seen = new Set();
    const out = [];
    const list = bots || [];
    for (let i = 0; i < list.length && out.length < want; i++) {
        const bot = list[i];
        if (!bot || botNameEndsWithNumber(bot.name)) continue;
        const name = String(bot.name || '').trim();
        const phone = String(bot.phone || '').trim();
        if (!name || !phone || busy.has(phone) || seen.has(phone)) continue;
        seen.add(phone);
        out.push(bot);
    }
    return out;
}

/**
 * Per-bot card counts for `amount` bots.
 * `dist` is [1-card, 2-card, 3-card, 4-card], either exact quantities or ratios.
 * Rounding cannot shrink the roster.
 */
function expandBotTicketPlan(amount, dist) {
    const want = Math.max(0, Math.floor(Number(amount) || 0));
    const raw = dist || [];
    const weights = [0, 1, 2, 3].map((i) => Math.max(0, Math.floor(Number(raw[i]) || 0)));
    let total = weights[0] + weights[1] + weights[2] + weights[3];
    if (!total) {
        weights[0] = 5;
        weights[1] = 4;
        weights[2] = 3;
        weights[3] = 3;
        total = 15;
    }
    if (!want) return [];
    let counts = weights.map((weight) => Math.round((weight / total) * want));
    let assigned = counts[0] + counts[1] + counts[2] + counts[3];
    counts[3] += want - assigned;
    for (let i = 0; i < 3 && counts[3] < 0; i++) {
        const give = Math.min(counts[i], -counts[3]);
        counts[i] -= give;
        counts[3] += give;
    }
    if (counts[3] < 0) counts[3] = 0;
    const out = [];
    for (let cards = 1; cards <= 4; cards++) {
        for (let i = 0; i < counts[cards - 1]; i++) out.push(cards);
    }
    while (out.length < want) out.push(1);
    if (out.length > want) out.length = want;
    return out;
}

/**
 * Shrink card counts so every bot still gets a seat.
 * A 300-bot roster that asks for four cards each needs 1200 cards; only 700
 * exist, and the old joiner dropped everyone after the pool ran out (~206).
 * Highest card counts are reduced first. Bots beyond the free-card pool
 * cannot be seated.
 */
function fitBotTicketCounts(counts, availableCards) {
    const src = Array.isArray(counts) ? counts : [];
    const available = Math.max(0, Math.floor(Number(availableCards) || 0));
    const seated = Math.min(src.length, available);
    const out = [];
    for (let i = 0; i < seated; i++) {
        let n = Math.floor(Number(src[i]) || 1);
        if (n < 1) n = 1;
        if (n > 4) n = 4;
        out.push(n);
    }
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i];
    while (sum > available) {
        let idx = -1;
        for (let i = 0; i < out.length; i++) {
            if (out[i] > 1 && (idx === -1 || out[i] > out[idx])) idx = i;
        }
        if (idx === -1) break;
        out[idx] -= 1;
        sum -= 1;
    }
    return out;
}

function buildBotJoinQueue(bots, amount, dist, availableCards, busyPhones) {
    const picked = takeJoinableBots(bots, amount, busyPhones);
    const desired = expandBotTicketPlan(picked.length, dist);
    const fitted = fitBotTicketCounts(desired, availableCards);
    const out = [];
    for (let i = 0; i < fitted.length; i++) {
        out.push({ bot: picked[i], tixCount: fitted[i] });
    }
    return out;
}

function nextUnit(rng) {
    let roll = typeof rng === 'function' ? Number(rng()) : Math.random();
    if (!Number.isFinite(roll) || roll < 0) roll = 0;
    if (roll >= 1) roll = 0.999999;
    return roll;
}

/**
 * Gap between two cards bought by the same bot.
 * A short follow-up tap, a normal look-and-click, or a longer hesitate.
 * The mix is what keeps a 2–4 card buy from landing on one timestamp.
 */
function humanClickGap(rng) {
    const roll = nextUnit(rng);
    if (roll < 0.14) return 220 + Math.floor(nextUnit(rng) * 280);
    if (roll < 0.78) return 680 + Math.floor(nextUnit(rng) * 1100);
    return 1900 + Math.floor(nextUnit(rng) * 1800);
}

/**
 * When each bot card should be purchased, in milliseconds from now.
 * Bots start at different moments and buy their own cards one at a time.
 * The whole roster still finishes inside `windowMs` so the round is not
 * left waiting on a bot. A zero window (the countdown already ended) keeps
 * every card, packed at 0, for the caller to flush.
 */
function planHumanBotCardDelays(counts, opts) {
    const rng = (opts && opts.rng) || Math.random;
    const windowMs = Math.max(0, Math.floor(Number(opts && opts.windowMs) || 0));
    const src = Array.isArray(counts) ? counts : [];
    const steps = [];
    if (windowMs <= 0) {
        for (let b = 0; b < src.length; b++) {
            let cards = Math.floor(Number(src[b]) || 0);
            if (cards < 1) cards = 1;
            if (cards > 4) cards = 4;
            for (let c = 0; c < cards; c++) steps.push({ botIndex: b, cardIndex: c, delayMs: 0 });
        }
        return steps;
    }
    for (let b = 0; b < src.length; b++) {
        let cards = Math.floor(Number(src[b]) || 0);
        if (cards < 1) cards = 1;
        if (cards > 4) cards = 4;
        const startSpan = windowMs > 0 ? Math.floor(windowMs * 0.7) : 0;
        let t = 0;
        if (startSpan > 0) {
            t = Math.floor(Math.pow(nextUnit(rng), 0.75) * startSpan);
            t += Math.floor(nextUnit(rng) * Math.min(1400, Math.max(1, Math.floor(windowMs * 0.06))));
        }
        for (let c = 0; c < cards; c++) {
            if (c > 0) t += humanClickGap(rng);
            steps.push({ botIndex: b, cardIndex: c, delayMs: Math.max(0, t) });
        }
    }
    if (!steps.length) return steps;

    steps.sort(function (a, b) {
        return a.delayMs - b.delayMs || a.botIndex - b.botIndex || a.cardIndex - b.cardIndex;
    });

    const naturalLast = steps[steps.length - 1].delayMs;
    if (windowMs > 0 && naturalLast > windowMs) {
        const scale = windowMs / naturalLast;
        for (let i = 0; i < steps.length; i++) steps[i].delayMs = Math.floor(steps[i].delayMs * scale);
    }

    // Soft cap: more than two cards in the same brief moment gets pushed
    // forward with a little jitter. The gap shrinks only when the countdown
    // cannot hold a human pace.
    const roomy = windowMs >= steps.length * 160;
    const minGap = windowMs <= 0 ? 0 : (roomy ? 140 : Math.max(1, Math.min(80, Math.floor(windowMs / steps.length))));
    if (minGap > 0) {
        let burstStart = steps[0].delayMs;
        let burst = 0;
        let prev = -minGap;
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            if (step.delayMs - burstStart > 220) {
                burstStart = step.delayMs;
                burst = 0;
            }
            if (burst >= 2 && step.delayMs < prev + minGap) {
                const jitter = Math.floor(nextUnit(rng) * Math.max(1, Math.floor(minGap * 0.45)));
                step.delayMs = prev + minGap + jitter;
                burstStart = step.delayMs;
                burst = 0;
            }
            if (step.delayMs < prev + (roomy ? 40 : 1)) step.delayMs = prev + (roomy ? 40 : 1);
            burst += 1;
            prev = step.delayMs;
        }
    }

    const fittedLast = steps[steps.length - 1].delayMs;
    if (windowMs > 0 && fittedLast > windowMs && fittedLast > 0) {
        const scale = windowMs / fittedLast;
        for (let i = 0; i < steps.length; i++) steps[i].delayMs = Math.floor(steps[i].delayMs * scale);
    }

    steps.sort(function (a, b) {
        return a.botIndex - b.botIndex || a.cardIndex - b.cardIndex;
    });
    const seenBot = new Map();
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const prevCard = seenBot.get(step.botIndex);
        if (prevCard != null && step.delayMs <= prevCard) {
            step.delayMs = prevCard + (windowMs >= steps.length ? 1 : 0);
        }
        seenBot.set(step.botIndex, step.delayMs);
    }
    if (windowMs > 0) {
        let overflow = steps[0] ? 0 : 0;
        for (let i = 0; i < steps.length; i++) {
            if (steps[i].delayMs > overflow) overflow = steps[i].delayMs;
        }
        if (overflow > windowMs && overflow > 0) {
            const scale = windowMs / overflow;
            for (let i = 0; i < steps.length; i++) steps[i].delayMs = Math.max(0, Math.floor(steps[i].delayMs * scale));
            const again = new Map();
            steps.sort(function (a, b) {
                return a.botIndex - b.botIndex || a.cardIndex - b.cardIndex;
            });
            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                const prevCard = again.get(step.botIndex);
                if (prevCard != null && step.delayMs <= prevCard) step.delayMs = Math.min(windowMs, prevCard + 1);
                again.set(step.botIndex, step.delayMs);
            }
        }
        for (let i = 0; i < steps.length; i++) {
            if (steps[i].delayMs > windowMs) steps[i].delayMs = windowMs;
            if (steps[i].delayMs < 0) steps[i].delayMs = 0;
        }
    }

    steps.sort(function (a, b) {
        return a.delayMs - b.delayMs || a.botIndex - b.botIndex || a.cardIndex - b.cardIndex;
    });
    return steps;
}

/**
 * How many queued bots to seat on this countdown tick.
 * The release is at least ceil(queue / ticks left), so a 300-bot queue
 * finishes before the round starts even when the random pace is slow.
 * The last few seconds seat whoever is still waiting.
 * Live rounds do not use this clump. They schedule planHumanBotCardDelays
 * so each card is bought on its own timer.
 */
function botsToReleaseThisTick(queueLength, gameClock, rng) {
    const queued = Math.max(0, Math.floor(Number(queueLength) || 0));
    if (!queued) return 0;
    const clock = Math.floor(Number(gameClock) || 0);
    if (clock <= 4) return queued;
    const ticksLeft = Math.max(1, clock - 3);
    const minNeeded = Math.min(queued, Math.ceil(queued / ticksLeft));
    let roll = typeof rng === 'function' ? Number(rng()) : Math.random();
    if (!Number.isFinite(roll) || roll < 0) roll = 0;
    if (roll >= 1) roll = 0.999999;
    const ideal = queued / ticksLeft;
    const maxBurst = Math.min(queued, Math.max(minNeeded, Math.ceil(ideal * 1.8)));
    const span = maxBurst - minNeeded;
    return minNeeded + (span ? Math.floor(roll * (span + 1)) : 0);
}

function minutesUntilHour(eat, endHour) {
    const nowMins = (eat.hour * 60) + eat.minute;
    let endMins = parseHmToMinutes(endHour);
    if (!endMins && (endHour === 24 || endHour === '24' || endHour === '24:00')) endMins = 24 * 60;
    let diff = endMins - nowMins;
    if (diff <= 0) diff += 24 * 60;
    return diff;
}

function describeScheduleStatus(settings, now) {
    const eat = getEatParts(now);
    const slots = listBotSchedules(settings);
    const active = settings && settings.isBotScheduleActive ? findActiveBotSchedule(settings, eat) : null;
    return {
        eatHour: eat.hour,
        eatMinute: eat.minute,
        slots: slots.map((slot) => {
            const isActive = !!(active && active.index === slot.index);
            return {
                index: slot.index,
                n: slot.n,
                start: slot.d.start,
                end: slot.d.end,
                min: slot.d.min,
                max: slot.d.max,
                isActive,
                remainingMinutes: isActive ? minutesUntilHour(eat, slot.d.end) : null
            };
        }),
        active: active
    };
}

module.exports = {
    MAX_BOTS_PER_ROUND,
    MAX_RAMP_STEP,
    CONTROL_MANUAL,
    CONTROL_SCHEDULE,
    clampBotCount,
    normalizeBotRampMinutes,
    listBotSchedules,
    findActiveBotSchedule,
    fallbackBotCount,
    resolveBotControl,
    createBotRampController,
    describeScheduleStatus,
    takeJoinableBots,
    expandBotTicketPlan,
    fitBotTicketCounts,
    buildBotJoinQueue,
    botsToReleaseThisTick,
    planHumanBotCardDelays,
    humanClickGap,
    minutesUntilHour
};
