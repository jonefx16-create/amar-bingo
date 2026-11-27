'use strict';

/**
 * One in-flight allocation per process, and a compare-and-set on the store
 * so two processes cannot publish the same round number.
 * The next id is always max(history, stored counter) + 1.
 */
function createRoundIdAllocator(store) {
    if (!store || typeof store.read !== 'function' || typeof store.compareAndSet !== 'function') {
        throw new Error('round id store is incomplete');
    }
    let chain = Promise.resolve();

    function enqueue(task) {
        const run = chain.then(task, task);
        chain = run.then(function () { return undefined; }, function () { return undefined; });
        return run;
    }

    async function allocateOnce() {
        for (let attempt = 0; attempt < 8; attempt++) {
            const highest = typeof store.highest === 'function' ? (Number(await store.highest()) || 0) : 0;
            const current = Number(await store.read()) || 0;
            const base = Math.max(highest, current, 0);
            const next = base + 1;
            const ok = await store.compareAndSet(current, next, base);
            if (ok) return next;
        }
        throw new Error('round id allocation failed');
    }

    return {
        allocate: function () {
            return enqueue(function () { return allocateOnce(); });
        }
    };
}

module.exports = {
    createRoundIdAllocator
};
