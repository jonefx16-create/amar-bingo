'use strict';

const claim = require('./claimBroadcast');

let failed = 0;
function assert(cond, msg) {
    if (!cond) {
        failed += 1;
        console.error('FAIL:', msg);
    }
}

const batch = claim.createMemoryBatch('batch-1', 1000);
assert(claim.rememberMessage(batch, 555, 42) === true, 'stores a delivery');
assert(batch.messages[0].chatId === '555' && batch.messages[0].messageId === 42, 'chat and message ids are normalized');
assert(claim.rememberMessage(batch, 555, null) === false, 'missing message id is ignored');
batch.status = 'deleted';
assert(claim.rememberMessage(batch, 555, 9) === false, 'deleted batch does not keep new messages');
assert(claim.isDbBatchId('507f1f77bcf86cd799439011') === true, 'mongo id is recognized');
assert(claim.isDbBatchId('mem-12') === false, 'memory id is not a database id');

const missing = claim.classifyTelegramDeleteError({
    message: 'ETELEGRAM: 400 Bad Request: message to delete not found',
    response: { body: { error_code: 400, description: 'Bad Request: message to delete not found' } }
});
assert(missing.reason === 'MessageToDeleteNotFound' && missing.action === 'fail', 'missing messages are not retried');

const blocked = claim.classifyTelegramDeleteError({
    response: { body: { error_code: 403, description: 'Forbidden: bot was blocked by the user' } }
});
assert(blocked.reason === 'BotBlocked' && blocked.action === 'fail', 'blocked chats are not retried');

const flood = claim.classifyTelegramDeleteError({
    response: { body: { error_code: 429, description: 'Too Many Requests: retry after 2', parameters: { retry_after: 2 } } }
});
assert(flood.action === 'retry' && flood.waitMs === 2000, 'flood control waits for retry_after');

async function runDeleteFlow() {
    const calls = [];
    const sleeps = [];
    const result = await claim.deleteTrackedMessages([
        { chatId: '1', messageId: 10 },
        { chatId: '2', messageId: 20 },
        { chatId: '3', messageId: 30 }
    ], async (chatId, messageId) => {
        calls.push(chatId + ':' + messageId);
        if (chatId === '2' && calls.filter((item) => item.indexOf('2:') === 0).length === 1) {
            const error = new Error('429');
            error.response = { body: { error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } } };
            throw error;
        }
        if (chatId === '3') {
            const error = new Error('blocked');
            error.response = { body: { error_code: 403, description: 'Forbidden: bot was blocked by the user' } };
            throw error;
        }
    }, (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
    }, { gapMs: 35, maxAttempts: 3 });

    assert(result.deleted === 2, 'two messages delete after a flood retry');
    assert(result.failed === 1 && result.blocked === 1, 'blocked recipient counts as failed');
    assert(result.kept.length === 0, 'blocked messages are not kept for retry');
    assert(sleeps.indexOf(1000) !== -1, 'flood wait is applied before retry');
    assert(claim.summarizeDeleteResult(result).indexOf('Deleted 2') !== -1, 'summary includes deleted count');
    assert(claim.summarizeDeleteResult(result).indexOf('Failed 1') !== -1, 'summary includes failed count');
    assert(claim.summarizeDeleteResult(null, { empty: true }) === 'No recent claim announcement found.', 'empty batch has its own summary');
}

runDeleteFlow().then(() => {
    if (failed) {
        console.error(failed + ' claim broadcast test(s) failed');
        process.exit(1);
    }
    console.log('claim broadcast tests passed');
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
