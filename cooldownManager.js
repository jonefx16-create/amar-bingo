'use strict';

const PRESETS = {
    '10m': 10 * 60 * 1000,
    '1h': 60 * 60 * 1000
};

const KIND_RANK = { '': 0, games: 1, shared: 2, split: 3, solo: 4 };

function formatDuration(ms) {
    const total = Math.max(0, Math.ceil(Number(ms) / 1000) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours + 'h ' + minutes + 'm ' + seconds + 's';
}

function parseDurationMs(input) {
    if (input == null) return null;
    if (typeof input === 'number') {
        if (!Number.isFinite(input) || input <= 0) return null;
        return Math.round(input);
    }
    const text = String(input).trim().toLowerCase();
    if (!text) return null;
    if (Object.prototype.hasOwnProperty.call(PRESETS, text)) return PRESETS[text];

    const pattern = /(\d+(?:\.\d+)?)\s*(hours|hour|hrs|hr|h|minutes|minute|mins|min|m|seconds|second|secs|sec|s)/g;
    let total = 0;
    let found = false;
    let match = pattern.exec(text);
    while (match) {
        found = true;
        const amount = Number(match[1]);
        const unit = match[2];
        if (unit.charAt(0) === 'h') total += amount * 3600000;
        else if (unit.charAt(0) === 'm') total += amount * 60000;
        else total += amount * 1000;
        match = pattern.exec(text);
    }
    if (found && total > 0) return Math.round(total);
    if (/^\d+(?:\.\d+)?$/.test(text)) return Math.round(Number(text) * 60000);
    return null;
}

function penaltyKindForWinners(totalWinnersCount) {
    const count = Number(totalWinnersCount) || 0;
    if (count <= 1) return 'solo';
    if (count === 2) return 'split';
    return 'shared';
}

function stricterKind(current, next) {
    const nextKind = next || '';
    const currentKind = current || '';
    if ((KIND_RANK[nextKind] || 0) >= (KIND_RANK[currentKind] || 0)) return nextKind || currentKind;
    return currentKind;
}

function describePenalty(kind, timeBanActive, games) {
    const labels = {
        solo: 'Solo win cooldown',
        split: 'Split win cooldown (2 winners)',
        shared: 'Shared win cooldown (3+ winners)'
    };
    const parts = [];
    if (labels[kind]) parts.push(labels[kind]);
    else if (Number(games) > 0) parts.push('Game cooldown');
    if (timeBanActive) parts.push('3 wins in 1 hour (1 hour ban)');
    return parts.join(' · ') || 'Cooldown';
}

function activeSnapshot(state, phone, now, roundMs) {
    const games = Number((state.activeCooldowns || {})[phone] || 0);
    const until = Number((state.timeBans || {})[phone] || 0);
    const timeLeft = until > now ? until - now : 0;
    const safeGames = games > 0 ? games : 0;
    const gameLeft = safeGames > 0 ? safeGames * roundMs : 0;
    return {
        games: safeGames,
        until: timeLeft > 0 ? until : 0,
        timeLeft,
        gameLeft,
        remainingMs: Math.max(timeLeft, gameLeft)
    };
}

function listPenalties(input) {
    const source = input || {};
    const now = source.now || Date.now();
    const roundMs = source.roundMs > 0 ? source.roundMs : 40000;
    const activeCooldowns = source.activeCooldowns || {};
    const timeBans = source.timeBans || {};
    const meta = source.meta || {};
    const usersByPhone = source.usersByPhone || {};
    const phones = {};
    Object.keys(activeCooldowns).forEach((phone) => { phones[phone] = true; });
    Object.keys(timeBans).forEach((phone) => { phones[phone] = true; });

    const phoneQuery = String(source.phone || source.search || '').replace(/[\s\-]/g, '');
    const rows = [];
    Object.keys(phones).forEach((phone) => {
        if (phoneQuery && String(phone).indexOf(phoneQuery) === -1) return;
        const snap = activeSnapshot({ activeCooldowns, timeBans }, phone, now, roundMs);
        if (snap.games <= 0 && snap.timeLeft <= 0) return;
        const user = usersByPhone[phone] || {};
        const kind = (meta[phone] && meta[phone].kind) || '';
        rows.push({
            phone,
            name: user.name || user.firstName || '',
            firstName: user.firstName || '',
            username: user.telegramUsername || user.username || '',
            userId: user.telegramId || user.userId || '',
            kind,
            reason: describePenalty(kind, snap.timeLeft > 0, snap.games),
            gamesRemaining: snap.games,
            timeLeftMs: snap.timeLeft,
            remainingMs: snap.remainingMs,
            remainingLabel: formatDuration(snap.remainingMs),
            gamesLabel: snap.games > 0 ? snap.games + ' game' + (snap.games === 1 ? '' : 's') + ' left' : '',
            timeBanLabel: snap.timeLeft > 0 ? formatDuration(snap.timeLeft) : ''
        });
    });

    rows.sort((a, b) => b.remainingMs - a.remainingMs || String(a.phone).localeCompare(String(b.phone)));
    const pageSize = Math.min(5000, Math.max(1, Number(source.pageSize) || 8));
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    let page = Math.max(1, Number(source.page) || 1);
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * pageSize;
    return {
        total,
        page,
        pageSize,
        totalPages,
        users: rows.slice(start, start + pageSize)
    };
}

function removePenalty(state, phone, now) {
    const target = String(phone || '');
    const snap = activeSnapshot(state, target, now || Date.now(), 40000);
    const active = snap.games > 0 || snap.timeLeft > 0;
    delete (state.activeCooldowns || {})[target];
    delete (state.timeBans || {})[target];
    if (state.meta) delete state.meta[target];
    return {
        ok: active,
        cleared: active,
        message: active
            ? 'Penalty removed. This user can play and claim again.'
            : 'That user is not on an active cooldown.'
    };
}

function applyPenaltyDelta(state, phone, deltaMs, now, roundMs) {
    const target = String(phone || '');
    const currentNow = now || Date.now();
    const step = roundMs > 0 ? roundMs : 40000;
    const delta = Number(deltaMs);
    if (!Number.isFinite(delta) || delta === 0) {
        return { ok: false, cleared: false, message: 'Enter a duration such as 10m, 1h, or 90s.' };
    }
    const before = activeSnapshot(state, target, currentNow, step);
    if (before.games <= 0 && before.timeLeft <= 0) {
        return { ok: false, cleared: false, message: 'That user is not on an active cooldown.' };
    }

    if (before.timeLeft > 0) {
        const nextTime = before.timeLeft + delta;
        if (nextTime <= 0) delete state.timeBans[target];
        else state.timeBans[target] = currentNow + nextTime;
    }

    if (before.games > 0) {
        const nextGameMs = before.gameLeft + delta;
        if (nextGameMs <= 0) delete state.activeCooldowns[target];
        else state.activeCooldowns[target] = Math.max(1, Math.round(nextGameMs / step));
    }

    const after = activeSnapshot(state, target, currentNow, step);
    const cleared = after.games <= 0 && after.timeLeft <= 0;
    if (cleared) {
        delete state.activeCooldowns[target];
        delete state.timeBans[target];
        if (state.meta) delete state.meta[target];
    }

    const amount = formatDuration(Math.abs(delta));
    const verb = delta > 0 ? 'Added' : 'Removed';
    const message = cleared
        ? verb + ' ' + amount + '. Cooldown cleared.'
        : verb + ' ' + amount + '. Remaining ' + formatDuration(after.remainingMs) + '.';

    return {
        ok: true,
        cleared,
        message,
        gamesRemaining: after.games,
        timeLeftMs: after.timeLeft,
        remainingMs: after.remainingMs,
        remainingLabel: formatDuration(after.remainingMs)
    };
}

module.exports = {
    PRESETS,
    formatDuration,
    parseDurationMs,
    penaltyKindForWinners,
    stricterKind,
    describePenalty,
    listPenalties,
    removePenalty,
    applyPenaltyDelta
};
