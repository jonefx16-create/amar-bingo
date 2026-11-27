'use strict';

const { eatDateTimeToUtc, formatEatDateTime } = require('./eatTime');

function buildScheduledPost(text, dateStr, timeStr, now) {
    const body = String(text || '').trim();
    const scheduledAt = eatDateTimeToUtc(dateStr, timeStr);
    if (!body) return { ok: false, message: 'Announcement text is required.' };
    if (!scheduledAt) return { ok: false, message: 'Enter a valid EAT date and time.' };
    const ts = now == null ? Date.now() : Number(now);
    if (scheduledAt.getTime() <= ts - 60000) {
        return { ok: false, message: 'Scheduled time must be in the future (EAT).' };
    }
    return {
        ok: true,
        doc: {
            text: body,
            eatDate: String(dateStr || ''),
            eatTime: String(timeStr || '00:00'),
            scheduledAt,
            status: 'queued',
            createdAt: new Date(ts)
        }
    };
}

function postsDue(now) {
    const ts = now == null ? Date.now() : Number(now);
    return { status: 'queued', scheduledAt: { $lte: new Date(ts) } };
}

function shapeScheduledPost(doc) {
    if (!doc) return null;
    return {
        id: String(doc._id || ''),
        text: doc.text,
        eatDate: doc.eatDate,
        eatTime: doc.eatTime,
        scheduledAt: doc.scheduledAt,
        eatLabel: doc.scheduledAt ? formatEatDateTime(doc.scheduledAt) : '',
        status: doc.status || 'queued',
        sentAt: doc.sentAt || null
    };
}

module.exports = {
    buildScheduledPost,
    postsDue,
    shapeScheduledPost
};
