'use strict';

const {
    canResolveRound,
    MIN_CALLS_BEFORE_RESOLVE,
    HARD_CAP_CALLS,
    FINISH_CALL_MIN,
    SHARED_READY_MAX,
    SCATTER_CALL_END,
    USER_LINE_START,
    USER_LINE_END
} = require('./roundPacing');
const { isPunishedPlayer, classifyPlayer, bonusWinDenied, stakeUsesBonusFunds } = require('./eligibility');
const { buildRoundLineIndex, mapEarlyDrawTrajectories } = require('./lineIndex');
const { MAX_SPLIT_WINNERS, splitRank, callableEmergencyNumber } = require('./botController');

const MAX_VIRTUAL_VALIDATORS = 4;
const MAX_TOTAL_WINNERS = MAX_SPLIT_WINNERS;
const USER_5_MATCH_LOCK = 'USER_5_MATCH_LOCK';

function checkBingo(grid, called) {
    const calledSet = new Set((called || []).map((n) => Number(n)));
    calledSet.add('FREE');

    const m = [];
    for (let c = 0; c < 5; c++) {
        if (!grid[c]) return false;
        m[c] = [];
        for (let r = 0; r < 5; r++) {
            const val = grid[c][r];
            m[c][r] = (val === 'FREE' || val === 'free') ? true : calledSet.has(Number(val));
        }
    }

    for (let c = 0; c < 5; c++) {
        if (m[c][0] && m[c][1] && m[c][2] && m[c][3] && m[c][4]) return true;
    }
    for (let r = 0; r < 5; r++) {
        if (m[0][r] && m[1][r] && m[2][r] && m[3][r] && m[4][r]) return true;
    }
    if (m[0][0] && m[1][1] && m[2][2] && m[3][3] && m[4][4]) return true;
    if (m[0][4] && m[1][3] && m[2][2] && m[3][1] && m[4][0]) return true;
    if (m[0][0] && m[0][4] && m[4][0] && m[4][4]) return true;

    return false;
}

function cornerValue(grid, c, r) {
    if (!grid || !grid[c]) return null;
    return grid[c][r];
}

function checkFourCorners(grid, called) {
    if (!grid || !grid[0] || !grid[4]) return false;
    const calledSet = new Set((called || []).map((n) => Number(n)));
    const corners = [
        cornerValue(grid, 0, 0),
        cornerValue(grid, 0, 4),
        cornerValue(grid, 4, 0),
        cornerValue(grid, 4, 4)
    ];
    return corners.every((val) => val === 'FREE' || val === 'free' || calledSet.has(Number(val)));
}

function isFreeCell(val) {
    return val === 'FREE' || val === 'free';
}

function bingoLines(grid) {
    if (!Array.isArray(grid) || grid.length < 5) return [];
    const lines = [];
    for (let c = 0; c < 5; c++) {
        if (!Array.isArray(grid[c]) || grid[c].length < 5) return [];
        lines.push([grid[c][0], grid[c][1], grid[c][2], grid[c][3], grid[c][4]]);
    }
    for (let r = 0; r < 5; r++) {
        lines.push([grid[0][r], grid[1][r], grid[2][r], grid[3][r], grid[4][r]]);
    }
    lines.push([grid[0][0], grid[1][1], grid[2][2], grid[3][3], grid[4][4]]);
    lines.push([grid[0][4], grid[1][3], grid[2][2], grid[3][1], grid[4][0]]);
    lines.push([grid[0][0], grid[0][4], grid[4][0], grid[4][4]]);
    return lines;
}

/**
 * Numbers that complete a bingo on this card and no other cell.
 * Each returned number is copied off the card. The grid is not modified.
 */
/**
 * Numbers that would leave this card one away. A line that still misses
 * exactly two balls contributes both of them. Calling either one does not
 * finish the card.
 */
function approachNumbers(grid, called) {
    const calledSet = new Set((called || []).map((n) => Number(n)));
    const found = [];
    const seen = new Set();
    bingoLines(grid).forEach((line) => {
        const missing = [];
        for (let i = 0; i < line.length; i++) {
            const val = line[i];
            if (isFreeCell(val) || calledSet.has(Number(val))) continue;
            missing.push(Number(val));
        }
        if (missing.length !== 2) return;
        for (let i = 0; i < missing.length; i++) {
            const n = missing[i];
            if (!Number.isInteger(n) || n < 1 || n > 75 || seen.has(n)) continue;
            seen.add(n);
            found.push(n);
        }
    });
    return found;
}

function oneAwayNumbers(grid, called) {
    const calledSet = new Set((called || []).map((n) => Number(n)));
    const found = [];
    const seen = new Set();
    bingoLines(grid).forEach((line) => {
        const missing = [];
        for (let i = 0; i < line.length; i++) {
            const val = line[i];
            if (isFreeCell(val) || calledSet.has(Number(val))) continue;
            missing.push(Number(val));
        }
        if (missing.length !== 1) return;
        const n = missing[0];
        if (!Number.isInteger(n) || n < 1 || n > 75 || seen.has(n)) return;
        seen.add(n);
        found.push(n);
    });
    return found;
}

function gridForTicket(ticket, gridOf) {
    if (typeof gridOf === 'function') {
        const supplied = gridOf(ticket);
        if (Array.isArray(supplied)) return supplied;
    }
    return ticket && ticket.grid;
}

function collectOneAwayNumbers(players, called, options) {
    options = options || {};
    if (options.lineIndex) {
        options.lineIndex.syncCalled(called || []);
        return options.lineIndex.oneAwayNumbers(players, options);
    }
    const pool = options.pool ? new Set(options.pool.map((n) => Number(n))) : null;
    const avoid = new Set((options.avoid || []).map((n) => Number(n)));
    const out = [];
    const seen = new Set();
    (players || []).forEach((player) => {
        const tickets = (player && player.ticketsData) || [];
        for (let t = 0; t < tickets.length; t++) {
            const nums = oneAwayNumbers(gridForTicket(tickets[t], options.gridOf), called);
            for (let i = 0; i < nums.length; i++) {
                const n = nums[i];
                if (pool && !pool.has(n)) continue;
                if (avoid.has(n)) continue;
                if (seen.has(n)) continue;
                seen.add(n);
                out.push(n);
            }
        }
    });
    return out;
}

function pickAuthenticOneAwayNumber(players, called, options) {
    const nums = collectOneAwayNumbers(players, called, options);
    return nums.length ? nums[0] : null;
}

/**
 * Seats left for bots after the human cards on this ball. Five winners is
 * the pay cap, so one user leaves four bot seats and a bot-only ball
 * leaves five.
 */
function paidBotSeats(botHits, humanHits) {
    const seats = Math.max(0, MAX_TOTAL_WINNERS - (Number(humanHits) || 0));
    return Math.min(Math.max(0, Number(botHits) || 0), seats);
}

/**
 * The ball the most seated bots finish on. Two or more bots are a shared
 * win. One bot stays a solo bot win. The count is already capped at 5.
 */
function pickGroupedBotBall(botPlayers, called, options) {
    options = options || {};
    if (options.lineIndex && options.lineIndex.bestFinisherBall) {
        options.lineIndex.syncCalled(called || []);
        const best = options.lineIndex.bestFinisherBall(botPlayers, options);
        if (!best) return null;
        return { num: best.num, count: best.count, plan: best.count >= 2 ? 'shared' : 'bot' };
    }
    const pool = options.pool ? new Set(options.pool.map((n) => Number(n))) : null;
    const avoid = new Set((options.avoid || []).map((n) => Number(n)));
    const tally = new Map();
    const players = botPlayers || [];
    for (let p = 0; p < players.length; p++) {
        const tickets = (players[p] && players[p].ticketsData) || [];
        for (let t = 0; t < tickets.length; t++) {
            const grid = gridForTicket(tickets[t], options.gridOf);
            if (!Array.isArray(grid) || checkBingo(grid, called)) continue;
            const nums = oneAwayNumbers(grid, called);
            const seenOnCard = new Set();
            for (let i = 0; i < nums.length; i++) {
                const n = nums[i];
                if (seenOnCard.has(n)) continue;
                seenOnCard.add(n);
                if (pool && !pool.has(n)) continue;
                if (avoid.has(n)) continue;
                tally.set(n, (tally.get(n) || 0) + 1);
            }
        }
    }
    let best = null;
    let bestRank = 0;
    let bestRaw = 0;
    tally.forEach(function (count, n) {
        const rank = splitRank(count);
        const num = Number(n);
        if (rank > bestRank || (rank === bestRank && (best == null || num < best))) {
            best = num;
            bestRank = rank;
            bestRaw = count;
        }
    });
    if (best == null) return null;
    const paid = paidBotSeats(bestRaw, 0);
    return { num: best, count: paid, plan: paid >= 2 ? 'shared' : 'bot' };
}

/**
 * A ball exactly one seated bot finishes, and no seated human finishes.
 * Used only when a bot-only close rolls the occasional solo.
 */
function pickSoloBotBall(botPlayers, called, options) {
    options = options || {};
    const humans = options.humans || [];
    const humanAway = humans.length
        ? collectOneAwayNumbers(humans, called, {
            pool: options.pool,
            gridOf: options.gridOf,
            lineIndex: options.lineIndex
        })
        : [];
    const avoid = (options.avoid || []).concat(humanAway);
    const soloOptions = {
        pool: options.pool,
        avoid: avoid,
        gridOf: options.gridOf,
        lineIndex: options.lineIndex,
        rng: options.rng
    };
    if (options.lineIndex && options.lineIndex.soloFinisherBall) {
        options.lineIndex.syncCalled(called || []);
        const solo = options.lineIndex.soloFinisherBall(botPlayers, soloOptions);
        if (!solo) return null;
        return { num: solo.num, count: 1, plan: 'bot' };
    }
    const pool = options.pool ? new Set((options.pool || []).map((n) => Number(n))) : null;
    const blocked = new Set(avoid.map((n) => Number(n)));
    const tally = new Map();
    const players = botPlayers || [];
    for (let p = 0; p < players.length; p++) {
        const tickets = (players[p] && players[p].ticketsData) || [];
        for (let t = 0; t < tickets.length; t++) {
            const grid = gridForTicket(tickets[t], options.gridOf);
            if (!Array.isArray(grid) || checkBingo(grid, called)) continue;
            const nums = oneAwayNumbers(grid, called);
            const seenOnCard = new Set();
            for (let i = 0; i < nums.length; i++) {
                const n = nums[i];
                if (seenOnCard.has(n)) continue;
                seenOnCard.add(n);
                if (pool && !pool.has(n)) continue;
                if (blocked.has(n)) continue;
                tally.set(n, (tally.get(n) || 0) + 1);
            }
        }
    }
    const solos = [];
    tally.forEach(function (count, n) {
        if (count === 1) solos.push(Number(n));
    });
    if (!solos.length) return null;
    solos.sort(function (a, b) { return a - b; });
    const rng = typeof options.rng === 'function' ? options.rng : Math.random;
    return { num: solos[Math.floor(rng() * solos.length)], count: 1, plan: 'bot' };
}

/**
 * A grouped bot close stays the normal result. soloBotChance, 0 to 1,
 * sometimes pays one bot the whole pot instead. No solo ball, or a ball
 * a human also finishes, keeps the split.
 */
function occasionalSoloBotClose(grouped, ctx, botPlayers, called, ballOptions) {
    if (!grouped || Number(grouped.count) < 2) return grouped;
    const chance = Number(ctx && ctx.soloBotChance);
    if (!(chance > 0)) return grouped;
    if (rngOf(ctx)() >= chance) return grouped;
    const solo = pickSoloBotBall(botPlayers, called, Object.assign({}, ballOptions, { rng: rngOf(ctx) }));
    if (!solo) return grouped;
    return { num: solo.num, count: 1, plan: 'bot' };
}

/**
 * A call that is the single missing bingo number on a real card and on a
 * pre-seated bot card. Both cards already contain that number.
 */
function pickSharedOneAwayNumber(realPlayers, botPlayers, called, options) {
    options = options || {};
    const realNums = collectOneAwayNumbers(realPlayers, called, options);
    if (!realNums.length) return null;
    const botNums = new Set(collectOneAwayNumbers(botPlayers, called, options));
    for (let i = 0; i < realNums.length; i++) {
        if (botNums.has(realNums[i])) return realNums[i];
    }
    return null;
}

function freshCompletingTickets(players, called, num, gridOf, lineIndex) {
    if (lineIndex) return lineIndex.freshCompletingTickets(players, called, num);
    const hits = [];
    (players || []).forEach((player) => {
        const tickets = (player && player.ticketsData) || [];
        for (let t = 0; t < tickets.length; t++) {
            const grid = gridForTicket(tickets[t], gridOf);
            if (!Array.isArray(grid)) continue;
            if (checkBingo(grid, called)) continue;
            if (!checkBingo(grid, (called || []).concat([num]))) continue;
            hits.push(tickets[t]);
        }
    });
    return hits;
}

/**
 * One ball that completes exactly one target card.
 * A ball several bots finish together is a shared win, up to four bots
 * beside that user. A one-bot ball is used only when no larger group is
 * ready. Another human who also finishes stays in the split. Grids are
 * read only.
 */
function pickExactSharedOneAway(realPlayers, botPlayers, called, options) {
    options = options || {};
    const botCount = Number(options.botCount);
    if (!Number.isInteger(botCount) || botCount < 1) return null;
    const pool = options.pool ? new Set(options.pool.map((n) => Number(n))) : null;
    const avoid = new Set((options.avoid || []).map((n) => Number(n)));
    const gridOf = options.gridOf;
    const others = options.others || [];
    const candidates = collectOneAwayNumbers(realPlayers, called, {
        pool: options.pool,
        avoid: options.avoid,
        gridOf,
        lineIndex: options.lineIndex
    });
    let exact = null;
    let bestGroup = null;
    let bestScore = 1;
    let bestOverflow = Infinity;
    let sharedHumans = null;
    for (let i = 0; i < candidates.length; i++) {
        const n = candidates[i];
        if (pool && !pool.has(n)) continue;
        if (avoid.has(n)) continue;
        if (freshCompletingTickets(realPlayers, called, n, gridOf, options.lineIndex).length !== 1) continue;
        const otherHits = freshCompletingTickets(others, called, n, gridOf, options.lineIndex).length;
        const botHits = freshCompletingTickets(botPlayers, called, n, gridOf, options.lineIndex).length;
        if (options.preferExact && botHits === botCount) return n;
        const paidBots = paidBotSeats(botHits, 1 + otherHits);
        const overflow = Math.max(0, botHits - paidBots);
        if (botHits === botCount && exact == null) exact = n;
        if (paidBots > 1) {
            const overflows = overflow > 0;
            const bestOverflows = bestGroup != null && bestOverflow > 0;
            let take = bestGroup == null;
            if (!take && !overflows && bestOverflows) take = true;
            else if (!take && overflows === bestOverflows && paidBots > bestScore) take = true;
            else if (!take && overflows === bestOverflows && paidBots === bestScore && overflow < bestOverflow) take = true;
            if (take) {
                bestGroup = n;
                bestScore = paidBots;
                bestOverflow = overflow;
            }
        }
        if (otherHits > 0 && sharedHumans == null) sharedHumans = n;
    }
    if (bestGroup != null) return bestGroup;
    if (exact != null) return exact;
    return sharedHumans;
}

function uncalledCardNumbers(players, called, gridOf, lineIndex) {
    if (lineIndex) {
        lineIndex.syncCalled(called || []);
        return lineIndex.uncalledNumbers(players);
    }
    const calledSet = new Set((called || []).map((n) => Number(n)));
    const nums = [];
    const seen = new Set();
    (players || []).forEach((player) => {
        const tickets = (player && player.ticketsData) || [];
        for (let t = 0; t < tickets.length; t++) {
            const grid = gridForTicket(tickets[t], gridOf);
            if (!Array.isArray(grid)) continue;
            for (let c = 0; c < grid.length; c++) {
                const col = grid[c] || [];
                for (let r = 0; r < col.length; r++) {
                    const val = col[r];
                    if (val === 'FREE' || val === 'free') continue;
                    const n = Number(val);
                    if (!Number.isInteger(n) || calledSet.has(n) || seen.has(n)) continue;
                    seen.add(n);
                    nums.push(n);
                }
            }
        }
    });
    return nums;
}

/**
 * A number printed on the target card and on a bot card that does not
 * complete any card. Used to build a shared line before the closing ball.
 */
function pickSharedBuilder(targetPlayers, botPlayers, called, options) {
    options = options || {};
    const pool = options.pool ? new Set(options.pool.map((n) => Number(n))) : null;
    const avoid = new Set((options.avoid || []).map((n) => Number(n)));
    const botNums = new Set(uncalledCardNumbers(botPlayers, called, options.gridOf, options.lineIndex));
    const targetNums = uncalledCardNumbers(targetPlayers, called, options.gridOf, options.lineIndex);
    for (let i = 0; i < targetNums.length; i++) {
        const n = targetNums[i];
        if (pool && !pool.has(n)) continue;
        if (avoid.has(n)) continue;
        if (!botNums.has(n)) continue;
        return n;
    }
    return null;
}

/**
 * A solo real winner is affordable when the vault that already pays a solo
 * winner can cover the full pot. Depositors use vault two. Everyone else
 * uses the virtual pool, and only inside the existing 20% cap.
 */
function soloPayoutCovered(ctx) {
    ctx = ctx || {};
    const full = Number(ctx.fullPrize) || 0;
    if (!(full > 0)) return true;
    if (ctx.depositor) return (Number(ctx.vaultTwo) || 0) >= full;
    const pool = Number(ctx.virtualPool) || 0;
    const fraction = ctx.maxSafeFraction != null ? ctx.maxSafeFraction : 0.20;
    return pool >= full && full <= pool * fraction;
}

function chooseMixedCall(ctx) {
    ctx = ctx || {};
    const called = ctx.called || [];
    const pool = ctx.pool || [];
    const gridOf = ctx.gridOf;
    const botCount = Number(ctx.botCount) || 0;
    const ceiling = ctx.ceiling != null ? ctx.ceiling : HARD_CAP_CALLS;
    const currentTurn = Number(ctx.currentTurn) || 0;
    const mustWinNow = !!ctx.mustWinNow || currentTurn >= ceiling;
    const fourCorner = ctx.fourCorner || [];
    const blocked = ctx.blockedCompleting || [];
    const completing = ctx.completing || [];
    const hardAvoid = fourCorner.concat(blocked);
    const nonWinning = [];
    for (let i = 0; i < pool.length; i++) {
        const n = pool[i];
        if (completing.indexOf(n) !== -1) continue;
        if (fourCorner.indexOf(n) !== -1) continue;
        if (blocked.indexOf(n) !== -1) continue;
        nonWinning.push(n);
    }
    const targetPlayers = ctx.targetPlayers || [];
    const botPlayers = ctx.botPlayers || [];
    const others = ctx.others || [];

    if (mustWinNow && botCount > 0) {
        const shared = pickExactSharedOneAway(targetPlayers, botPlayers, called, {
            pool,
            avoid: hardAvoid,
            botCount,
            gridOf,
            others,
            lineIndex: ctx.lineIndex
        });
        if (shared != null) return { num: shared, plan: 'shared' };

        if (currentTurn >= ceiling) {
            const soloOk = soloPayoutCovered({
                depositor: !!ctx.depositor,
                fullPrize: ctx.fullPrize,
                vaultTwo: ctx.vaultTwo,
                virtualPool: ctx.virtualPool,
                maxSafeFraction: ctx.maxSafeFraction
            });
            const otherHits = [];
            for (let p = 0; p < pool.length; p++) {
                if (freshCompletingTickets(others, called, pool[p], gridOf, ctx.lineIndex).length) otherHits.push(pool[p]);
            }
            const userAvoid = hardAvoid.concat(otherHits).concat(soloOk ? (ctx.botCompleting || []) : []);
            let userBall = pickAuthenticOneAwayNumber(targetPlayers, called, {
                pool,
                avoid: userAvoid,
                gridOf,
                lineIndex: ctx.lineIndex
            });
            if (userBall == null && soloOk) {
                userBall = pickAuthenticOneAwayNumber(targetPlayers, called, {
                    pool,
                    avoid: hardAvoid.concat(otherHits),
                    gridOf,
                    lineIndex: ctx.lineIndex
                });
            }
            if (userBall != null) return { num: userBall, plan: soloOk ? 'solo' : 'synthetic' };
            if (!nonWinning.length) {
                return { num: callableEmergencyNumber(pool, fourCorner), plan: 'emergency' };
            }
        }

        const builder = pickSharedBuilder(targetPlayers, botPlayers, called, {
            pool,
            avoid: completing.concat(hardAvoid),
            gridOf,
            lineIndex: ctx.lineIndex
        });
        if (builder != null) return { num: builder, plan: 'build' };
        if (nonWinning.length) return { num: nonWinning[0], plan: 'build' };
        return { num: callableEmergencyNumber(pool, fourCorner), plan: 'emergency' };
    }

    const earlyBuilder = pickSharedBuilder(targetPlayers, botPlayers, called, {
        pool,
        avoid: completing.concat(hardAvoid),
        gridOf,
        lineIndex: ctx.lineIndex
    });
    if (earlyBuilder != null && nonWinning.indexOf(earlyBuilder) !== -1) {
        return { num: earlyBuilder, plan: 'build' };
    }
    if (nonWinning.length) return { num: nonWinning[0], plan: 'build' };
    return { num: callableEmergencyNumber(pool, fourCorner), plan: 'emergency' };
}

/**
 * Same vault routing declareWinners already uses. allowNegative keeps the
 * chosen vault's deficit instead of clamping it to zero or moving the charge.
 */
function settleWinnerVault(balances, ctx) {
    const out = {
        virtualPrizePool: Number(balances && balances.virtualPrizePool) || 0,
        vaultTwoBalance: Number(balances && balances.vaultTwoBalance) || 0,
        vaultThreeBalance: Number(balances && balances.vaultThreeBalance) || 0
    };
    ctx = ctx || {};
    const realMoneyOut = Number(ctx.realMoneyOut) || 0;
    if (!(realMoneyOut > 0)) return { balances: out, charged: null };
    const allowNegative = !!ctx.allowNegative;
    let charged = null;
    function deduct(field) {
        out[field] = Number(out[field]) - realMoneyOut;
        if (!allowNegative && out[field] < 0) out[field] = 0;
        charged = field;
    }
    if (!ctx.isWinnerDepositor) {
        deduct('virtualPrizePool');
    } else if (ctx.realWinnersCount === 1 && ctx.botWinnersCount === 1 && ctx.totalWinners === 2) {
        deduct('vaultThreeBalance');
    } else if (ctx.totalWinners === 1 && ctx.realWinnersCount === 1) {
        if (out.vaultTwoBalance >= realMoneyOut || allowNegative) deduct('vaultTwoBalance');
        else deduct('virtualPrizePool');
    } else {
        deduct('virtualPrizePool');
    }
    return { balances: out, charged };
}

/**
 * Unexpected human 5-match against an underfunded vault. Inject bots until
 * the paid list is at most 5, keep every human, and let the vault go
 * negative. A covered solo stays solo. A bot-only result charges nothing.
 * A blocked human still takes the four-bot punishment split.
 */
function applyPanicShield(winners, ctx) {
    ctx = ctx || {};
    const list = (winners || []).slice();
    const humans = [];
    for (let i = 0; i < list.length; i++) {
        const winner = list[i];
        if (winner && winner.player && !winner.player.isBot) humans.push(winner);
    }
    if (!humans.length) {
        return {
            panic: false,
            allowNegative: false,
            reason: 'bot-only',
            winners: capWinnerList(list, 5)
        };
    }
    const calledCount = Number(ctx.calledCount) || 0;
    const plannedClose = !!ctx.plannedClose;
    const blocked = !!ctx.blocked;
    const unexpected = calledCount < 14 || !plannedClose || blocked;
    const covered = soloPayoutCovered({
        fullPrize: ctx.fullPrize,
        depositor: !!ctx.depositor,
        vaultTwo: ctx.vaultTwo,
        virtualPool: ctx.virtualPool,
        maxSafeFraction: ctx.maxSafeFraction
    });
    const needsSplit = (unexpected && !covered) || blocked;
    if (needsSplit) {
        let added = 0;
        const inject = ctx.injectBot;
        while (list.length < 5 && added < 4 && typeof inject === 'function') {
            if (!inject(list)) break;
            added += 1;
        }
        return {
            panic: true,
            allowNegative: !!(unexpected && !covered),
            reason: (blocked && covered) ? 'blocked' : 'underfunded',
            winners: capWinnerList(list, 5)
        };
    }
    if (unexpected) {
        return {
            panic: false,
            allowNegative: false,
            reason: 'vault-covered',
            winners: capWinnerList(list, 5)
        };
    }
    return {
        panic: false,
        allowNegative: false,
        reason: 'planned',
        winners: capWinnerList(list, 5)
    };
}

/**
 * Keep every real winner. Extra bot winners are dropped so injected bots
 * cannot push the paid list past the cap. Real winners above the cap stay.
 */
function capWinnerList(winners, max) {
    const list = (winners || []).slice();
    const limit = max == null ? MAX_TOTAL_WINNERS : max;
    if (list.length <= limit) return list;
    const reals = list.filter((w) => !w.player || !w.player.isBot);
    const bots = list.filter((w) => w.player && w.player.isBot).sort(() => Math.random() - 0.5);
    let slots = limit - reals.length;
    if (slots < 0) slots = 0;
    return reals.concat(bots.slice(0, slots));
}

function winnerSeatKey(winner) {
    if (!winner || !winner.player || !winner.ticket) return '';
    return String(winner.player.phone) + ':' + String(winner.ticket.id);
}

function isLockedHumanWinner(winner) {
    if (!winner || !winner.player || winner.player.isBot || !winner.ticket) return false;
    if (winner.authenticClose === true) return true;
    return winner.ticket.isClosed === true && winner.ticket.status === 'won';
}

/**
 * A human who already closed a real bingo stays in the paid list.
 * Eligibility filters may run first; they cannot remove that closer.
 */
function restoreLockedHumanWinners(filtered, original) {
    const out = (filtered || []).slice();
    const seen = new Set();
    out.forEach((winner) => {
        const key = winnerSeatKey(winner);
        if (key) seen.add(key);
    });
    (original || []).forEach((winner) => {
        if (!isLockedHumanWinner(winner)) return;
        const key = winnerSeatKey(winner);
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(winner);
    });
    return out;
}

/**
 * The paid room is capped at 5 and filled from the line index, so a real
 * card that joined after that index was built never reaches the split.
 * Every same-ball real claim is put back. A human who already closed stays
 * even when the bonus filter would have skipped them. Only extra bot seats
 * are dropped.
 */
function absorbMissedRealWinners(winners, activePlayers, committedEntries, calledNumbers, gridOf, ctx) {
    const foundRaw = collectSameBallWinners(activePlayers, committedEntries, calledNumbers, gridOf);
    const found = dropDeniedBonusWinners(foundRaw, ctx);
    const seen = new Set();
    const out = [];
    function add(winner, realOnly) {
        if (!winner || !winner.player || !winner.ticket) return;
        if (realOnly && winner.player.isBot) return;
        const key = winnerSeatKey(winner);
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push(winner);
    }
    (winners || []).forEach((winner) => add(winner, false));
    (found || []).forEach((winner) => add(winner, true));
    (foundRaw || []).forEach((winner) => {
        if (isLockedHumanWinner(winner)) add(winner, true);
    });
    return capWinnerList(out, MAX_TOTAL_WINNERS);
}

function isRestrictedFromWinning(player, ctx) {
    if (!player || player.isBot) return false;
    return !!classifyPlayer(player, ctx || {}).blocked;
}

function excludeRestrictedWinners(winners, ctx) {
    return (winners || []).filter((w) => !isRestrictedFromWinning(w && w.player, ctx));
}

/**
 * Settlement gate for the bonus win chance. A 0% setting (or a missed
 * round-start roll) removes only humans who are strictly denied: bonus
 * funds, or no approved deposit. Bots and every eligible co-winner on
 * this same ball stay, so the pot still splits across them.
 * An empty result is not a crown. The caller must keep drawing.
 * Cooldown players who staked real money stay in the list.
 */
function dropDeniedBonusWinners(winners, ctx) {
    return (winners || []).filter((w) => w && !bonusWinDenied(w.player, ctx));
}

function collectMatchingCompletingNumbers(activePlayers, calledNumbers, remaining, predicate, lineIndex) {
    const pred = typeof predicate === 'function' ? predicate : function () { return false; };
    if (lineIndex) {
        lineIndex.syncCalled(calledNumbers || []);
        return lineIndex.restrictedHits(remaining, pred).blocked;
    }
    const matched = [];
    Object.values(activePlayers || {}).forEach((player) => {
        if (!player || player.isBot || !pred(player)) return;
        (player.ticketsData || []).forEach((ticket) => {
            if (!ticket || !ticket.grid) return;
            (remaining || []).forEach((n) => {
                const temp = (calledNumbers || []).concat([n]);
                if (!checkBingo(ticket.grid, temp)) return;
                if (matched.indexOf(n) === -1) matched.push(n);
            });
        });
    });
    return matched;
}

/**
 * Numbers that would bingo an allowed bonus or zero-deposit player and
 * nobody else. Those stay off the draw avoid list so the round-start
 * bonus roll can actually be won. Numbers that also finish a standard
 * card, a bot, or a still-blocked card stay avoided.
 */
function allowedBonusReleaseNumbers(activePlayers, calledNumbers, remaining, ctx, lineIndex, alsoKeep) {
    if (!ctx || !ctx.allowBonusWin) return [];
    const bonusNums = collectMatchingCompletingNumbers(activePlayers, calledNumbers, remaining, function (player) {
        return stakeUsesBonusFunds(player) && !isRestrictedFromWinning(player, ctx);
    }, lineIndex);
    const standardNums = collectMatchingCompletingNumbers(activePlayers, calledNumbers, remaining, function (player) {
        return !stakeUsesBonusFunds(player) && !isRestrictedFromWinning(player, ctx);
    }, lineIndex);
    const keep = new Set((alsoKeep || []).concat(standardNums).map((n) => Number(n)));
    return bonusNums.filter((n) => !keep.has(Number(n)));
}

function collectRestrictedCompletingNumbers(activePlayers, calledNumbers, remaining, ctx, lineIndex) {
    if (lineIndex) {
        lineIndex.syncCalled(calledNumbers || []);
        return lineIndex.restrictedHits(remaining, function (player) {
            return isRestrictedFromWinning(player, ctx);
        });
    }
    const blocked = [];
    const fourCorner = [];
    Object.values(activePlayers || {}).forEach((player) => {
        if (!player || player.isBot || !isRestrictedFromWinning(player, ctx)) return;
        (player.ticketsData || []).forEach((ticket) => {
            if (!ticket || !ticket.grid) return;
            (remaining || []).forEach((n) => {
                const temp = (calledNumbers || []).concat([n]);
                if (!checkBingo(ticket.grid, temp)) return;
                if (blocked.indexOf(n) === -1) blocked.push(n);
                if (checkFourCorners(ticket.grid, temp) && fourCorner.indexOf(n) === -1) fourCorner.push(n);
            });
        });
    });
    return { blocked, fourCorner };
}

function claimId(player, ticket) {
    return String(player.phone) + ':' + String(ticket.id);
}

function cardNumber(ticket) {
    const id = Number(ticket && ticket.id);
    return Number.isInteger(id) ? id : null;
}

function cloneGrid(grid) {
    if (!Array.isArray(grid)) return grid;
    return grid.map((col) => (Array.isArray(col) ? col.slice() : col));
}

function blankMarks() {
    return [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0]
    ];
}

function cloneMarks(marks) {
    if (!Array.isArray(marks)) return blankMarks();
    const out = blankMarks();
    for (let c = 0; c < 5; c++) {
        const col = marks[c];
        for (let r = 0; r < 5; r++) {
            out[c][r] = col && col[r] ? 1 : 0;
        }
    }
    out[2][2] = 1;
    return out;
}

function sameCalledValue(val, num) {
    if (val === num) return true;
    const a = Number(val);
    const b = Number(num);
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

/**
 * The same 5x5 mark grid real players keep on the client: center is already
 * dabbed, and a called number flips only the cell that already holds it.
 */
function ensureMarkGrid(ticket) {
    if (!ticket) return null;
    const source = ticket.marksObj || ticket.marks;
    const marks = cloneMarks(source);
    ticket.marks = marks;
    ticket.marksObj = marks;
    return marks;
}

function markNumberOnTicket(ticket, num) {
    if (!ticket || !Array.isArray(ticket.grid)) return ticket;
    const marks = ensureMarkGrid(ticket);
    for (let c = 0; c < 5; c++) {
        const col = ticket.grid[c];
        if (!Array.isArray(col)) continue;
        for (let r = 0; r < 5; r++) {
            if (c === 2 && r === 2) {
                marks[c][r] = 1;
                continue;
            }
            if (sameCalledValue(col[r], num)) marks[c][r] = 1;
        }
    }
    return ticket;
}

function markCalledNumbersOnTicket(ticket, called) {
    if (!ticket) return ticket;
    ensureMarkGrid(ticket);
    (called || []).forEach((num) => markNumberOnTicket(ticket, num));
    return ticket;
}

function markCalledNumbersOnPlayers(players, called) {
    Object.values(players || {}).forEach((player) => {
        (player && player.ticketsData || []).forEach((ticket) => {
            markCalledNumbersOnTicket(ticket, called);
        });
    });
    return players;
}

/**
 * A line counts only where the original cell is dabbed AND that number was
 * actually called. Marks on numbers that were never drawn do not complete.
 */
function markedCalledNumbers(ticket, called) {
    const calledSet = new Set((called || []).map((n) => Number(n)).filter((n) => Number.isFinite(n)));
    const marks = ticket && (ticket.marks || ticket.marksObj);
    const grid = ticket && ticket.grid;
    const out = [];
    if (!marks || !Array.isArray(grid)) return out;
    for (let c = 0; c < 5; c++) {
        const col = grid[c];
        if (!Array.isArray(col) || !marks[c]) continue;
        for (let r = 0; r < 5; r++) {
            if (c === 2 && r === 2) continue;
            if (!marks[c][r]) continue;
            const n = Number(col[r]);
            if (calledSet.has(n)) out.push(n);
        }
    }
    return out;
}

function markedCardCompletes(ticket, called) {
    if (!ticket || !Array.isArray(ticket.grid)) return false;
    return checkBingo(ticket.grid, markedCalledNumbers(ticket, called));
}

/**
 * Dab every called number on the assigned grid, then close the ticket only
 * when that marked card has a real pattern. The grid numbers are not changed.
 */
function closeWinningTicket(ticket, called) {
    if (!ticket || !Array.isArray(ticket.grid)) return false;
    markCalledNumbersOnTicket(ticket, called);
    if (!markedCardCompletes(ticket, called)) {
        ticket.isClosed = false;
        if (ticket.status === 'won') ticket.status = 'active';
        return false;
    }
    ticket.isClosed = true;
    ticket.status = 'won';
    return true;
}

/**
 * One winning card index pays once. A second holder of the same card
 * is not a second claim and does not take another share of the pot.
 */
function dedupeWinnersByCard(winners) {
    const seen = new Set();
    const out = [];
    (winners || []).forEach((winner) => {
        const id = cardNumber(winner && winner.ticket);
        if (id == null || seen.has(id)) return;
        seen.add(id);
        out.push(winner);
    });
    return out;
}

/**
 * Synchronously walk every seated card in insertion order and register every
 * valid 5-match on this exact tick. Never stop at the first hit.
 */
function collectBingoClaims(activePlayers, calledNumbers) {
    const claims = [];
    const seen = new Set();
    const players = Object.values(activePlayers || {}).slice().sort((a, b) => {
        return String((a && a.phone) || '').localeCompare(String((b && b.phone) || ''));
    });

    for (let i = 0; i < players.length; i++) {
        const player = players[i];
        if (!player) continue;
        const tickets = (player.ticketsData || []).slice().sort((a, b) => Number(a && a.id) - Number(b && b.id));
        for (let t = 0; t < tickets.length; t++) {
            const ticket = tickets[t];
            if (!ticket || !ticket.grid) continue;
            if (!checkBingo(ticket.grid, calledNumbers)) continue;
            const id = claimId(player, ticket);
            if (seen.has(id)) continue;
            seen.add(id);
            claims.push({
                claimId: id,
                player,
                ticket,
                tick: (calledNumbers || []).length,
                registeredAt: Date.now()
            });
        }
    }
    return claims;
}

function findSeatedPlayer(seated, phone) {
    const want = String(phone);
    if (seated && seated[want]) return seated[want];
    const keys = Object.keys(seated || {});
    for (let i = 0; i < keys.length; i++) {
        const player = seated[keys[i]];
        if (player && String(player.phone) === want) return player;
    }
    return null;
}

function findTicket(player, ticketId) {
    const id = Number(ticketId);
    const tickets = (player && player.ticketsData) || [];
    for (let i = 0; i < tickets.length; i++) {
        if (Number(tickets[i] && tickets[i].id) === id) return tickets[i];
    }
    return null;
}

function pushClaim(claims, seen, player, ticket, calledNumbers) {
    if (!player || !ticket || !ticket.grid) return;
    if (!checkBingo(ticket.grid, calledNumbers)) return;
    const id = claimId(player, ticket);
    if (seen.has(id)) return;
    seen.add(id);
    claims.push({
        claimId: id,
        player,
        ticket,
        tick: (calledNumbers || []).length,
        registeredAt: Date.now()
    });
}

/**
 * Auto-pass / skip guard: every committed round entry with a grid is treated
 * as an active participating card. Missing seats are hydrated first so a
 * registered card (e.g. #504) cannot be omitted from the claim walk.
 * Claims are recorded in committed-entry order so an earlier lock-in cannot
 * be bypassed by a later seat.
 */
function collectBingoClaimsFromCommitted(activePlayers, committedEntries, calledNumbers) {
    const { hydratePlayersFromEntries } = require('./roundRegistry');
    const seated = hydratePlayersFromEntries(activePlayers || {}, committedEntries || []);
    const claims = [];
    const seen = new Set();

    (committedEntries || []).forEach((entry) => {
        if (!entry || entry.status === 'cancelled') return;
        const phone = String(entry.phone);
        const player = findSeatedPlayer(seated, phone);
        if (!player) return;
        player.inactive = false;
        const ticket = findTicket(player, entry.ticketId) || (entry.ticket ? entry.ticket : {
            id: Number(entry.ticketId),
            grid: entry.grid
        });
        if (ticket) ticket.inactive = false;
        pushClaim(claims, seen, player, ticket, calledNumbers);
    });

    const leftover = collectBingoClaims(seated, calledNumbers);
    leftover.forEach((claim) => {
        if (seen.has(claim.claimId)) return;
        seen.add(claim.claimId);
        claims.push(claim);
    });
    return claims;
}

function evaluateBingoTick(activePlayers, committedEntries, calledNumbers) {
    const claims = collectBingoClaimsFromCommitted(activePlayers, committedEntries, calledNumbers);
    const locked = claims.length > 0;
    return {
        claims,
        lockRound: locked,
        lockReason: locked ? USER_5_MATCH_LOCK : null,
        claimIds: claims.map((c) => c.claimId)
    };
}

/**
 * Every card that bingos on this exact called list. The walk does not stop
 * at the first hit: a second player, or a bot, who finished on this same
 * ball is a co-winner. `gridOf` may replace a ticket with its frozen grid
 * before the check. One card number is paid once.
 */
function collectSameBallWinners(activePlayers, committedEntries, calledNumbers, gridOf) {
    const { hydratePlayersFromEntries } = require('./roundRegistry');
    const seated = hydratePlayersFromEntries(activePlayers || {}, committedEntries || []);
    if (typeof gridOf === 'function') {
        const players = Object.values(seated);
        for (let i = 0; i < players.length; i++) {
            const tickets = (players[i] && players[i].ticketsData) || [];
            for (let t = 0; t < tickets.length; t++) {
                const ticket = tickets[t];
                if (!ticket) continue;
                const grid = gridOf(ticket);
                if (Array.isArray(grid)) ticket.grid = grid;
            }
        }
    }
    const claims = collectBingoClaimsFromCommitted(seated, committedEntries, calledNumbers);
    for (let i = 0; i < claims.length; i++) claims[i].authenticClose = true;
    return claims;
}

/**
 * Original bingo claims always stay in front. Virtual / house validators may
 * be appended, but a registered completing card is never dropped or replaced.
 */
function mergePreservedClaims(resolvedWinners, originalClaims) {
    const winners = [];
    const seen = new Set();
    (originalClaims || []).forEach((c) => {
        if (!c) return;
        const id = c.claimId || claimId(c.player, c.ticket);
        if (seen.has(id)) return;
        seen.add(id);
        winners.push(c);
    });
    (resolvedWinners || []).forEach((c) => {
        if (!c) return;
        const id = c.claimId || claimId(c.player, c.ticket);
        if (seen.has(id)) return;
        seen.add(id);
        winners.push(c);
    });
    return winners;
}

function uniquePhones(activePlayers, committedEntries, winners) {
    const set = new Set();
    Object.values(activePlayers || {}).forEach((p) => {
        if (p && p.phone) set.add(String(p.phone));
    });
    (committedEntries || []).forEach((e) => {
        if (e && e.phone && e.status !== 'cancelled') set.add(String(e.phone));
    });
    (winners || []).forEach((w) => {
        if (w && w.player && w.player.phone) set.add(String(w.player.phone));
    });
    return Array.from(set);
}

/**
 * One-tick winner pipeline used by the live loop and by simulations:
 * evaluate every committed card, lock if anyone has bingo, keep every
 * legitimate claim, then shape history / broadcast payload.
 */
function finalizeBingoRound(activePlayers, committedEntries, calledNumbers, ctx) {
    ctx = ctx || {};
    const tick = evaluateBingoTick(activePlayers, committedEntries, calledNumbers);
    if (!tick.lockRound) {
        return { locked: false, lockReason: null, winners: [], tick, history: null, shouldBroadcast: false };
    }
    const resolved = resolveConcurrentClaims(tick.claims, ctx);
    const winners = capWinnerList(mergePreservedClaims(resolved.winners, tick.claims), MAX_TOTAL_WINNERS);
    const totalPrize = Number(ctx.totalPrize || 0);
    const winnerPayout = computeEvenSplit(totalPrize, winners.length);
    const winnerPhoneList = winners.map((w) => String(w.player.phone));
    return {
        locked: true,
        lockReason: tick.lockReason || USER_5_MATCH_LOCK,
        winners,
        tick,
        resolved,
        shouldBroadcast: winners.length > 0,
        history: {
            winnerPhoneList,
            winnerPayout,
            prize: totalPrize,
            participantPhones: uniquePhones(activePlayers, committedEntries, winners),
            calledNumbers: (calledNumbers || []).slice(),
            ticketIds: winners.map((w) => w.ticket && w.ticket.id)
        }
    };
}

function isBlockedClaim(claim, ctx) {
    if (!claim || !claim.player || claim.player.isBot) return false;
    if (isRestrictedFromWinning(claim.player, ctx)) return true;
    return isPunishedPlayer(claim.player.phone, ctx || {});
}

/**
 * A legal bingo column never repeats a number. FREE is the center and is
 * not a called number, so it is skipped.
 */
function gridColumnsAreUnique(grid) {
    if (!Array.isArray(grid) || grid.length < 5) return false;
    for (let c = 0; c < 5; c++) {
        const col = grid[c];
        if (!Array.isArray(col)) return false;
        const seen = new Set();
        for (let r = 0; r < col.length; r++) {
            const val = col[r];
            if (val === 'FREE' || val === 'free' || val == null || val === '') continue;
            const n = Number(val);
            if (!Number.isInteger(n) || seen.has(n)) return false;
            seen.add(n);
        }
    }
    return true;
}

/**
 * Grid saved for admin history. The assigned snapshot is the card that was
 * dealt and played. A rewritten ticket grid is ignored while that snapshot
 * still has one number per column. A duplicate-column grid is not saved.
 */
function playedGridForHistory(ticket, assignedGrid) {
    if (gridColumnsAreUnique(assignedGrid)) return assignedGrid;
    const seated = ticket && ticket.grid;
    if (seated !== assignedGrid && gridColumnsAreUnique(seated)) return seated;
    return null;
}

/**
 * The dealt card is the only card. Called numbers are not written onto it,
 * so a column cannot gain a second copy of a ball and a purchased grid is
 * never rewritten to look like a bingo. The source grid is not copied and
 * is not mutated. Payout marking is closeWinningTicket, which only stamps a
 * card whose own numbers already complete.
 */
function closeBotKartela(grid, calledNums, winNum) {
    return grid;
}

/**
 * Keep the ticket on the grid it was dealt. A payout helper may run, but it
 * cannot replace purchased cells. The dealt layout is restored afterwards,
 * including when the helper throws. Returns that same grid for payout
 * tracking; it is not required to be a completed pattern.
 */
function sealBotTicket(tix, calledNumbers, winNum, makeNaturalBotTicket) {
    if (!tix) return null;
    const dealt = cloneGrid(tix.grid);
    if (typeof makeNaturalBotTicket === 'function') {
        try {
            makeNaturalBotTicket(tix, calledNumbers, winNum);
        } catch (e) {}
    }
    if (!Array.isArray(dealt)) return null;
    tix.grid = dealt;
    return tix.grid;
}

function createVirtualValidator(helpers, calledNumbers, numToCall, ticketPrice, seen, seenCards) {
    const makeNaturalBotTicket = helpers.makeNaturalBotTicket;
    const getUnusedFakeTicketId = helpers.getUnusedFakeTicketId;
    const generateFixedCard = helpers.generateFixedCard;

    function cardTaken(ticket) {
        const id = cardNumber(ticket);
        return id != null && seenCards && seenCards.has(id);
    }

    let stealthBot = helpers.pickBot && helpers.pickBot();
    while (stealthBot) {
        const ticket = stealthBot.ticketsData && stealthBot.ticketsData[0] ? stealthBot.ticketsData[0] : { id: '' };
        const existingId = claimId(stealthBot, ticket);
        if ((!seen || !seen.has(existingId)) && !cardTaken(ticket)) break;
        stealthBot = helpers.pickBot && helpers.pickBot();
    }
    if (!stealthBot) {
        const tixId = getUnusedFakeTicketId && getUnusedFakeTicketId();
        if (!tixId || (seenCards && seenCards.has(Number(tixId)))) return null;
        const fakePhone = '09' + Math.floor(10000000 + Math.random() * 90000000);
        stealthBot = {
            name: 'User',
            phone: fakePhone,
            isBot: true,
            ticketsData: [{ id: tixId, grid: generateFixedCard(tixId) }]
        };
    }

    const stealthTix = stealthBot.ticketsData[0];
    if (!stealthTix || cardTaken(stealthTix)) return null;
    const closedGrid = sealBotTicket(stealthTix, calledNumbers, numToCall, makeNaturalBotTicket);
    if (!closedGrid) return null;
    return {
        claimId: claimId(stealthBot, stealthTix),
        player: stealthBot,
        ticket: {
            id: stealthTix.id,
            grid: cloneGrid(closedGrid),
            paidFromPlay: ticketPrice,
            paidFromMain: 0
        },
        tick: (calledNumbers || []).length,
        virtual: true
    };
}

/**
 * Resolve concurrent 5-match claims on a single draw tick.
 * - Every real claim already collected is kept (never skipped).
 * - Pre-13 completions immediately take the 4-validator dilution fallback.
 * - Room dilution / blocked-winner rules may add up to 4 virtual validators.
 * - Prize split is even across the final validated claim list (caller pays).
 */
function resolveConcurrentClaims(claims, ctx) {
    ctx = ctx || {};
    const calledNumbers = ctx.calledNumbers || [];
    const currentTurn = ctx.currentTurn != null ? ctx.currentTurn : calledNumbers.length;
    const forceWinner = ctx.forceWinner;
    const mixBotCount = ctx.mixBotCount;
    const ticketPrice = ctx.ticketPrice || 0;
    const helpers = ctx.helpers || {};
    const botPlayers = (ctx.botPlayers || []).slice().sort(() => Math.random() - 0.5);
    const maxVirtual = ctx.maxVirtualValidators != null ? ctx.maxVirtualValidators : MAX_VIRTUAL_VALIDATORS;
    const maxTotal = ctx.maxTotalWinners != null ? ctx.maxTotalWinners : MAX_TOTAL_WINNERS;

    const seen = new Set();
    const seenCards = new Set();
    let winners = [];
    (claims || []).forEach((c) => {
        const id = c.claimId || claimId(c.player, c.ticket);
        const cardId = cardNumber(c.ticket);
        if (seen.has(id) || (cardId != null && seenCards.has(cardId))) return;
        seen.add(id);
        if (cardId != null) seenCards.add(cardId);
        winners.push(c);
    });

    const earlyWin = !canResolveRound(currentTurn);
    let hasBlockedWinner = earlyWin;
    winners.forEach((w) => {
        if (isBlockedClaim(w, ctx)) hasBlockedWinner = true;
    });
    const isEarlyCompletion = earlyWin && winners.length > 0;

    const pickBot = () => botPlayers.pop();
    const validatorHelpers = Object.assign({ pickBot }, helpers);

    if (hasBlockedWinner || isEarlyCompletion) {
        const toAdd = Math.min(maxVirtual, MAX_VIRTUAL_VALIDATORS);
        let added = 0;
        let attempts = 0;
        const maxAttempts = toAdd + (botPlayers.length || 0) + 2;
        while (added < toAdd && attempts < maxAttempts) {
            attempts += 1;
            const v = createVirtualValidator(validatorHelpers, calledNumbers, ctx.numToCall, ticketPrice, seen, seenCards);
            const cardId = cardNumber(v && v.ticket);
            if (!v || seen.has(v.claimId) || (cardId != null && seenCards.has(cardId))) continue;
            seen.add(v.claimId);
            if (cardId != null) seenCards.add(cardId);
            winners.push(v);
            added += 1;
        }
    }

    const actualReals = winners.filter((w) => !w.player.isBot);
    if ((forceWinner === 'mix' || forceWinner === 'mix_dep') && actualReals.length > 0 && !hasBlockedWinner) {
        const mixCount = mixBotCount === 0 ? 0 : (mixBotCount || 1);
        const toAdd = Math.min(mixCount, botPlayers.length, maxVirtual);
        for (let i = 0; i < toAdd; i++) {
            const b = pickBot();
            if (!b || !b.ticketsData || !b.ticketsData[0]) continue;
            const tix = b.ticketsData[0];
            const closedGrid = sealBotTicket(tix, calledNumbers, ctx.numToCall, helpers.makeNaturalBotTicket);
            if (!closedGrid) continue;
            const v = {
                claimId: claimId(b, tix),
                player: b,
                ticket: {
                    id: tix.id,
                    grid: cloneGrid(closedGrid),
                    paidFromPlay: ticketPrice,
                    paidFromMain: 0
                },
                tick: calledNumbers.length,
                virtual: true
            };
            const cardId = cardNumber(tix);
            if (seen.has(v.claimId) || (cardId != null && seenCards.has(cardId))) continue;
            seen.add(v.claimId);
            if (cardId != null) seenCards.add(cardId);
            winners.push(v);
        }
    }

    if (winners.length > maxTotal) {
        const realWinArray = winners.filter((w) => !w.player.isBot);
        const botWinArray = winners.filter((w) => w.player.isBot).sort(() => Math.random() - 0.5);
        const slotsForBots = Math.max(0, maxTotal - realWinArray.length);
        winners = realWinArray.concat(botWinArray.slice(0, slotsForBots));
    }

    winners = dedupeWinnersByCard(winners);

    return {
        winners,
        hasBlockedWinner,
        isEarlyCompletion,
        actualReals,
        claimIds: winners.map((w) => w.claimId || claimId(w.player, w.ticket)),
        shouldDispatch: winners.length > 0
    };
}

/**
 * Even split used by declareWinners — kept here so tests can lock the formula
 * without touching treasury vault routing.
 */
function computeEvenSplit(totalPrize, winnerCount) {
    if (!winnerCount) return 0;
    return Number((totalPrize / winnerCount).toFixed(2));
}

/**
 * Grid sent on game_winner. The assigned snapshot is the card that was dealt
 * and played, including a bot on a split. A ticket grid is used only when no
 * assigned snapshot was supplied.
 */
function splitWinnerBroadcastGrid(winner, isSplit, assignedGrid) {
    if (Array.isArray(assignedGrid)) return assignedGrid;
    const ticketGrid = winner && winner.ticket && winner.ticket.grid;
    return Array.isArray(ticketGrid) ? ticketGrid : assignedGrid;
}

function drawProfile(forceWinner, botCount) {
    const mix = Number(botCount) || 0;
    if (forceWinner === 'bots') return 'bot';
    if ((forceWinner === 'mix' || forceWinner === 'mix_dep') && mix > 0) return 'mixed';
    return 'user';
}

function rngOf(ctx) {
    return ctx && typeof ctx.rng === 'function' ? ctx.rng : Math.random;
}

function enumerateCardLines(players, gridOf, lineIndex) {
    if (lineIndex) return lineIndex.enumerateLines(players);
    const out = [];
    (players || []).forEach((player) => {
        const tickets = (player && player.ticketsData) || [];
        for (let t = 0; t < tickets.length; t++) {
            const ticket = tickets[t];
            const grid = gridForTicket(ticket, gridOf);
            if (!Array.isArray(grid)) continue;
            const lines = bingoLines(grid);
            for (let i = 0; i < lines.length; i++) {
                const nums = [];
                const seen = new Set();
                for (let k = 0; k < lines[i].length; k++) {
                    const val = lines[i][k];
                    if (isFreeCell(val)) continue;
                    const n = Number(val);
                    if (!Number.isInteger(n) || n < 1 || n > 75 || seen.has(n)) continue;
                    seen.add(n);
                    nums.push(n);
                }
                if (nums.length >= 2) out.push({ player, ticket, lineIndex: i, nums });
            }
        }
    });
    return out;
}

function closerStaysSolo(closer, builderSet, opponentLines, calledSet, lineIndex, opponents) {
    if (lineIndex) {
        lineIndex.markPlayers(opponents || []);
        const lines = lineIndex.linesTouching(closer);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!lineIndex.isMarked(line)) continue;
            const nums = line.nums;
            let extra = 0;
            for (let k = 0; k < nums.length; k++) {
                const n = nums[k];
                if (n === closer || calledSet.has(n) || builderSet.has(n)) continue;
                extra += 1;
            }
            if (extra === 0) return false;
        }
        return true;
    }
    for (let i = 0; i < opponentLines.length; i++) {
        const nums = opponentLines[i].nums;
        if (nums.indexOf(closer) === -1) continue;
        let extra = 0;
        for (let k = 0; k < nums.length; k++) {
            const n = nums[k];
            if (n === closer || calledSet.has(n) || builderSet.has(n)) continue;
            extra += 1;
        }
        if (extra === 0) return false;
    }
    return true;
}

function ticketScratch(lineIndex) {
    let scratch = lineIndex._scratch;
    if (!scratch) {
        scratch = lineIndex._scratch = {
            stamp: new Int32Array(4096),
            best: new Int16Array(4096),
            order: new Int32Array(4096),
            line: new Array(4096),
            q: 1
        };
    }
    return scratch;
}

function markSeated(lineIndex, players, field) {
    if (!lineIndex._seatQ) lineIndex._seatQ = 0;
    const q = ++lineIndex._seatQ;
    const byPlayer = lineIndex.byPlayer;
    const list = players || [];
    for (let i = 0; i < list.length; i++) {
        const cards = byPlayer.get(list[i]);
        if (!cards) continue;
        for (let c = 0; c < cards.length; c++) cards[c][field] = q;
    }
    return q;
}

function missingInOrder(nums, calledSet) {
    const missing = [];
    for (let k = 0; k < nums.length; k++) {
        if (!calledSet.has(nums[k])) missing.push(nums[k]);
    }
    return missing;
}

function bestBotLine(lineIndex, closer, botMark) {
    const heads = lineIndex.botHead && lineIndex.botHead[closer];
    if (!heads) return null;
    for (let count = 1; count <= 5; count++) {
        let node = heads[count];
        while (node) {
            const line = node.line;
            const card = line.card;
            if (!line.dead && !card.dead && card.botQ === botMark) return line;
            node = node.next;
        }
    }
    return null;
}

function seatBotTops(lineIndex, botMark, botCount, scratch) {
    const headsAll = lineIndex.botHead;
    const tops = scratch.botTops || (scratch.botTops = new Array(76));
    const rows = scratch.botRows || (scratch.botRows = []);
    scratch.rowUsed = 0;
    for (let n = 1; n <= 75; n++) {
        const top = tops[n] || (tops[n] = []);
        top.length = 0;
        const heads = headsAll ? headsAll[n] : null;
        if (!heads) continue;
        let q = ++scratch.q;
        if (q === 2147483647) {
            scratch.stamp.fill(0);
            q = scratch.q = 1;
        }
        for (let count = 1; count <= 5 && top.length < botCount; count++) {
            let node = heads[count];
            while (node && top.length < botCount) {
                const line = node.line;
                node = node.next;
                const card = line.card;
                if (line.dead || card.dead || card.botQ !== botMark) continue;
                const id = Number(line.ticket && line.ticket.id);
                if (!Number.isInteger(id) || id < 0 || id >= scratch.stamp.length) continue;
                if (scratch.stamp[id] === q) continue;
                scratch.stamp[id] = q;
                const row = rows[scratch.rowUsed] || (rows[scratch.rowUsed] = { id: 0, count: 0, order: 0, line: null });
                scratch.rowUsed += 1;
                row.id = id;
                row.count = count;
                row.order = card.firstBirth ? card.firstBirth[n] : (line.idx + 1);
                row.line = line;
                top.push(row);
            }
        }
        if (top.length > 1) top.sort(function (a, b) { return a.count - b.count || a.order - b.order; });
    }
    return tops;
}

function listSharedPlansFromIndex(ctx, called, calledSet, poolSet, blocked, corners, builderAvoid) {
    const lineIndex = ctx.lineIndex;
    const botCount = Math.max(1, Number(ctx.botCount) || 1);
    const targetLines = lineIndex.enumerateLines(ctx.targetPlayers);
    const botMark = markSeated(lineIndex, ctx.botPlayers, 'botQ');
    const scratch = ticketScratch(lineIndex);
    const tops = botCount === 1 ? null : seatBotTops(lineIndex, botMark, botCount, scratch);
    if (!scratch.seen) scratch.seen = new Uint8Array(76);
    const seenNum = scratch.seen;
    const drafts = [];
    for (let t = 0; t < targetLines.length; t++) {
        const userLine = targetLines[t];
        const userMissing = missingInOrder(userLine.nums, calledSet);
        for (let u = 0; u < userMissing.length; u++) {
            const closer = userMissing[u];
            if (!poolSet.has(closer) || blocked.has(closer) || corners.has(closer)) continue;
            let nq = ++scratch.numQ;
            if (!scratch.numQ || nq >= 255) {
                seenNum.fill(0);
                nq = scratch.numQ = 1;
            }
            let userCost = 0;
            for (let i = 0; i < userMissing.length; i++) {
                const n = userMissing[i];
                if (n === closer || seenNum[n] === nq) continue;
                seenNum[n] = nq;
                userCost += 1;
            }
            if (botCount === 1) {
                const bestLine = bestBotLine(lineIndex, closer, botMark);
                if (!bestLine) continue;
                let cost = userCost;
                const miss = bestLine.miss;
                for (let k = 0; k < bestLine.missCount; k++) {
                    const n = miss[k];
                    if (n === closer || seenNum[n] === nq) continue;
                    seenNum[n] = nq;
                    cost += 1;
                }
                drafts.push({
                    closer: closer,
                    cost: cost,
                    userMissing: userMissing,
                    lines: [bestLine]
                });
                continue;
            }
            const top = tops[closer];
            if (!top || top.length < botCount) continue;
            let cost = userCost;
            const chosen = [];
            for (let c = 0; c < botCount; c++) {
                const line = top[c].line;
                chosen.push(line);
                const miss = line.miss;
                for (let k = 0; k < line.missCount; k++) {
                    const n = miss[k];
                    if (n === closer || seenNum[n] === nq) continue;
                    seenNum[n] = nq;
                    cost += 1;
                }
            }
            drafts.push({
                closer: closer,
                cost: cost,
                userMissing: userMissing,
                lines: chosen
            });
        }
    }
    drafts.sort(function (a, b) { return a.cost - b.cost || a.closer - b.closer; });
    const plans = [];
    const limit = ctx.profile === 'mixed' ? 1 : 8;
    const seenKey = new Set();
    for (let i = 0; i < drafts.length && plans.length < limit; i++) {
        const draft = drafts[i];
        const builderSet = new Set();
        const userMissing = draft.userMissing;
        for (let u = 0; u < userMissing.length; u++) {
            if (userMissing[u] !== draft.closer) builderSet.add(userMissing[u]);
        }
        const chosen = draft.lines;
        for (let c = 0; c < chosen.length; c++) {
            const missing = missingInOrder(chosen[c].nums, calledSet);
            for (let k = 0; k < missing.length; k++) {
                if (missing[k] !== draft.closer) builderSet.add(missing[k]);
            }
        }
        const builders = Array.from(builderSet);
        if (builders.some(function (n) { return !poolSet.has(n) || builderAvoid.has(n); })) continue;
        const key = draft.closer + ':' + builders.slice().sort(function (a, b) { return a - b; }).join(',');
        if (seenKey.has(key)) continue;
        seenKey.add(key);
        const future = called.concat(builders);
        const counts = lineIndex.freshGroupCounts(ctx.targetPlayers, ctx.botPlayers, ctx.others, future, draft.closer);
        if (counts.target !== 1 || counts.bots < botCount || counts.others) continue;
        plans.push({ closer: draft.closer, builders: builders, ready: builders.length === 0, botHits: counts.bots });
    }
    plans.sort(function (a, b) {
        return (b.botHits - a.botHits) || (a.builders.length - b.builders.length) || (a.closer - b.closer);
    });
    return plans.slice(0, limit);
}

function listSharedPlans(ctx) {
    const called = ctx.called || [];
    const calledSet = new Set(called.map((n) => Number(n)));
    const poolSet = ctx.poolSet;
    const blocked = ctx.blockedSet;
    const corners = ctx.cornerSet;
    const builderAvoid = ctx.builderAvoid;
    if (ctx.lineIndex) {
        return listSharedPlansFromIndex(ctx, called, calledSet, poolSet, blocked, corners, builderAvoid);
    }
    const gridOf = ctx.gridOf;
    const botCount = Math.max(1, Number(ctx.botCount) || 1);
    const lineIndex = ctx.lineIndex;
    const targetLines = enumerateCardLines(ctx.targetPlayers, gridOf, lineIndex);
    const botMark = lineIndex ? markSeated(lineIndex, ctx.botPlayers, 'botQ') : 0;
    const scratch = lineIndex ? ticketScratch(lineIndex) : null;
    let botsByCloser = null;
    if (!lineIndex) {
        const botLines = enumerateCardLines(ctx.botPlayers, gridOf);
        botsByCloser = new Map();
        for (let i = 0; i < botLines.length; i++) {
            const line = botLines[i];
            const nums = line.nums;
            for (let k = 0; k < nums.length; k++) {
                const n = nums[k];
                if (calledSet.has(n)) continue;
                let bucket = botsByCloser.get(n);
                if (!bucket) {
                    bucket = [];
                    botsByCloser.set(n, bucket);
                }
                bucket.push(line);
            }
        }
    }
    const drafts = [];
    const seen = new Set();
    for (let t = 0; t < targetLines.length; t++) {
        const userLine = targetLines[t];
        const userMissing = missingInOrder(userLine.nums, calledSet);
        for (let u = 0; u < userMissing.length; u++) {
            const closer = userMissing[u];
            if (!poolSet.has(closer) || blocked.has(closer) || corners.has(closer)) continue;
            const holding = lineIndex ? lineIndex.botLinesTouching(closer) : (botsByCloser.get(closer) || []);
            const chosenLines = [];
            if (lineIndex) {
                let q = ++scratch.q;
                if (q === 2147483647) {
                    scratch.stamp.fill(0);
                    q = scratch.q = 1;
                }
                const top = [];
                let seq = 0;
                function consider(id, count) {
                    for (let w = 0; w < top.length; w++) {
                        if (top[w].id !== id) continue;
                        top[w].count = count;
                        return;
                    }
                    const row = { id: id, count: count, order: scratch.order[id] };
                    if (top.length < botCount) {
                        top.push(row);
                        return;
                    }
                    let worst = 0;
                    for (let w = 1; w < top.length; w++) {
                        const worseCount = top[w].count > top[worst].count;
                        const laterTie = top[w].count === top[worst].count && top[w].order > top[worst].order;
                        if (worseCount || laterTie) worst = w;
                    }
                    if (count < top[worst].count) top[worst] = row;
                }
                for (let b = 0; b < holding.length; b++) {
                    const line = holding[b];
                    const card = line.card;
                    if (line.dead || card.dead || card.botQ !== botMark) continue;
                    const id = Number(line.ticket && line.ticket.id);
                    if (!Number.isInteger(id) || id < 0 || id >= scratch.stamp.length) continue;
                    const count = line.missCount;
                    if (scratch.stamp[id] !== q) {
                        scratch.stamp[id] = q;
                        scratch.best[id] = count;
                        scratch.line[id] = line;
                        scratch.order[id] = ++seq;
                        consider(id, count);
                    } else if (count < scratch.best[id]) {
                        scratch.best[id] = count;
                        scratch.line[id] = line;
                        consider(id, count);
                    }
                }
                if (top.length < botCount) continue;
                top.sort(function (a, b) { return a.count - b.count || a.order - b.order; });
                for (let c = 0; c < botCount; c++) chosenLines.push(scratch.line[top[c].id]);
            } else {
                const perTicket = new Map();
                for (let b = 0; b < holding.length; b++) {
                    const line = holding[b];
                    const id = Number(line.ticket && line.ticket.id);
                    const count = line.nums.reduce(function (sum, n) { return sum + (calledSet.has(n) ? 0 : 1); }, 0);
                    const prev = perTicket.get(id);
                    if (!prev || count < prev.count) perTicket.set(id, { line: line, count: count });
                }
                const ranked = Array.from(perTicket.values()).sort(function (a, b) { return a.count - b.count; });
                if (ranked.length < botCount) continue;
                for (let c = 0; c < botCount; c++) chosenLines.push(ranked[c].line);
            }
            const builderSet = new Set();
            for (let i = 0; i < userMissing.length; i++) {
                if (userMissing[i] !== closer) builderSet.add(userMissing[i]);
            }
            for (let c = 0; c < chosenLines.length; c++) {
                const missing = missingInOrder(chosenLines[c].nums, calledSet);
                for (let k = 0; k < missing.length; k++) {
                    if (missing[k] !== closer) builderSet.add(missing[k]);
                }
            }
            const builders = Array.from(builderSet);
            if (builders.some((n) => !poolSet.has(n) || builderAvoid.has(n))) continue;
            const key = closer + ':' + builders.slice().sort(function (a, b) { return a - b; }).join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            drafts.push({
                closer: closer,
                builders: builders,
                ready: builders.length === 0
            });
        }
    }
    drafts.sort(function (a, b) { return a.builders.length - b.builders.length || a.closer - b.closer; });
    const plans = [];
    const limit = ctx.profile === 'mixed' ? 1 : 8;
    for (let i = 0; i < drafts.length && plans.length < limit; i++) {
        const draft = drafts[i];
        const future = called.concat(draft.builders);
        let targetHits;
        let botHits;
        let otherHits;
        if (lineIndex) {
            const counts = lineIndex.freshGroupCounts(ctx.targetPlayers, ctx.botPlayers, ctx.others, future, draft.closer);
            targetHits = counts.target;
            botHits = counts.bots;
            otherHits = counts.others;
        } else {
            targetHits = freshCompletingTickets(ctx.targetPlayers, future, draft.closer, gridOf).length;
            botHits = freshCompletingTickets(ctx.botPlayers, future, draft.closer, gridOf).length;
            otherHits = freshCompletingTickets(ctx.others, future, draft.closer, gridOf).length;
        }
        if (targetHits !== 1 || botHits < botCount || otherHits) continue;
        draft.botHits = botHits;
        plans.push(draft);
    }
    plans.sort(function (a, b) {
        return (b.botHits - a.botHits) || (a.builders.length - b.builders.length) || (a.closer - b.closer);
    });
    return plans.slice(0, limit);
}

function builderBits(builders) {
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < builders.length; i++) {
        const n = builders[i];
        if (n <= 32) b0 |= (1 << (n - 1));
        else if (n <= 64) b1 |= (1 << (n - 33));
        else b2 |= (1 << (n - 65));
    }
    return [b0, b1, b2];
}

function lineCoveredByBuilders(line, closer, bits) {
    let m0 = line.m0;
    let m1 = line.m1;
    let m2 = line.m2;
    if (closer <= 32) m0 &= ~(1 << (closer - 1));
    else if (closer <= 64) m1 &= ~(1 << (closer - 33));
    else m2 &= ~(1 << (closer - 65));
    return (m0 & ~bits[0]) === 0 && (m1 & ~bits[1]) === 0 && (m2 & ~bits[2]) === 0;
}

function listSoloPlansFromIndex(players, opponents, ctx, forbidden, limit) {
    const lineIndex = ctx.lineIndex;
    const calledSet = new Set((ctx.called || []).map((n) => Number(n)));
    const poolSet = ctx.poolSet;
    const blocked = ctx.blockedSet;
    const corners = ctx.cornerSet;
    const builderAvoid = ctx.builderAvoid;
    if (!limit || limit < 1) limit = 8;
    const plans = [];
    const soloMark = markSeated(lineIndex, players, 'soloQ');
    const oppMark = lineIndex.markPlayers(opponents || []);
    let oppHasBot = false;
    let oppHasHuman = false;
    const oppList = opponents || [];
    for (let i = 0; i < oppList.length; i++) {
        const player = oppList[i];
        if (!player) continue;
        if (player.isBot) oppHasBot = true;
        else oppHasHuman = true;
    }
    let allBot = (players || []).length > 0;
    for (let i = 0; allBot && i < players.length; i++) {
        if (!players[i] || !players[i].isBot) allBot = false;
    }

    function staysSolo(closer, builders) {
        const bits = builderBits(builders);
        if (oppHasHuman) {
            const humans = lineIndex.humanLinesByNumber[closer] || [];
            for (let i = 0; i < humans.length; i++) {
                const line = humans[i];
                if (line.dead || line.card.dead || line.card.mark !== oppMark) continue;
                if (lineCoveredByBuilders(line, closer, bits)) return false;
            }
        }
        if (oppHasBot && lineIndex.botHead) {
            const heads = lineIndex.botHead[closer];
            const cap = builders.length + 1;
            if (heads) {
                for (let count = 1; count <= 5 && count <= cap; count++) {
                    let node = heads[count];
                    while (node) {
                        const line = node.line;
                        node = node.next;
                        if (line.dead || line.card.dead || line.card.mark !== oppMark) continue;
                        if (lineCoveredByBuilders(line, closer, bits)) return false;
                    }
                }
            }
        }
        return true;
    }

    function tryPlan(line, closer) {
        const nums = line.nums;
        const missing = [];
        for (let k = 0; k < nums.length; k++) {
            if (!calledSet.has(nums[k])) missing.push(nums[k]);
        }
        const builders = [];
        for (let k = 0; k < missing.length; k++) {
            if (missing[k] !== closer) builders.push(missing[k]);
        }
        if (builders.some(function (n) { return !poolSet.has(n) || builderAvoid.has(n); })) return;
        if (!staysSolo(closer, builders)) return;
        plans.push({ closer: closer, builders: builders, ready: builders.length === 0 });
    }

    if (allBot && lineIndex.botHead) {
        for (let count = 1; count <= 5 && plans.length < limit; count++) {
            for (let closer = 1; closer <= 75 && plans.length < limit; closer++) {
                if (forbidden && forbidden.has(closer)) continue;
                if (!poolSet.has(closer) || blocked.has(closer) || corners.has(closer)) continue;
                const heads = lineIndex.botHead[closer];
                let node = heads ? heads[count] : null;
                while (node && plans.length < limit) {
                    const line = node.line;
                    node = node.next;
                    if (line.dead || line.card.dead || line.card.soloQ !== soloMark) continue;
                    tryPlan(line, closer);
                }
            }
        }
        return plans;
    }

    const lines = lineIndex.enumerateLines(players);
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nums = line.nums;
        const missing = [];
        for (let k = 0; k < nums.length; k++) {
            if (!calledSet.has(nums[k])) missing.push(nums[k]);
        }
        if (!missing.length) continue;
        for (let m = 0; m < missing.length; m++) {
            const closer = missing[m];
            if (forbidden && forbidden.has(closer)) continue;
            if (!poolSet.has(closer) || blocked.has(closer) || corners.has(closer)) continue;
            const builders = [];
            for (let k = 0; k < missing.length; k++) {
                if (missing[k] !== closer) builders.push(missing[k]);
            }
            if (builders.some(function (n) { return !poolSet.has(n) || builderAvoid.has(n); })) continue;
            candidates.push({
                closer: closer,
                builders: builders,
                len: builders.length,
                idx: line.idx
            });
            if (missing.length === 1) break;
        }
    }
    candidates.sort(function (a, b) { return a.len - b.len || a.closer - b.closer || a.idx - b.idx; });
    for (let i = 0; i < candidates.length && plans.length < limit; i++) {
        const candidate = candidates[i];
        if (!staysSolo(candidate.closer, candidate.builders)) continue;
        plans.push({ closer: candidate.closer, builders: candidate.builders, ready: candidate.len === 0 });
    }
    return plans;
}

function listSoloPlans(players, opponents, ctx, forbidden, limit) {
    if (ctx && ctx.lineIndex) return listSoloPlansFromIndex(players, opponents, ctx, forbidden, limit);
    const called = ctx.called || [];
    const calledSet = new Set(called.map((n) => Number(n)));
    const poolSet = ctx.poolSet;
    const blocked = ctx.blockedSet;
    const corners = ctx.cornerSet;
    const builderAvoid = ctx.builderAvoid;
    const lines = enumerateCardLines(players, ctx.gridOf, ctx.lineIndex);
    const opponentLines = ctx.lineIndex ? null : enumerateCardLines(opponents, ctx.gridOf);
    const plans = [];
    for (let i = 0; i < lines.length; i++) {
        const missing = lines[i].nums.filter((n) => !calledSet.has(n));
        if (!missing.length) continue;
        for (let m = 0; m < missing.length; m++) {
            const closer = missing[m];
            if (forbidden && forbidden.has(closer)) continue;
            if (!poolSet.has(closer) || blocked.has(closer) || corners.has(closer)) continue;
            const builders = missing.filter((n) => n !== closer);
            if (builders.some((n) => !poolSet.has(n) || builderAvoid.has(n))) continue;
            if (!closerStaysSolo(closer, new Set(builders), opponentLines, calledSet, ctx.lineIndex, opponents)) continue;
            plans.push({ closer, builders, ready: builders.length === 0 });
            if (missing.length === 1) break;
        }
    }
    plans.sort((a, b) => a.builders.length - b.builders.length || a.closer - b.closer);
    return plans;
}

function rankBuildTracks(ctx) {
    const sharedPlans = listSharedPlans(ctx).slice(0, 8);
    if (ctx.profile === 'mixed') return { shared: sharedPlans[0] || null, solo: null };
    const soloPlayers = ctx.profile === 'bot' ? ctx.botPlayers : ctx.targetPlayers;
    const opponents = ctx.profile === 'bot'
        ? (ctx.targetPlayers || []).concat(ctx.others || [])
        : (ctx.botPlayers || []).concat(ctx.others || []);
    const soloPool = ctx.lineIndex
        ? listSoloPlans(soloPlayers, opponents, ctx, new Set(), 48)
        : null;
    function eight(forbiddenCloser) {
        if (!ctx.lineIndex) {
            const forbidden = forbiddenCloser == null ? new Set() : new Set([forbiddenCloser]);
            return listSoloPlans(soloPlayers, opponents, ctx, forbidden).slice(0, 8);
        }
        const out = [];
        for (let i = 0; i < soloPool.length && out.length < 8; i++) {
            if (forbiddenCloser != null && soloPool[i].closer === forbiddenCloser) continue;
            out.push(soloPool[i]);
        }
        if (forbiddenCloser != null && out.length < 8 && soloPool.length >= 48) {
            return listSoloPlans(soloPlayers, opponents, ctx, new Set([forbiddenCloser]), 8);
        }
        return out;
    }
    if (!sharedPlans.length) {
        const solos = eight(null);
        return { shared: null, solo: solos[0] || null };
    }
    let best = null;
    for (let s = 0; s < sharedPlans.length; s++) {
        const shared = sharedPlans[s];
        const solos = eight(shared.closer);
        for (let u = 0; u < solos.length; u++) {
            const solo = solos[u];
            if (shared.builders.indexOf(solo.closer) !== -1) continue;
            if (solo.builders.indexOf(shared.closer) !== -1) continue;
            const union = new Set(shared.builders.concat(solo.builders));
            if (!best || union.size < best.score) best = { shared: shared, solo: solo, score: union.size };
        }
    }
    if (best) return { shared: best.shared, solo: best.solo };
    const fallback = eight(sharedPlans[0].closer);
    return { shared: sharedPlans[0], solo: fallback[0] || null };
}

function usableBuilders(plan, safeSet) {
    if (!plan || plan.ready) return [];
    return plan.builders.filter((n) => safeSet.has(n));
}

/**
 * Next builder on the single closest user line.
 * The last number on that line is held back. Once any user line is
 * already one number away, this returns null so a second line is not opened.
 */
function pickUserPatternNumber(ctx, candidates, allowOneAway, rng) {
    const pool = new Set((candidates || []).map((n) => Number(n)));
    if (!pool.size || !ctx) return null;
    const calledSet = new Set((ctx.called || []).map((n) => Number(n)));
    const blocked = new Set((ctx.botCompleting || []).concat(ctx.fourCorner || []).map((n) => Number(n)));
    const drawPool = ctx.pool ? new Set((ctx.pool || []).map((n) => Number(n))) : null;
    const leaves = ctx.lineIndex && typeof ctx.lineIndex.leavesOneAway === 'function'
        ? ctx.lineIndex.leavesOneAway
        : null;
    const lines = enumerateCardLines(ctx.targetPlayers || [], ctx.gridOf, ctx.lineIndex);
    let winningLineReady = false;
    let best = null;
    for (let i = 0; i < lines.length; i++) {
        const nums = lines[i].nums || [];
        const missing = [];
        for (let k = 0; k < nums.length; k++) {
            const n = Number(nums[k]);
            if (!calledSet.has(n)) missing.push(n);
        }
        if (missing.length === 1) {
            const closer = missing[0];
            if (!blocked.has(closer) && (!drawPool || drawPool.has(closer))) winningLineReady = true;
            continue;
        }
        if (missing.length < 2) continue;
        let reserved = null;
        for (let k = 0; k < missing.length; k++) {
            const n = missing[k];
            if (blocked.has(n)) continue;
            if (drawPool && !drawPool.has(n)) continue;
            if (reserved == null || n < reserved) reserved = n;
        }
        if (reserved == null) continue;
        const builders = [];
        for (let k = 0; k < missing.length; k++) {
            const n = missing[k];
            if (n === reserved || !pool.has(n)) continue;
            if (!allowOneAway && leaves && leaves(n)) continue;
            if (!allowOneAway && !leaves && missing.length <= 2) continue;
            builders.push(n);
        }
        if (!builders.length) continue;
        const idx = lines[i].idx != null ? lines[i].idx : i;
        if (!best || missing.length < best.missing || (missing.length === best.missing && idx < best.idx)) {
            builders.sort(function (a, b) { return a - b; });
            best = { missing: missing.length, idx: idx, builders: builders };
        }
    }
    if (winningLineReady || !best) return null;
    const roll = typeof rng === 'function' ? rng : Math.random;
    return best.builders[Math.floor(roll() * best.builders.length)];
}

function pickBuildNumber(tracks, turn, finish, rng, safe) {
    const safeSet = new Set(safe);
    const sharedBuilders = usableBuilders(tracks.shared, safeSet);
    const soloBuilders = usableBuilders(tracks.solo, safeSet);
    if (sharedBuilders.length && soloBuilders.length) {
        const both = sharedBuilders.filter((n) => soloBuilders.indexOf(n) !== -1);
        if (both.length) return both[Math.floor(rng() * both.length)];
    }
    const sharedSlack = (tracks.shared && !tracks.shared.ready)
        ? (SHARED_READY_MAX - turn) - sharedBuilders.length
        : 99;
    const soloSlack = (tracks.solo && !tracks.solo.ready)
        ? (finish - turn) - soloBuilders.length
        : 99;
    let bag = sharedBuilders;
    if (soloBuilders.length && soloSlack < sharedSlack) bag = soloBuilders;
    if (!bag.length) bag = sharedBuilders.length ? sharedBuilders : soloBuilders;
    if (!bag.length) return null;
    return bag[Math.floor(rng() * bag.length)];
}

function spoilersForCloser(closer, players, calledSet, gridOf, lineIndex) {
    const out = [];
    if (lineIndex) {
        lineIndex.markPlayers(players || []);
        const touching = lineIndex.linesTouching(closer);
        for (let i = 0; i < touching.length; i++) {
            const line = touching[i];
            if (!lineIndex.isMarked(line)) continue;
            const nums = line.nums;
            const missing = [];
            for (let k = 0; k < nums.length; k++) {
                const n = nums[k];
                if (n === closer || calledSet.has(n)) continue;
                missing.push(n);
            }
            if (missing.length === 1) out.push(missing[0]);
        }
        return out;
    }
    const lines = enumerateCardLines(players, gridOf);
    for (let i = 0; i < lines.length; i++) {
        const nums = lines[i].nums;
        if (nums.indexOf(closer) === -1) continue;
        const missing = [];
        for (let k = 0; k < nums.length; k++) {
            const n = nums[k];
            if (n === closer || calledSet.has(n)) continue;
            missing.push(n);
        }
        if (missing.length === 1) out.push(missing[0]);
    }
    return out;
}

function peekAuthenticClose(ctx, profile, hardAvoid) {
    const pool = ctx.pool || [];
    const called = ctx.called || [];
    const gridOf = ctx.gridOf;
    if (profile === 'mixed') {
        const n = pickExactSharedOneAway(ctx.targetPlayers, ctx.botPlayers, called, {
            pool,
            avoid: hardAvoid,
            botCount: Math.max(1, Number(ctx.botCount) || 1),
            gridOf,
            others: ctx.others || [],
            lineIndex: ctx.lineIndex,
            preferExact: (Number(ctx.currentTurn) || 0) < FINISH_CALL_MIN
        });
        return n == null ? null : { num: n, plan: 'shared' };
    }
    if (profile === 'bot') {
        const avoid = hardAvoid.concat(ctx.userCompleting || []);
        if ((Number(ctx.currentTurn) || 0) < FINISH_CALL_MIN) {
            const n = pickAuthenticOneAwayNumber(ctx.botPlayers, called, {
                pool,
                avoid,
                gridOf,
                lineIndex: ctx.lineIndex
            });
            return n == null ? null : { num: n, plan: 'bot' };
        }
        const grouped = pickGroupedBotBall(ctx.botPlayers, called, {
            pool,
            avoid,
            gridOf,
            lineIndex: ctx.lineIndex
        });
        const turn = Number(ctx.currentTurn) || 0;
        const finish = Math.max(FINISH_CALL_MIN, Math.min(HARD_CAP_CALLS, Number(ctx.finishCall) || FINISH_CALL_MIN));
        if (turn < finish) return grouped;
        return occasionalSoloBotClose(grouped, ctx, ctx.botPlayers, called, {
            pool,
            avoid,
            gridOf,
            lineIndex: ctx.lineIndex,
            humans: (ctx.targetPlayers || []).concat(ctx.others || [])
        });
    }
    const n = pickAuthenticOneAwayNumber(ctx.targetPlayers, called, {
        pool,
        avoid: hardAvoid.concat(ctx.botCompleting || []),
        gridOf,
        lineIndex: ctx.lineIndex
    });
    return n == null ? null : { num: n, plan: 'solo' };
}

function mixedCloseCtx(ctx, turn, forceCeiling) {
    return {
        called: ctx.called || [],
        pool: ctx.pool || [],
        targetPlayers: ctx.targetPlayers || [],
        botPlayers: ctx.botPlayers || [],
        others: ctx.others || [],
        botCount: Math.max(1, Number(ctx.botCount) || 1),
        mustWinNow: true,
        currentTurn: turn,
        ceiling: forceCeiling ? turn : HARD_CAP_CALLS,
        fullPrize: ctx.fullPrize,
        depositor: ctx.depositor,
        vaultTwo: ctx.vaultTwo,
        virtualPool: ctx.virtualPool,
        gridOf: ctx.gridOf,
        fourCorner: ctx.fourCorner || [],
        blockedCompleting: ctx.blockedCompleting || [],
        completing: ctx.completing || [],
        botCompleting: ctx.botCompleting || [],
        lineIndex: ctx.lineIndex
    };
}

function looseAuthenticClose(ctx, profile, hardAvoid) {
    const pool = ctx.pool || [];
    const called = ctx.called || [];
    const gridOf = ctx.gridOf;
    const shared = pickSharedOneAwayNumber(ctx.targetPlayers, ctx.botPlayers, called, { pool, gridOf, lineIndex: ctx.lineIndex });
    const userBall = pickAuthenticOneAwayNumber(ctx.targetPlayers, called, { pool, avoid: hardAvoid, gridOf, lineIndex: ctx.lineIndex });
    let botGroup = pickGroupedBotBall(ctx.botPlayers, called, { pool, avoid: hardAvoid, gridOf, lineIndex: ctx.lineIndex });
    if (profile === 'bot') {
        botGroup = occasionalSoloBotClose(botGroup, ctx, ctx.botPlayers, called, {
            pool,
            avoid: hardAvoid,
            gridOf,
            lineIndex: ctx.lineIndex,
            humans: (ctx.targetPlayers || []).concat(ctx.others || [])
        });
    }
    if (profile === 'mixed' && shared != null) return { num: shared, plan: 'shared', useMixedPicker: true };
    if (profile === 'user' && userBall != null) return { num: userBall, plan: 'solo' };
    if (profile === 'bot' && botGroup != null) return botGroup;
    if (shared != null) return { num: shared, plan: 'shared' };
    if (userBall != null) return { num: userBall, plan: 'solo' };
    if (botGroup != null) return botGroup;
    return null;
}

/**
 * One draw.
 * Bot cards: calls 1–10 scatter, calls 11–13 build a line, and the
 * winning ball lands on a rotated call from 14 through 23.
 * User cards: calls 1–9 scatter, calls 10–14 fill one line until it is
 * exactly one number away, and that same 14–23 rotation pulls the winner.
 * The draw never goes past call 23.
 */
function chooseDrawnBall(ctx) {
    ctx = ctx || {};
    if (ctx.lineIndex) ctx.lineIndex.syncCalled(ctx.called || []);
    const turn = Number(ctx.currentTurn) || 0;
    const finish = Math.max(FINISH_CALL_MIN, Math.min(HARD_CAP_CALLS, Number(ctx.finishCall) || FINISH_CALL_MIN));
    const rng = rngOf(ctx);
    const pool = (ctx.pool || []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 75);
    const poolSet = new Set(pool);
    const completing = (ctx.completing || []).map((n) => Number(n));
    const corners = (ctx.fourCorner || []).map((n) => Number(n));
    const userComplete = new Set((ctx.userCompleting || []).map((n) => Number(n)));
    // A ball an eligible player finishes is a shared win even if a blocked
    // card finishes on it too. Four-corners and the build-phase avoid list
    // still hold it until the round is allowed to close.
    const blocked = (ctx.blockedCompleting || []).map((n) => Number(n)).filter((n) => !userComplete.has(n));
    const hardAvoid = corners.concat(blocked);
    const avoidSet = new Set(hardAvoid.concat(completing));
    const safe = pool.filter((n) => !avoidSet.has(n));
    const profile = drawProfile(ctx.forceWinner, ctx.botCount);
    const shapingUser = profile === 'user';

    function pickRandom(list) {
        if (!list || !list.length) return null;
        return list[Math.floor(rng() * list.length)];
    }

    // Bot cards scatter through call 10. User cards scatter through call 9
    // so a line cannot be one number away before the build window.
    if (turn <= (shapingUser ? USER_LINE_START - 1 : SCATTER_CALL_END)) {
        const open = [];
        const leavesOneAway = ctx.lineIndex && ctx.lineIndex.leavesOneAway;
        let scanned = null;
        if (typeof leavesOneAway !== 'function') {
            scanned = new Set();
            const seated = (ctx.targetPlayers || []).concat(ctx.botPlayers || [], ctx.others || []);
            for (let p = 0; p < seated.length; p++) {
                const tickets = (seated[p] && seated[p].ticketsData) || [];
                for (let t = 0; t < tickets.length; t++) {
                    const grid = gridForTicket(tickets[t], ctx.gridOf);
                    if (!Array.isArray(grid)) continue;
                    const nums = approachNumbers(grid, ctx.called);
                    for (let k = 0; k < nums.length; k++) scanned.add(nums[k]);
                }
            }
        }
        for (let i = 0; i < safe.length; i++) {
            const n = safe[i];
            const approaches = typeof leavesOneAway === 'function' ? leavesOneAway(n) : scanned.has(n);
            if (approaches) continue;
            open.push(n);
        }
        const scattered = open.length ? open : safe;
        let pickFrom = scattered;
        if (ctx.useEarlyMap && ctx.lineIndex && ctx.lineIndex.earlyHorizon) {
            const horizon = ctx.lineIndex.earlyHorizon;
            const scatterEnd = shapingUser ? USER_LINE_START - 1 : SCATTER_CALL_END;
            const remain = scatterEnd - turn + 1;
            const calm = [];
            for (let i = 0; i < scattered.length; i++) {
                const n = scattered[i];
                const span = horizon[n] || 99;
                if (span > remain) calm.push(n);
            }
            if (calm.length) pickFrom = calm;
        }
        const early = pickRandom(pickFrom);
        if (early != null) return { num: early, plan: 'safe' };
        return { num: callableEmergencyNumber(pool, corners), plan: 'emergency' };
    }

    const planCtx = {
        targetPlayers: ctx.targetPlayers || [],
        botPlayers: ctx.botPlayers || [],
        others: ctx.others || [],
        called: ctx.called || [],
        gridOf: ctx.gridOf,
        lineIndex: ctx.lineIndex,
        poolSet,
        blockedSet: new Set(blocked),
        cornerSet: new Set(corners),
        builderAvoid: avoidSet,
        botCount: profile === 'mixed' ? Math.max(1, Number(ctx.botCount) || 1) : 1,
        profile
    };
    const tracks = rankBuildTracks(planCtx);
    const peek = peekAuthenticClose(ctx, profile, hardAvoid);
    const bothSides = (ctx.targetPlayers || []).length > 0 && (ctx.botPlayers || []).length > 0;
    const sharedReady = !bothSides || pickSharedOneAwayNumber(ctx.targetPlayers, ctx.botPlayers, ctx.called || [], {
        pool,
        gridOf: ctx.gridOf,
        lineIndex: ctx.lineIndex
    }) != null;
    // A user win is not a shared win. Waiting for a bot to share the
    // same one-away number is what pushed those rounds out to call 23.
    const sharedOk = shapingUser || sharedReady || turn > SHARED_READY_MAX;
    const timeToClose = turn >= FINISH_CALL_MIN && !!peek && turn >= finish && sharedOk;

    if (timeToClose && profile === 'mixed') {
        return {
            useMixedPicker: true,
            mixedCtx: mixedCloseCtx(ctx, turn, false),
            num: peek.num,
            plan: 'shared',
            emergencySeal: false
        };
    }
    if (timeToClose && peek) return { num: peek.num, plan: peek.plan, emergencySeal: false };

    if (turn >= HARD_CAP_CALLS) {
        const loose = looseAuthenticClose(ctx, profile, hardAvoid);
        if (loose && loose.useMixedPicker) {
            return {
                useMixedPicker: true,
                mixedCtx: mixedCloseCtx(ctx, turn, true),
                num: loose.num,
                plan: loose.plan,
                emergencySeal: false
            };
        }
        if (loose) return { num: loose.num, plan: loose.plan, emergencySeal: false };
        const fallback = pickRandom(safe);
        return {
            num: fallback != null ? fallback : callableEmergencyNumber(pool, corners),
            plan: 'emergency',
            emergencySeal: true
        };
    }

    // User cards: calls 10–14 fill a line. If that line is not one number
    // away yet, keep filling it until the scheduled finish can take the closer.
    const userNeedsLine = shapingUser && !peek && turn < HARD_CAP_CALLS;
    const userFillingWindow = shapingUser && turn >= USER_LINE_START && turn <= USER_LINE_END && turn < finish;
    if (userNeedsLine || userFillingWindow) {
        const aimed = pickUserPatternNumber(ctx, safe, turn >= USER_LINE_START, rng);
        if (aimed != null) return { num: aimed, plan: 'build' };
    }

    // Once the user line is one away, hold that closer until its scheduled call.
    if (!(shapingUser && peek && turn < finish)) {
        const built = pickBuildNumber(tracks, turn, finish, rng, safe);
        if (built != null) return { num: built, plan: 'build' };
    }

    const calledSet = new Set((ctx.called || []).map((n) => Number(n)));
    const holdAvoid = new Set();
    [tracks.shared, tracks.solo].forEach((plan) => {
        if (!plan) return;
        holdAvoid.add(plan.closer);
        const watch = profile === 'bot' ? (ctx.targetPlayers || []) : (ctx.botPlayers || []);
        spoilersForCloser(plan.closer, watch, calledSet, ctx.gridOf, ctx.lineIndex).forEach((n) => holdAvoid.add(n));
    });
    const holdPool = safe.filter((n) => !holdAvoid.has(n));
    const held = pickRandom(holdPool.length ? holdPool : safe);
    if (held != null) return { num: held, plan: 'hold' };
    return { num: callableEmergencyNumber(pool, corners), plan: 'emergency' };
}

function sharedOneAwayAvailable(realPlayers, botPlayers, called, pool, gridOf, lineIndex) {
    return pickSharedOneAwayNumber(realPlayers, botPlayers, called, { pool, gridOf, lineIndex: lineIndex }) != null;
}

/**
 * Exercise indexed ball selection once during pre-round warmup so the
 * first live calls, including the last scatter call and the first build
 * call, do not pay for interpreter warmup.
 * Uses a private rng and does not draw a ball.
 */
function primeDrawLookup(lineIndex, players) {
    if (!lineIndex) return;
    mapEarlyDrawTrajectories(lineIndex);
    const list = Array.isArray(players) ? players : Object.values(players || {});
    const bots = [];
    const humans = [];
    for (let i = 0; i < list.length; i++) {
        const player = list[i];
        if (!player) continue;
        if (player.isBot) bots.push(player);
        else humans.push(player);
    }
    const pool = [];
    for (let n = 1; n <= 75; n++) pool.push(n);
    const target = humans.length ? [humans[0]] : bots.slice(0, 1);
    const others = humans.length > 1 ? humans.slice(1) : [];
    const called = lineIndex.calledSnapshot();
    const warm = {
        currentTurn: 10,
        finishCall: 18,
        forceWinner: bots.length && humans.length ? 'mix' : (bots.length ? 'bots' : 'real'),
        botCount: 1,
        called: called,
        pool: pool,
        targetPlayers: target,
        botPlayers: bots,
        others: others,
        completing: [],
        botCompleting: [],
        userCompleting: [],
        fourCorner: [],
        blockedCompleting: [],
        lineIndex: lineIndex,
        rng: function () { return 0.17; },
        fullPrize: 100,
        depositor: true,
        vaultTwo: 0,
        virtualPool: 0
    };
    chooseDrawnBall(warm);
    chooseDrawnBall(Object.assign({}, warm, { currentTurn: 11 }));
    if (bots.length && humans.length) {
        chooseDrawnBall(Object.assign({}, warm, { botCount: 4 }));
        chooseDrawnBall(Object.assign({}, warm, { forceWinner: 'bots', botCount: 1 }));
        chooseDrawnBall(Object.assign({}, warm, { forceWinner: 'real', botCount: 0 }));
    }
}

class DrawTickMutex {
    constructor() {
        this.busy = false;
    }
    tryAcquire() {
        if (this.busy) return false;
        this.busy = true;
        return true;
    }
    release() {
        this.busy = false;
    }
}

module.exports = {
    MAX_VIRTUAL_VALIDATORS,
    MAX_TOTAL_WINNERS,
    USER_5_MATCH_LOCK,
    MIN_CALLS_BEFORE_RESOLVE,
    checkBingo,
    checkFourCorners,
    oneAwayNumbers,
    pickAuthenticOneAwayNumber,
    pickSharedOneAwayNumber,
    pickExactSharedOneAway,
    pickSharedBuilder,
    soloPayoutCovered,
    applyPanicShield,
    chooseMixedCall,
    chooseDrawnBall,
    sharedOneAwayAvailable,
    buildRoundLineIndex,
    mapEarlyDrawTrajectories,
    primeDrawLookup,
    drawProfile,
    settleWinnerVault,
    capWinnerList,
    absorbMissedRealWinners,
    isLockedHumanWinner,
    restoreLockedHumanWinners,
    isRestrictedFromWinning,
    excludeRestrictedWinners,
    dropDeniedBonusWinners,
    collectMatchingCompletingNumbers,
    allowedBonusReleaseNumbers,
    collectRestrictedCompletingNumbers,
    collectBingoClaims,
    collectBingoClaimsFromCommitted,
    collectSameBallWinners,
    evaluateBingoTick,
    mergePreservedClaims,
    finalizeBingoRound,
    resolveConcurrentClaims,
    dedupeWinnersByCard,
    computeEvenSplit,
    closeBotKartela,
    sealBotTicket,
    gridColumnsAreUnique,
    playedGridForHistory,
    splitWinnerBroadcastGrid,
    blankMarks,
    cloneMarks,
    ensureMarkGrid,
    markNumberOnTicket,
    markCalledNumbersOnTicket,
    markCalledNumbersOnPlayers,
    markedCalledNumbers,
    markedCardCompletes,
    closeWinningTicket,
    DrawTickMutex,
    claimId
};
