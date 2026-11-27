'use strict';

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

function getEatParts(now) {
    const ts = now == null ? Date.now() : Number(now);
    const d = new Date(ts + EAT_OFFSET_MS);
    return {
        year: d.getUTCFullYear(),
        month: d.getUTCMonth() + 1,
        day: d.getUTCDate(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        second: d.getUTCSeconds(),
        millis: ts
    };
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatEatClock(now) {
    const p = getEatParts(now);
    return pad2(p.hour) + ':' + pad2(p.minute) + ':' + pad2(p.second);
}

function formatServerClock(now) {
    const d = new Date(now == null ? Date.now() : Number(now));
    return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
}

function formatUtcClock(now) {
    return formatServerClock(now);
}

function formatEatDateTime(now) {
    const p = getEatParts(now);
    return p.year + '-' + pad2(p.month) + '-' + pad2(p.day) + ' ' + pad2(p.hour) + ':' + pad2(p.minute);
}

const EAT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toEatMillis(now) {
    if (now == null || now === '') return NaN;
    if (typeof now === 'number' && Number.isFinite(now)) return now;
    const ts = new Date(now).getTime();
    return Number.isFinite(ts) ? ts : NaN;
}

function formatEatDateTimeExact(now) {
    const ts = toEatMillis(now);
    if (!Number.isFinite(ts)) return '';
    const p = getEatParts(ts);
    return pad2(p.day) + ' ' + EAT_MONTHS[p.month - 1] + ' ' + p.year + ', ' +
        pad2(p.hour) + ':' + pad2(p.minute) + ':' + pad2(p.second) + ' EAT';
}

function parseHmToMinutes(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'string' && value.indexOf(':') !== -1) {
        const parts = value.split(':');
        const h = Number(parts[0]) || 0;
        const m = Number(parts[1]) || 0;
        return (h * 60) + m;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n === 24) return 24 * 60;
    if (n <= 23 && n >= 0 && (!Number.isInteger(n) || n <= 23)) {
        return Math.floor(n) * 60;
    }
    return Math.floor(n);
}

function eatMinutes(now) {
    const p = getEatParts(now);
    return (p.hour * 60) + p.minute;
}

function isEatInWindow(now, startVal, endVal) {
    const mins = eatMinutes(now);
    const start = parseHmToMinutes(startVal);
    const end = parseHmToMinutes(endVal);
    if (start === end) return false;
    if (start < end) return mins >= start && mins < end;
    return mins >= start || mins < end;
}

function isEatHourInclusive(now, startHour, endHour) {
    const hour = getEatParts(now).hour;
    const start = Number(startHour);
    const end = Number(endHour);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    if (start === end) return hour === start;
    if (start < end) return hour >= start && hour <= end;
    return hour >= start || hour <= end;
}

function eatDateTimeToUtc(dateStr, timeStr) {
    const dateParts = String(dateStr || '').split('-').map(Number);
    const timeParts = String(timeStr || '00:00').split(':').map(Number);
    const y = dateParts[0];
    const m = dateParts[1];
    const d = dateParts[2];
    const hh = timeParts[0] || 0;
    const mm = timeParts[1] || 0;
    const ss = timeParts[2] || 0;
    if (!y || !m || !d) return null;
    return new Date(Date.UTC(y, m - 1, d, hh, mm, ss) - EAT_OFFSET_MS);
}

function hourInRange(hour, start, end) {
    const h = Number(hour);
    const s = Number(start) || 0;
    const e = (end == null || end === '') ? 24 : Number(end);
    if (s === e) return false;
    if (s < e) return h >= s && h < e;
    return h >= s || h < e;
}

function currentEatDayStart(now) {
    const p = getEatParts(now);
    return new Date(Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) - EAT_OFFSET_MS);
}

function eatDayKey(now) {
    const p = getEatParts(now);
    return p.year + '-' + pad2(p.month) + '-' + pad2(p.day);
}

module.exports = {
    EAT_OFFSET_MS,
    getEatParts,
    pad2,
    formatEatClock,
    formatServerClock,
    formatUtcClock,
    formatEatDateTime,
    formatEatDateTimeExact,
    toEatMillis,
    parseHmToMinutes,
    eatMinutes,
    isEatInWindow,
    isEatHourInclusive,
    eatDateTimeToUtc,
    hourInRange,
    currentEatDayStart,
    eatDayKey
};
