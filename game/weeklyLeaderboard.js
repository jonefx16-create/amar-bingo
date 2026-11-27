'use strict';

const { EAT_OFFSET_MS, getEatParts, pad2 } = require('./eatTime');

function currentEatWeekStart(now) {
    const ts = now == null ? Date.now() : Number(now);
    const eat = new Date(ts + EAT_OFFSET_MS);
    const day = eat.getUTCDay();
    const daysFromMonday = (day + 6) % 7;
    eat.setUTCHours(0, 0, 0, 0);
    eat.setUTCDate(eat.getUTCDate() - daysFromMonday);
    return new Date(eat.getTime() - EAT_OFFSET_MS);
}

function currentEatWeekEnd(now) {
    const start = currentEatWeekStart(now);
    return new Date(start.getTime() + (7 * 24 * 60 * 60 * 1000));
}

function eatWeekKey(now) {
    const start = currentEatWeekStart(now);
    const p = getEatParts(start);
    const jan1 = new Date(Date.UTC(p.year, 0, 1));
    const week = Math.floor((start.getTime() + EAT_OFFSET_MS - jan1.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;
    return p.year + '-W' + String(week).padStart(2, '0');
}

function leaderboardWindowStart(now, resetAt) {
    const weekStart = currentEatWeekStart(now);
    if (resetAt == null || resetAt === '') return weekStart;
    const reset = new Date(resetAt);
    if (!Number.isFinite(reset.getTime())) return weekStart;
    return reset.getTime() > weekStart.getTime() ? reset : weekStart;
}

function weeklyWithdrawMatch(now, resetAt) {
    return {
        type: 'withdraw',
        status: 'Approved',
        method: { $ne: 'Promoter Comm' },
        date: { $gte: leaderboardWindowStart(now, resetAt), $lt: currentEatWeekEnd(now) }
    };
}

function weeklyLeaderboardPipeline(now, limit, resetAt) {
    const cap = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
    return [
        { $match: weeklyWithdrawMatch(now, resetAt) },
        { $group: { _id: '$phone', weekly: { $sum: '$amount' } } },
        { $match: { weekly: { $gt: 0 } } },
        { $sort: { weekly: -1 } },
        { $limit: cap }
    ];
}

function hasRankOverride(user) {
    return !!(user && user.weeklyRankOverride != null && user.weeklyRankOverride !== '');
}

function mergeWeeklyLeaderboard(computedRows, users, opts) {
    const includeZero = !!(opts && opts.includeZero);
    const byPhone = {};
    (computedRows || []).forEach((row) => {
        const phone = row._id || row.phone;
        if (!phone) return;
        byPhone[phone] = Number(row.weekly) || 0;
    });
    (users || []).forEach((user) => {
        if (!user || !user.phone) return;
        if (hasRankOverride(user)) byPhone[user.phone] = Number(user.weeklyRankOverride) || 0;
    });
    return Object.keys(byPhone)
        .map((phone) => ({ _id: phone, weekly: byPhone[phone] }))
        .filter((row) => includeZero || row.weekly > 0)
        .sort((a, b) => b.weekly - a.weekly || String(a._id).localeCompare(String(b._id)));
}

function shapeWeeklyLeaderboard(rows, usersByPhone) {
    return (rows || []).map((row, idx) => {
        const user = usersByPhone && usersByPhone[row._id];
        const points = Number(row.weekly) || 0;
        return {
            phone: row._id,
            name: user && user.name ? user.name : 'Player',
            won: points,
            weeklyWithdrawn: points,
            rank: idx + 1,
            weeklyRankOverride: hasRankOverride(user) ? Number(user.weeklyRankOverride) || 0 : null
        };
    });
}

const SEASON_MS = 7 * 24 * 60 * 60 * 1000;

function seasonDurationMs() {
    return SEASON_MS;
}

function seasonState(now, settings) {
    const cfg = settings || {};
    const ts = now == null ? Date.now() : Number(now);
    const seasonId = cfg.tournamentSeasonId ? String(cfg.tournamentSeasonId) : '';
    const startedRaw = cfg.tournamentStartedAt;
    const started = startedRaw ? new Date(startedRaw) : null;
    const startedMs = started && Number.isFinite(started.getTime()) ? started.getTime() : null;
    const configuredEnd = cfg.tournamentEndsAt ? new Date(cfg.tournamentEndsAt) : null;
    const endsMs = startedMs == null
        ? null
        : (configuredEnd && Number.isFinite(configuredEnd.getTime())
            ? configuredEnd.getTime()
            : startedMs + SEASON_MS);
    const stored = cfg.tournamentStatus || 'idle';
    if (!seasonId || startedMs == null || stored === 'idle') {
        return {
            active: false,
            frozen: false,
            elapsed: false,
            status: 'idle',
            seasonId: '',
            startedAt: null,
            endsAt: null,
            remainingMs: 0
        };
    }
    const elapsed = ts >= endsMs;
    const frozen = stored === 'frozen' || elapsed;
    return {
        active: !frozen && stored === 'active',
        frozen,
        elapsed,
        status: frozen ? 'frozen' : 'active',
        seasonId,
        startedAt: new Date(startedMs),
        endsAt: new Date(endsMs),
        remainingMs: frozen ? 0 : Math.max(0, endsMs - ts)
    };
}

function shapeCardsLeaderboard(users) {
    return (users || [])
        .map((user) => ({
            phone: user.phone,
            name: user.name || 'Player',
            cardsPlayed: Math.max(0, Number(user.seasonCardsPlayed) || 0),
            won: Math.max(0, Number(user.seasonCardsPlayed) || 0),
            weeklyWithdrawn: 0
        }))
        .filter((row) => row.phone && row.cardsPlayed > 0)
        .sort((a, b) => b.cardsPlayed - a.cardsPlayed || String(a.phone).localeCompare(String(b.phone)))
        .map((row, idx) => Object.assign(row, { rank: idx + 1 }));
}

function cardStandingAheadFilter(seasonId, cardsPlayed, phone) {
    const cards = Math.max(0, Number(cardsPlayed) || 0);
    const key = String(phone || '');
    return {
        seasonId: seasonId || '',
        seasonCardsPlayed: { $gt: 0 },
        $or: [
            { seasonCardsPlayed: { $gt: cards } },
            { seasonCardsPlayed: cards, phone: { $lt: key } }
        ]
    };
}

function shapePersonalStanding(user, aheadCount, seasonId) {
    const phone = user && user.phone ? String(user.phone) : '';
    const name = user && user.name ? String(user.name) : '';
    const sameSeason = !!(seasonId && user && String(user.seasonId || '') === String(seasonId));
    const cardsPlayed = sameSeason ? Math.max(0, Number(user.seasonCardsPlayed) || 0) : 0;
    if (!phone || cardsPlayed <= 0) {
        return { phone, name, cardsPlayed: 0, rank: null };
    }
    const rank = Math.max(0, Number(aheadCount) || 0) + 1;
    return { phone, name: name || 'Player', cardsPlayed, rank };
}

function formatSeasonLabel(state) {
    if (!state || !state.startedAt || !state.endsAt) return 'No active season';
    const a = getEatParts(state.startedAt);
    const b = getEatParts(new Date(state.endsAt.getTime() - 1000));
    const status = state.status === 'active' ? 'Live' : 'Frozen';
    return status + ' · ' + pad2(a.day) + '/' + pad2(a.month) + ' ' + pad2(a.hour) + ':' + pad2(a.minute) + ':' + pad2(a.second)
        + ' - ' + pad2(b.day) + '/' + pad2(b.month) + ' ' + pad2(b.hour) + ':' + pad2(b.minute) + ':' + pad2(b.second) + ' EAT';
}

function formatEatWeekLabel(now) {
    const start = currentEatWeekStart(now);
    const end = new Date(currentEatWeekEnd(now).getTime() - 1000);
    const a = getEatParts(start);
    const b = getEatParts(end);
    return pad2(a.day) + '/' + pad2(a.month) + ' - ' + pad2(b.day) + '/' + pad2(b.month) + ' EAT';
}

module.exports = {
    currentEatWeekStart,
    currentEatWeekEnd,
    eatWeekKey,
    leaderboardWindowStart,
    weeklyWithdrawMatch,
    weeklyLeaderboardPipeline,
    mergeWeeklyLeaderboard,
    shapeWeeklyLeaderboard,
    formatEatWeekLabel,
    SEASON_MS,
    seasonDurationMs,
    seasonState,
    shapeCardsLeaderboard,
    cardStandingAheadFilter,
    shapePersonalStanding,
    formatSeasonLabel
};
