'use strict';

const TIER = {
    STANDARD: 'STANDARD',
    BONUS_CREDIT: 'BONUS_CREDIT',
    COOLDOWN: 'COOLDOWN',
    BOT: 'BOT'
};

const PRIZE_LANE = {
    TREASURY: 'treasury',
    BONUS: 'bonus',
    NONE: 'none'
};

const HIGH_ROLLER_DEPOSIT_ETB = 1500; // legacy export; live pools use the LARGE_* cutoffs
const { eatDayKey } = require('./eatTime');

const LARGE_DAILY_DEPOSIT_ETB = 500;
const LARGE_LIFETIME_DEPOSIT_ETB = 3000;
const LARGE_GROUP_PROBABILITY = 0.6;
const LARGE_LIFETIME_WEIGHT = 0.2;
const DAILY_NET_LOSS_TARGET_ETB = 600;

function isPunishedPlayer(phone, ctx) {
    const now = ctx.now || Date.now();
    const activeCooldowns = ctx.activeCooldowns || {};
    const timeBans = ctx.timeBans || {};
    return (activeCooldowns[phone] > 0) || !!(timeBans[phone] && timeBans[phone] > now);
}

function ticketBonusStake(player) {
    let bonus = 0;
    const tickets = (player && player.ticketsData) || [];
    for (let i = 0; i < tickets.length; i++) {
        bonus += Number(tickets[i] && tickets[i].paidFromBonus) || 0;
    }
    return bonus;
}

/**
 * Approved deposit history. `totalDeposited` is the cash total recorded
 * when a deposit is approved. A missing counter falls back to the seat
 * flag set from that same field at buy-in. Zero means no approved deposit.
 */
function hasApprovedDeposit(player) {
    if (!player || player.isBot) return false;
    if (player.totalDeposited != null && player.totalDeposited !== '') {
        return Number(player.totalDeposited) > 0;
    }
    return !!player.hasDeposited;
}

/**
 * True when this round's stake spent bonus / play-credit funds.
 * Real deposits that still sit in play balance are tracked separately
 * (unplayedRealDeposit → realFromPlay) and are not bonus funds.
 * A player who has never deposited is entirely on bonus credit,
 * including a later stake paid from main-balance winnings.
 */
function stakeUsesBonusFunds(player) {
    if (!player || player.isBot) return false;
    if ((Number(player.bonusBetAmount) || 0) > 0) return true;
    if (ticketBonusStake(player) > 0) return true;
    if (!hasApprovedDeposit(player)) return true;
    return false;
}

/**
 * Bonus win chance failed for this resolution (0%, or the roll missed).
 * Callers pass the same allowBonusWin flag used to build the draw pools.
 */
function bonusWinDenied(player, ctx) {
    if (!player || player.isBot) return false;
    if (ctx && ctx.allowBonusWin) return false;
    return stakeUsesBonusFunds(player);
}

/**
 * Split a play-balance deduction into real deposit vs bonus credit.
 * Real unplayed deposit is consumed first. The remainder is bonus.
 */
function splitPlayStake(playDeducted, unplayedRealDeposit) {
    const play = Math.max(0, Number(playDeducted) || 0);
    const realPool = Math.max(0, Number(unplayedRealDeposit) || 0);
    const realFromPlay = Math.min(play, realPool);
    const bonusFromPlay = Number((play - realFromPlay).toFixed(2));
    const nextUnplayed = Number((realPool - realFromPlay).toFixed(2));
    return {
        realFromPlay: Number(realFromPlay.toFixed(2)),
        bonusFromPlay,
        nextUnplayed
    };
}

/**
 * Categorize a seated player before / during a match.
 * Cooldown stays blocked. Bonus-funded stakes are blocked unless this
 * resolution's bonus win chance allows them. Card generation still uses
 * a wider bonus/cooldown net so bonus-credit stakes get high-variance cards.
 */
function classifyPlayer(player, ctx) {
    ctx = ctx || {};
    const allowBonusWin = !!ctx.allowBonusWin;

    if (!player || player.isBot) {
        return {
            tier: TIER.BOT,
            prizeLane: PRIZE_LANE.NONE,
            blocked: false,
            isStandard: false,
            useHighVarianceCards: false,
            hasDeposited: false
        };
    }

    const punished = isPunishedPlayer(player.phone, ctx);
    const hasDeposited = hasApprovedDeposit(player);
    const hasRealStake = (Number(player.realBetAmount) || 0) > 0;
    // Bonus-only means the seat spent bonus credit and no real deposit
    // stake. A play-balance spend of unplayed real deposit is realBetAmount.
    const stakeIsBonusOnly = stakeUsesBonusFunds(player) && !hasRealStake;
    const bonusDenied = bonusWinDenied(player, ctx);

    if (punished) {
        return {
            tier: TIER.COOLDOWN,
            prizeLane: hasDeposited ? PRIZE_LANE.TREASURY : PRIZE_LANE.BONUS,
            blocked: true,
            isStandard: false,
            useHighVarianceCards: true,
            hasDeposited
        };
    }

    if (!hasDeposited) {
        return {
            tier: TIER.BONUS_CREDIT,
            prizeLane: PRIZE_LANE.BONUS,
            blocked: !allowBonusWin,
            isStandard: false,
            useHighVarianceCards: true,
            hasDeposited: false
        };
    }

    if (stakeIsBonusOnly) {
        return {
            tier: TIER.BONUS_CREDIT,
            prizeLane: PRIZE_LANE.TREASURY,
            blocked: bonusDenied,
            isStandard: false,
            useHighVarianceCards: true,
            hasDeposited: true
        };
    }

    return {
        tier: TIER.STANDARD,
        prizeLane: PRIZE_LANE.TREASURY,
        blocked: bonusDenied,
        isStandard: !bonusDenied,
        useHighVarianceCards: false,
        hasDeposited: true
    };
}

/**
 * Build the phone sets used by the draw-loop filters.
 * Punished players are blocked. Bonus-funded stakes are blocked when the
 * bonus win chance does not allow a win. Everyone else splits into
 * depositors vs bonus-credit by approved deposit (totalDeposited > 0),
 * not by the raw seat flag.
 */
function buildEligibilitySets(realPlayers, ctx) {
    const blockedPhones = [];
    const depositorPhones = [];
    const eligibleBonusPhones = [];

    (realPlayers || []).forEach((p) => {
        const elig = classifyPlayer(p, ctx);
        if (elig.blocked) {
            blockedPhones.push(p.phone);
        } else if (elig.hasDeposited) {
            depositorPhones.push(p.phone);
        } else {
            eligibleBonusPhones.push(p.phone);
        }
    });

    return {
        blockedPhones,
        depositorPhones,
        eligibleBonusPhones,
        eligibleRealPhones: depositorPhones.concat(eligibleBonusPhones)
    };
}

function attachEligibility(player, ctx) {
    const elig = classifyPlayer(player, ctx);
    if (player) {
        player.eligibilityTier = elig.tier;
        player.prizeLane = elig.prizeLane;
        player.netContribution = netContributionOf(player, ctx);
    }
    return elig;
}

/**
 * True if the player has any prior match win — lifetime (`won` / `winCount`)
 * or this session (`winHistory`, mix-dep rotation). Not a recency window.
 */
function hasPriorWin(player, ctx) {
    ctx = ctx || {};
    if (!player) return false;
    if (Number(player.won) > 0) return true;
    if (Number(player.winCount) > 0) return true;
    const hist = (ctx.winHistory || {})[player.phone];
    if (Array.isArray(hist) && hist.length > 0) return true;
    const mix = ctx.mixDepWinnersHistory || [];
    if (mix.indexOf(player.phone) !== -1) return true;
    return false;
}

function isCooldownBlocking(player, ctx) {
    ctx = ctx || {};
    if (!player) return true;
    const now = ctx.now || Date.now();
    if (isPunishedPlayer(player.phone, ctx)) return true;
    const until = player.cooldownUntil != null
        ? Number(player.cooldownUntil)
        : Number((ctx.cooldownUntil || {})[player.phone] || 0);
    return until > now;
}

function netContributionOf(player, ctx) {
    ctx = ctx || {};
    if (player && player.netContribution != null && player.netContribution !== '') {
        const direct = Number(player.netContribution);
        if (Number.isFinite(direct)) return direct;
    }
    const mapped = player && player.phone ? (ctx.netContribution || {})[player.phone] : undefined;
    if (mapped != null && mapped !== '') {
        const fromMap = Number(mapped);
        if (Number.isFinite(fromMap)) return fromMap;
    }
    return playerNum(player, ctx, 'totalDeposited') - playerNum(player, ctx, 'totalWithdrawn');
}

function isOverWithdrawn(player, ctx) {
    return netContributionOf(player, ctx) < 0 && hasPriorWin(player, ctx);
}

/**
 * Standard depositors may sit. Lifetime or daily net
 * (totalDeposited - totalWithdrawn) does not remove a player from the
 * target pool. Active cooldown and bonus-credit blocks still do.
 */
function isTargetPoolBaseEligible(player, ctx) {
    ctx = ctx || {};
    if (!player || player.isBot) return false;
    if (isCooldownBlocking(player, ctx)) return false;
    const elig = classifyPlayer(player, ctx);
    if (elig.tier === TIER.COOLDOWN || elig.tier === TIER.BONUS_CREDIT) return false;
    if (!elig.isStandard || elig.blocked) return false;
    return true;
}

function minimumBotShare(player, ctx) {
    if (!player || player.isBot) return 0;
    if (netContributionOf(player, ctx) < 0) return 1;
    return 0;
}

function isNeverWonTarget(player, ctx) {
    return isTargetPoolBaseEligible(player, ctx) && !hasPriorWin(player, ctx);
}

function isPostCooldownTarget(player, ctx) {
    return isTargetPoolBaseEligible(player, ctx) && hasPriorWin(player, ctx);
}

function isPrimaryTargetEligible(player, ctx) {
    return isTargetPoolBaseEligible(player, ctx);
}

function playerNum(player, ctx, field) {
    if (player && player[field] != null) return Number(player[field]) || 0;
    const map = (ctx && ctx[field]) || {};
    if (player && player.phone && map[player.phone] != null) return Number(map[player.phone]) || 0;
    return 0;
}

function dailyCounter(player, ctx, field) {
    if (player && player.eatDayKey) {
        const today = eatDayKey(ctx && ctx.now);
        if (player.eatDayKey !== today) return 0;
    }
    return playerNum(player, ctx, field);
}

/**
 * Ethiopia-day real stakes minus Ethiopia-day prize credits.
 * A player who is ahead for the day has a negative result and does not
 * qualify for the loss target.
 */
function dailyNetLossOf(player, ctx) {
    return dailyCounter(player, ctx, 'dailyRealBets') - dailyCounter(player, ctx, 'dailyWins');
}

function meetsDailyLossTarget(player, ctx) {
    return dailyNetLossOf(player, ctx) >= DAILY_NET_LOSS_TARGET_ETB;
}

/**
 * Keep today's loss counters when eatDayKey already matches.
 * A new Ethiopia calendar day starts both counters at zero.
 */
function rolloverDailyLoss(record, now) {
    const key = eatDayKey(now);
    const sameDay = !!(record && record.eatDayKey === key);
    return {
        eatDayKey: key,
        dailyRealBets: sameDay ? (Number(record.dailyRealBets) || 0) : 0,
        dailyWins: sameDay ? (Number(record.dailyWins) || 0) : 0
    };
}

function rngOf(ctx) {
    return (ctx && typeof ctx.rng === 'function') ? ctx.rng : Math.random;
}

/**
 * Eligible standard depositors at or above the daily or lifetime cutoff.
 * A win earlier today does not remove this classification. Cooldown does.
 */
function isLargeDepositor(player, ctx) {
    ctx = ctx || {};
    if (!isTargetPoolBaseEligible(player, ctx)) return false;
    if (meetsDailyLossTarget(player, ctx)) return true;
    const daily = playerNum(player, ctx, 'depositTodayEtb');
    const lifetime = playerNum(player, ctx, 'totalDeposited');
    return daily >= LARGE_DAILY_DEPOSIT_ETB || lifetime >= LARGE_LIFETIME_DEPOSIT_ETB;
}

function isHighRollerPriority(player, ctx) {
    return isLargeDepositor(player, ctx);
}

function largeDepositorWeight(player, ctx) {
    if (meetsDailyLossTarget(player, ctx)) return dailyNetLossOf(player, ctx);
    if (netContributionOf(player, ctx) < 0) return 0;
    const daily = playerNum(player, ctx, 'depositTodayEtb');
    const lifetime = playerNum(player, ctx, 'totalDeposited');
    return daily + (lifetime * LARGE_LIFETIME_WEIGHT);
}

function smallDepositorTieScore(player, ctx) {
    if (netContributionOf(player, ctx) < 0) return 0;
    let score = 10;
    if (!hasPriorWin(player, ctx)) score += 20;
    score += Math.min(30, playerNum(player, ctx, 'roundsTodayWithoutWin') * 3);
    return score;
}

function winPriorityScore(player, ctx) {
    ctx = ctx || {};
    if (!isTargetPoolBaseEligible(player, ctx)) return 0;
    if (netContributionOf(player, ctx) < 0) return 0;
    return smallDepositorTieScore(player, ctx);
}

function playersFromPhones(phones, playersByPhone) {
    return (phones || []).map((ph) => {
        if (playersByPhone && playersByPhone[ph]) return playersByPhone[ph];
        return { phone: ph };
    }).filter(Boolean);
}

function partitionDepositorPools(players, ctx) {
    const large = [];
    const small = [];
    (players || []).forEach((player) => {
        if (!isTargetPoolBaseEligible(player, ctx)) return;
        if (isLargeDepositor(player, ctx)) large.push(player);
        else small.push(player);
    });
    return { large, small };
}

function pickWeightedPhone(players, weightOf, ctx) {
    if (players.length === 1) return players[0].phone;
    const rng = rngOf(ctx);
    const weights = [];
    let total = 0;
    for (let i = 0; i < players.length; i++) {
        const weight = Number(weightOf(players[i], ctx));
        const safe = weight > 0 && Number.isFinite(weight) ? weight : 0;
        weights.push(safe);
        total += safe;
    }
    if (!(total > 0)) {
        return players[Math.floor(rng() * players.length)].phone;
    }
    let roll = rng() * total;
    for (let i = 0; i < players.length; i++) {
        roll -= weights[i];
        if (roll < 0) return players[i].phone;
    }
    return players[players.length - 1].phone;
}

function pickSmallDepositorPhone(players, ctx) {
    if (players.length === 1) return players[0].phone;
    const rng = rngOf(ctx);
    let best = -Infinity;
    const tied = [];
    for (let i = 0; i < players.length; i++) {
        const score = smallDepositorTieScore(players[i], ctx);
        if (score > best) {
            best = score;
            tied.length = 0;
            tied.push(players[i]);
        } else if (score === best) {
            tied.push(players[i]);
        }
    }
    return tied[Math.floor(rng() * tied.length)].phone;
}

function narrowToDeepestNet(players, ctx) {
    if (!players || players.length <= 1) return players || [];
    let best = -Infinity;
    const tied = [];
    for (let i = 0; i < players.length; i++) {
        const net = netContributionOf(players[i], ctx);
        if (net > best) {
            best = net;
            tied.length = 0;
            tied.push(players[i]);
        } else if (net === best) {
            tied.push(players[i]);
        }
    }
    return tied;
}

function pickFromDepositorPools(large, small, ctx) {
    if (!large.length && !small.length) return null;
    let side = 'large';
    if (large.length && small.length) {
        side = rngOf(ctx)() < LARGE_GROUP_PROBABILITY ? 'large' : 'small';
    } else if (!large.length) {
        side = 'small';
    }
    if (side === 'large') {
        const lossTargets = large.filter((player) => meetsDailyLossTarget(player, ctx));
        if (lossTargets.length) return pickWeightedPhone(lossTargets, largeDepositorWeight, ctx);
        return pickWeightedPhone(narrowToDeepestNet(large, ctx), largeDepositorWeight, ctx);
    }
    return pickSmallDepositorPhone(narrowToDeepestNet(small, ctx), ctx);
}

function steerContext(list, ctx) {
    return Object.assign({}, ctx, {
        blockAllNetNegative: false,
        blockOverWithdrawn: false
    });
}

/**
 * Who the draw may aim at. A zero-deposit player is not a target when this
 * round's bonus win chance is off (0%, or the roll missed). Approved
 * deposit means totalDeposited > 0. The seat flag is used only when that
 * counter was not copied onto the player.
 */
function canTargetForWin(player, ctx) {
    if (!player || player.isBot) return false;
    if (bonusWinDenied(player, ctx)) return false;
    if (!(ctx && ctx.allowBonusWin) && !hasApprovedDeposit(player)) return false;
    return true;
}

function pickPriorityWinnerPhone(phones, playersByPhone, ctx) {
    ctx = ctx || {};
    const list = playersFromPhones(phones, playersByPhone);
    if (!list.length) return null;
    const steerCtx = steerContext(list, ctx);
    const pools = partitionDepositorPools(list, steerCtx);
    return pickFromDepositorPools(pools.large, pools.small, steerCtx);
}

/**
 * Pre-round card targets only (does not steer the 14–23 finish rotation).
 * Uses the same 60/40 large-vs-small draw as the live winner pick.
 * Active cooldown and bonus-credit stay excluded.
 */
function selectTargetCandidates(realPlayers, ctx) {
    ctx = ctx || {};
    const pool = (realPlayers || []).filter((p) => isPrimaryTargetEligible(p, ctx));
    const rng = rngOf(ctx);
    let count = 0;
    if (pool.length >= 10) {
        count = rng() < 0.5 ? 1 : 2;
    } else if (pool.length > 0) {
        count = 1;
    }
    const picks = [];
    const remaining = pool.slice();
    const byPhone = {};
    remaining.forEach((p) => { byPhone[p.phone] = p; });
    for (let i = 0; i < count && remaining.length; i++) {
        const phone = pickPriorityWinnerPhone(remaining.map((p) => p.phone), byPhone, ctx);
        if (!phone) break;
        picks.push(phone);
        const idx = remaining.findIndex((p) => p.phone === phone);
        if (idx !== -1) remaining.splice(idx, 1);
    }
    return picks;
}

module.exports = {
    TIER,
    PRIZE_LANE,
    HIGH_ROLLER_DEPOSIT_ETB,
    LARGE_DAILY_DEPOSIT_ETB,
    LARGE_LIFETIME_DEPOSIT_ETB,
    LARGE_GROUP_PROBABILITY,
    LARGE_LIFETIME_WEIGHT,
    DAILY_NET_LOSS_TARGET_ETB,
    classifyPlayer,
    hasApprovedDeposit,
    stakeUsesBonusFunds,
    bonusWinDenied,
    splitPlayStake,
    buildEligibilitySets,
    attachEligibility,
    isPunishedPlayer,
    isCooldownBlocking,
    hasPriorWin,
    isTargetPoolBaseEligible,
    netContributionOf,
    isOverWithdrawn,
    minimumBotShare,
    isNeverWonTarget,
    isPostCooldownTarget,
    isPrimaryTargetEligible,
    isLargeDepositor,
    isHighRollerPriority,
    dailyNetLossOf,
    meetsDailyLossTarget,
    rolloverDailyLoss,
    largeDepositorWeight,
    smallDepositorTieScore,
    winPriorityScore,
    canTargetForWin,
    pickPriorityWinnerPhone,
    selectTargetCandidates
};
