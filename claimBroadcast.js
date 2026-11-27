'use strict';

const DEFAULT_GAP_MS = 35;
const DEFAULT_MAX_ATTEMPTS = 4;
const MAX_FLOOD_WAIT_MS = 20000;

function createMemoryBatch(id, createdAt) {
    return {
        id: id || null,
        createdAt: createdAt || Date.now(),
        status: 'sending',
        messages: []
    };
}

function isDbBatchId(id) {
    return /^[a-f0-9]{24}$/i.test(String(id || ''));
}

function rememberMessage(batch, chatId, messageId) {
    if (!batch || batch.status === 'deleted' || batch.status === 'idle' || batch.status === 'deleting') return false;
    if (chatId == null || chatId === '' || messageId == null || messageId === '') return false;
    const numericId = Number(messageId);
    if (!Number.isFinite(numericId)) return false;
    batch.messages.push({ chatId: String(chatId), messageId: numericId });
    return true;
}

function errorParts(err) {
    const body = err && err.response && err.response.body;
    const description = body && body.description;
    const message = err && (err.message || err.description);
    return {
        code: body && body.error_code,
        retryAfter: body && body.parameters && body.parameters.retry_after,
        text: [description, message].filter(Boolean).join(' ')
    };
}

function classifyTelegramDeleteError(err) {
    const parts = errorParts(err);
    const text = String(parts.text || '').toLowerCase();
    let retryAfter = Number(parts.retryAfter);
    if (!Number.isFinite(retryAfter)) {
        const match = text.match(/retry after (\d+(?:\.\d+)?)/);
        retryAfter = match ? Number(match[1]) : 1;
    }

    if (parts.code === 429 || text.includes('too many requests') || text.includes('flood') || text.includes('retry after')) {
        const waitMs = Math.min(MAX_FLOOD_WAIT_MS, Math.max(1000, Math.ceil(retryAfter * 1000)));
        return { action: 'retry', reason: 'flood', waitMs };
    }

    if (
        text.includes('message to delete not found') ||
        text.includes('message_id_invalid') ||
        text.includes("message can't be deleted") ||
        text.includes('message to delete not found')
    ) {
        return { action: 'fail', reason: 'MessageToDeleteNotFound', waitMs: 0 };
    }

    if (
        parts.code === 403 ||
        text.includes('bot was blocked') ||
        text.includes('bot was kicked') ||
        text.includes('user is deactivated') ||
        text.includes('chat not found') ||
        text.includes('peer_id_invalid') ||
        text.includes('bot is not a member')
    ) {
        return { action: 'fail', reason: 'BotBlocked', waitMs: 0 };
    }

    return { action: 'retry', reason: 'other', waitMs: 500 };
}

function emptyDeleteResult() {
    return { deleted: 0, failed: 0, blocked: 0, missing: 0, retryable: 0, kept: [] };
}

async function deleteTrackedMessages(messages, deleteMessage, sleep, options) {
    const settings = options || {};
    const gapMs = settings.gapMs == null ? DEFAULT_GAP_MS : settings.gapMs;
    const maxAttempts = settings.maxAttempts || DEFAULT_MAX_ATTEMPTS;
    const pause = typeof sleep === 'function' ? sleep : function () { return Promise.resolve(); };
    const result = emptyDeleteResult();
    const list = Array.isArray(messages) ? messages : [];

    for (let i = 0; i < list.length; i++) {
        const entry = list[i];
        let attempt = 0;
        let settled = false;
        while (!settled && attempt < maxAttempts) {
            attempt += 1;
            try {
                await deleteMessage(entry.chatId, entry.messageId);
                result.deleted += 1;
                settled = true;
            } catch (err) {
                const decision = classifyTelegramDeleteError(err);
                if (decision.action === 'fail') {
                    result.failed += 1;
                    if (decision.reason === 'BotBlocked') result.blocked += 1;
                    else result.missing += 1;
                    settled = true;
                } else if (attempt >= maxAttempts) {
                    result.failed += 1;
                    result.retryable += 1;
                    result.kept.push(entry);
                    settled = true;
                } else {
                    await pause(decision.waitMs || 500);
                }
            }
        }
        if (gapMs > 0 && i < list.length - 1) await pause(gapMs);
    }

    return result;
}

function summarizeDeleteResult(result, options) {
    const stats = result || emptyDeleteResult();
    const opts = options || {};
    if (opts.empty) return 'No recent claim announcement found.';
    const failed = Number(stats.failed) || 0;
    const deleted = Number(stats.deleted) || 0;
    const parts = ['Deleted ' + deleted + ' message' + (deleted === 1 ? '' : 's') + '.'];
    if (failed > 0) {
        const details = [];
        if (stats.blocked) details.push(stats.blocked + ' blocked');
        if (stats.missing) details.push(stats.missing + ' already gone');
        if (stats.retryable) details.push(stats.retryable + ' still retryable');
        parts.push('Failed ' + failed + (details.length ? ' (' + details.join(', ') + ')' : '') + '.');
    } else {
        parts.push('Failed 0.');
    }
    return parts.join(' ');
}

module.exports = {
    createMemoryBatch,
    isDbBatchId,
    rememberMessage,
    classifyTelegramDeleteError,
    deleteTrackedMessages,
    summarizeDeleteResult
};
