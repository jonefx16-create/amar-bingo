'use strict';

/**
 * Pre-round line index.
 * Built once, after ticket buy-in freezes and before ball 1.
 * Draw ticks look up completing numbers and bingo lines here.
 * Grids are walked only while the index is built (or when one emergency
 * card is rebuilt). They are not walked again on a draw tick.
 * The warmup also maps calls 1–10 so the live draw can avoid numbers
 * that would leave a card one number away inside that window.
 */

const { splitRank, MAX_SPLIT_WINNERS } = require('./botController');

const FREE = 'FREE';

function isFreeCell(val) {
    return val === FREE || val === 'free';
}

function playerList(players) {
    if (!players) return [];
    if (Array.isArray(players)) return players.filter(Boolean);
    return Object.values(players).filter(Boolean);
}

function gridOfTicket(ticket, gridOf) {
    if (typeof gridOf === 'function') {
        const supplied = gridOf(ticket);
        if (Array.isArray(supplied)) return supplied;
    }
    return ticket && ticket.grid;
}

function cellNumbers(cells) {
    const nums = [];
    const seen = new Set();
    for (let i = 0; i < cells.length; i++) {
        const val = cells[i];
        if (isFreeCell(val)) continue;
        const n = Number(val);
        if (!Number.isInteger(n) || n < 1 || n > 75 || seen.has(n)) continue;
        seen.add(n);
        nums.push(n);
    }
    return nums;
}

function bingoCells(grid) {
    if (!Array.isArray(grid) || grid.length < 5) return [];
    for (let c = 0; c < 5; c++) {
        if (!Array.isArray(grid[c]) || grid[c].length < 5) return [];
    }
    return [
        [grid[0][0], grid[0][1], grid[0][2], grid[0][3], grid[0][4]],
        [grid[1][0], grid[1][1], grid[1][2], grid[1][3], grid[1][4]],
        [grid[2][0], grid[2][1], grid[2][2], grid[2][3], grid[2][4]],
        [grid[3][0], grid[3][1], grid[3][2], grid[3][3], grid[3][4]],
        [grid[4][0], grid[4][1], grid[4][2], grid[4][3], grid[4][4]],
        [grid[0][0], grid[1][0], grid[2][0], grid[3][0], grid[4][0]],
        [grid[0][1], grid[1][1], grid[2][1], grid[3][1], grid[4][1]],
        [grid[0][2], grid[1][2], grid[2][2], grid[3][2], grid[4][2]],
        [grid[0][3], grid[1][3], grid[2][3], grid[3][3], grid[4][3]],
        [grid[0][4], grid[1][4], grid[2][4], grid[3][4], grid[4][4]],
        [grid[0][0], grid[1][1], grid[2][2], grid[3][3], grid[4][4]],
        [grid[0][4], grid[1][3], grid[2][2], grid[3][1], grid[4][0]],
        [grid[0][0], grid[0][4], grid[4][0], grid[4][4]]
    ];
}

function walkNumbers(grid) {
    const out = [];
    const seen = new Set();
    if (!Array.isArray(grid)) return out;
    for (let c = 0; c < grid.length; c++) {
        const col = grid[c] || [];
        for (let r = 0; r < col.length; r++) {
            const val = col[r];
            if (isFreeCell(val)) continue;
            const n = Number(val);
            if (!Number.isInteger(n) || seen.has(n)) continue;
            seen.add(n);
            out.push(n);
        }
    }
    return out;
}

function setBit(line, n) {
    if (n <= 32) line.m0 |= (1 << (n - 1));
    else if (n <= 64) line.m1 |= (1 << (n - 33));
    else line.m2 |= (1 << (n - 65));
}

function hasBit(line, n) {
    if (n <= 32) return (line.m0 & (1 << (n - 1))) !== 0;
    if (n <= 64) return (line.m1 & (1 << (n - 33))) !== 0;
    return (line.m2 & (1 << (n - 65))) !== 0;
}

function restoreLine(line) {
    line.m0 = 0;
    line.m1 = 0;
    line.m2 = 0;
    const nums = line.nums;
    const miss = line.miss;
    for (let i = 0; i < nums.length; i++) {
        miss[i] = nums[i];
        setBit(line, nums[i]);
    }
    miss.length = nums.length;
    miss.sort(function (a, b) { return a - b; });
    line.missCount = miss.length;
    line.completingOn = 0;
    line.completeSlot = -1;
    line.trieNode = null;
    line.trieSlot = -1;
}

function stripNumber(line, n) {
    if (n <= 32) line.m0 &= ~(1 << (n - 1));
    else if (n <= 64) line.m1 &= ~(1 << (n - 33));
    else line.m2 &= ~(1 << (n - 65));
    const miss = line.miss;
    let w = 0;
    for (let i = 0; i < line.missCount; i++) {
        if (miss[i] !== n) miss[w++] = miss[i];
    }
    line.missCount = w;
}

function buildRoundLineIndex(players, options) {
    options = options || {};
    const gridOf = options.gridOf;
    const seated = playerList(players);
    const cards = [];
    const lines = [];
    const byPlayer = new Map();
    const byTicketRef = new Map();
    const byNumber = new Array(76);
    const botLinesByNumber = new Array(76);
    const humanLinesByNumber = new Array(76);
    for (let n = 0; n < 76; n++) {
        byNumber[n] = [];
        botLinesByNumber[n] = [];
        humanLinesByNumber[n] = [];
    }
    let gridWalks = 0;

    for (let p = 0; p < seated.length; p++) {
        const player = seated[p];
        const tickets = (player && player.ticketsData) || [];
        const owned = [];
        for (let t = 0; t < tickets.length; t++) {
            const ticket = tickets[t];
            if (!ticket) continue;
            const grid = gridOfTicket(ticket, gridOf);
            gridWalks += 1;
            const cells = bingoCells(grid);
            const card = {
                player: player,
                ticket: ticket,
                lines: [],
                walk: walkNumbers(grid),
                complete: false,
                dead: false,
                mark: 0,
                fresh: 0,
                already: 0
            };
            for (let i = 0; i < cells.length; i++) {
                const nums = cellNumbers(cells[i]);
                if (nums.length < 2) continue;
                const line = {
                    idx: lines.length,
                    card: card,
                    player: player,
                    ticket: ticket,
                    lineIndex: i,
                    isCorner: i === 12,
                    nums: nums,
                    miss: [],
                    missCount: 0,
                    m0: 0,
                    m1: 0,
                    m2: 0,
                    dead: false,
                    completingOn: 0,
                    completeSlot: -1,
                    trieNode: null,
                    trieSlot: -1
                };
                restoreLine(line);
                lines.push(line);
                card.lines.push(line);
                if (player.isBot) {
                    if (!card.firstBirth) card.firstBirth = new Uint16Array(76);
                    const birth = line.idx + 1;
                    for (let k = 0; k < nums.length; k++) {
                        const num = nums[k];
                        if (!card.firstBirth[num] || birth < card.firstBirth[num]) card.firstBirth[num] = birth;
                    }
                }
                for (let k = 0; k < nums.length; k++) {
                    byNumber[nums[k]].push(line);
                    if (player.isBot) botLinesByNumber[nums[k]].push(line);
                    else humanLinesByNumber[nums[k]].push(line);
                }
            }
            cards.push(card);
            owned.push(card);
            byTicketRef.set(ticket, card);
        }
        if (owned.length) {
            const prev = byPlayer.get(player);
            if (prev) {
                for (let i = 0; i < owned.length; i++) prev.push(owned[i]);
            } else {
                byPlayer.set(player, owned);
            }
        }
    }

    const index = {
        cards: cards,
        lines: lines,
        byPlayer: byPlayer,
        byTicketRef: byTicketRef,
        byNumber: byNumber,
        botLinesByNumber: botLinesByNumber,
        humanLinesByNumber: humanLinesByNumber,
        completing: new Array(76),
        approachCount: new Uint16Array(76),
        calledList: [],
        calledSet: new Uint8Array(76),
        completeCount: 0,
        trieRoot: { child: null, ids: null },
        query: 1,
        mark: 0,
        gridWalks: gridWalks,
        drawGridWalks: 0,
        cardCount: cards.length,
        lineCount: lines.length,
        playerCount: byPlayer.size
    };
    for (let n = 0; n < 76; n++) index.completing[n] = [];

    function trieInsert(line) {
        let node = index.trieRoot;
        const miss = line.miss;
        for (let i = 0; i < line.missCount; i++) {
            const n = miss[i];
            if (!node.child) node.child = new Array(76);
            let next = node.child[n];
            if (!next) {
                next = { child: null, ids: null };
                node.child[n] = next;
            }
            node = next;
        }
        if (!node.ids) node.ids = [];
        line.trieSlot = node.ids.length;
        node.ids.push(line.idx);
        line.trieNode = node;
    }

    function trieRemove(line) {
        const node = line.trieNode;
        if (!node || !node.ids) {
            line.trieNode = null;
            return;
        }
        const ids = node.ids;
        let slot = line.trieSlot;
        if (ids[slot] !== line.idx) {
            slot = ids.indexOf(line.idx);
            if (slot < 0) {
                line.trieNode = null;
                return;
            }
        }
        const moved = ids[ids.length - 1];
        ids[slot] = moved;
        if (moved !== line.idx) index.lines[moved].trieSlot = slot;
        ids.pop();
        line.trieNode = null;
        line.trieSlot = -1;
    }

    function removeCompleting(line) {
        const n = line.completingOn;
        if (!n) return;
        const bucket = index.completing[n];
        let slot = line.completeSlot;
        if (bucket[slot] !== line) {
            slot = bucket.indexOf(line);
            if (slot < 0) {
                line.completingOn = 0;
                return;
            }
        }
        const moved = bucket[bucket.length - 1];
        bucket[slot] = moved;
        if (moved && moved !== line) moved.completeSlot = slot;
        bucket.pop();
        line.completingOn = 0;
        line.completeSlot = -1;
    }

    // A line with two numbers still missing. Calling either one leaves the
    // card one number away, so the scatter calls keep those numbers back.
    function clearApproach(line) {
        const pair = line.approachOn;
        if (!pair) return;
        const a = pair[0];
        const b = pair[1];
        if (a > 0 && index.approachCount[a] > 0) index.approachCount[a]--;
        if (b > 0 && index.approachCount[b] > 0) index.approachCount[b]--;
        line.approachOn = null;
    }

    function syncApproach(line) {
        if (line.missCount === 2 && !line.dead && !line.card.dead && !line.card.complete) {
            if (line.approachOn) return;
            const a = line.miss[0];
            const b = line.miss[1];
            line.approachOn = [a, b];
            if (a > 0) index.approachCount[a]++;
            if (b > 0) index.approachCount[b]++;
            return;
        }
        clearApproach(line);
    }

    function detachLine(line) {
        trieRemove(line);
        removeCompleting(line);
        clearApproach(line);
    }

    function attachLine(line) {
        if (line.missCount === 1) {
            const n = line.miss[0];
            const bucket = index.completing[n];
            line.completingOn = n;
            line.completeSlot = bucket.length;
            bucket.push(line);
        } else {
            line.completingOn = 0;
            line.completeSlot = -1;
        }
        syncApproach(line);
        trieInsert(line);
    }

    function ensureBotHeads() {
        if (index.botHead) return;
        index.botHead = new Array(76);
        index.botTail = new Array(76);
        for (let n = 0; n <= 75; n++) {
            index.botHead[n] = new Array(6).fill(null);
            index.botTail[n] = new Array(6).fill(null);
        }
    }

    function unlinkBotNode(node) {
        if (!node || node.count < 0) return;
        const heads = index.botHead[node.n];
        const tails = index.botTail[node.n];
        const count = node.count;
        if (node.prev) node.prev.next = node.next;
        else heads[count] = node.next;
        if (node.next) node.next.prev = node.prev;
        else tails[count] = node.prev;
        node.prev = null;
        node.next = null;
        node.count = -1;
    }

    function linkBotNode(node, count) {
        const heads = index.botHead[node.n];
        const tails = index.botTail[node.n];
        const birth = node.line.idx;
        const tail = tails[count];
        if (!tail || tail.line.idx <= birth) {
            node.prev = tail;
            node.next = null;
            if (tail) tail.next = node;
            else heads[count] = node;
            tails[count] = node;
            node.count = count;
            return;
        }
        let cur = heads[count];
        while (cur && cur.line.idx <= birth) cur = cur.next;
        node.next = cur;
        node.prev = cur.prev;
        if (cur.prev) cur.prev.next = node;
        else heads[count] = node;
        cur.prev = node;
        node.count = count;
    }

    function unlinkBotLine(line) {
        const nodes = line && line.botNodes;
        if (!nodes) return;
        for (let i = 0; i < nodes.length; i++) unlinkBotNode(nodes[i]);
    }

    // Bot lines that still miss a number, grouped by how many numbers they
    // still miss and ordered by seat. Ball selection reads the head.
    function refreshBotLine(line) {
        if (!line || !line.player || !line.player.isBot) return;
        ensureBotHeads();
        if (!line.botNodes) {
            const nums = line.nums;
            const nodes = new Array(nums.length);
            for (let i = 0; i < nums.length; i++) {
                nodes[i] = { line: line, n: nums[i], prev: null, next: null, count: -1 };
            }
            line.botNodes = nodes;
        }
        const nodes = line.botNodes;
        for (let i = 0; i < nodes.length; i++) unlinkBotNode(nodes[i]);
        if (line.dead || line.card.dead || line.card.complete || line.missCount <= 0 || line.missCount > 5) return;
        const count = line.missCount;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!hasBit(line, node.n)) continue;
            linkBotNode(node, count);
        }
    }

    function clearBotLinks() {
        if (!index.botHead) return;
        for (let n = 1; n <= 75; n++) {
            const heads = index.botHead[n];
            const tails = index.botTail[n];
            for (let c = 0; c <= 5; c++) {
                let node = heads[c];
                while (node) {
                    const next = node.next;
                    node.prev = null;
                    node.next = null;
                    node.count = -1;
                    node = next;
                }
                heads[c] = null;
                tails[c] = null;
            }
        }
    }

    function markCardComplete(card, triggeringLine) {
        if (card.complete || card.dead) return;
        card.complete = true;
        index.completeCount += 1;
        const owned = card.lines;
        for (let i = 0; i < owned.length; i++) {
            const line = owned[i];
            if (line === triggeringLine || line.dead) continue;
            detachLine(line);
        }
    }

    function attachFresh(line) {
        if (line.dead || line.card.dead || line.card.complete) return;
        if (line.missCount === 0) markCardComplete(line.card, line);
        else attachLine(line);
    }

    for (let i = 0; i < lines.length; i++) attachFresh(lines[i]);
    for (let i = 0; i < lines.length; i++) refreshBotLine(lines[i]);

    function noteCalled(raw) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 75) return;
        if (index.calledSet[n]) return;
        index.calledSet[n] = 1;
        index.calledList.push(n);
        const bucket = byNumber[n];
        for (let i = 0; i < bucket.length; i++) {
            const line = bucket[i];
            if (line.dead || !hasBit(line, n)) continue;
            detachLine(line);
            stripNumber(line, n);
            const card = line.card;
            if (line.dead || card.dead) {
                unlinkBotLine(line);
                continue;
            }
            if (card.complete) {
                refreshBotLine(line);
                continue;
            }
            if (line.missCount === 0) markCardComplete(card, line);
            else attachLine(line);
            refreshBotLine(line);
        }
    }

    function rebuildCalled(list) {
        index.trieRoot = { child: null, ids: null };
        for (let n = 0; n < 76; n++) index.completing[n] = [];
        index.approachCount.fill(0);
        index.calledList = [];
        index.calledSet = new Uint8Array(76);
        index.completeCount = 0;
        clearBotLinks();
        for (let i = 0; i < lines.length; i++) lines[i].approachOn = null;
        for (let c = 0; c < cards.length; c++) {
            const card = cards[c];
            card.complete = false;
            if (card.dead) continue;
            const owned = card.lines;
            for (let i = 0; i < owned.length; i++) {
                const line = owned[i];
                if (line.dead) continue;
                restoreLine(line);
                attachLine(line);
                refreshBotLine(line);
            }
        }
        for (let i = 0; i < list.length; i++) noteCalled(list[i]);
    }

    function syncCalled(called) {
        const list = called || [];
        const mine = index.calledList;
        let i = 0;
        const n = Math.min(list.length, mine.length);
        for (; i < n; i++) {
            if (Number(list[i]) !== mine[i]) break;
        }
        if (i !== mine.length) {
            rebuildCalled(list);
            return;
        }
        for (; i < list.length; i++) noteCalled(list[i]);
    }

    function markPlayers(group) {
        const q = ++index.query;
        index.mark = q;
        const list = group || [];
        for (let i = 0; i < list.length; i++) {
            const owned = byPlayer.get(list[i]);
            if (!owned) continue;
            for (let c = 0; c < owned.length; c++) owned[c].mark = q;
        }
        return q;
    }

    function cardsOf(group) {
        const out = [];
        const list = group || [];
        for (let i = 0; i < list.length; i++) {
            const owned = byPlayer.get(list[i]);
            if (!owned) continue;
            for (let c = 0; c < owned.length; c++) {
                if (!owned[c].dead) out.push(owned[c]);
            }
        }
        return out;
    }

    function enumerateLines(group) {
        const out = [];
        const ownedCards = cardsOf(group);
        for (let c = 0; c < ownedCards.length; c++) {
            const owned = ownedCards[c].lines;
            for (let i = 0; i < owned.length; i++) {
                if (!owned[i].dead) out.push(owned[i]);
            }
        }
        return out;
    }

    function oneAwayNumbers(group, opts) {
        opts = opts || {};
        const pool = opts.pool ? new Set(opts.pool.map(function (n) { return Number(n); })) : null;
        const avoid = new Set((opts.avoid || []).map(function (n) { return Number(n); }));
        const out = [];
        const seen = new Set();
        const ownedCards = cardsOf(group);
        for (let c = 0; c < ownedCards.length; c++) {
            const owned = ownedCards[c].lines;
            for (let i = 0; i < owned.length; i++) {
                const line = owned[i];
                if (line.dead || line.missCount !== 1) continue;
                const n = line.miss[0];
                if (pool && !pool.has(n)) continue;
                if (avoid.has(n)) continue;
                if (seen.has(n)) continue;
                seen.add(n);
                out.push(n);
            }
        }
        return out;
    }

    function tallyFinishers(group, opts) {
        opts = opts || {};
        const pool = opts.pool ? new Set(opts.pool.map(function (n) { return Number(n); })) : null;
        const avoid = new Set((opts.avoid || []).map(function (n) { return Number(n); }));
        const tally = index._finisherTally || (index._finisherTally = new Uint16Array(76));
        tally.fill(0);
        const stamp = index._finisherStamp || (index._finisherStamp = new Int32Array(76));
        let generation = index._finisherGen || 1;
        const ownedCards = cardsOf(group);
        for (let c = 0; c < ownedCards.length; c++) {
            if (generation >= 2147483647) {
                stamp.fill(0);
                generation = 1;
            }
            const owned = ownedCards[c].lines;
            for (let i = 0; i < owned.length; i++) {
                const line = owned[i];
                if (line.dead || line.missCount !== 1) continue;
                const n = line.miss[0];
                if (n < 1 || n > 75) continue;
                if (pool && !pool.has(n)) continue;
                if (avoid.has(n)) continue;
                if (stamp[n] === generation) continue;
                stamp[n] = generation;
                tally[n] += 1;
            }
            generation += 1;
        }
        index._finisherGen = generation;
        return tally;
    }

    function bestFinisherBall(group, opts) {
        const tally = tallyFinishers(group, opts);
        let best = 0;
        let bestRank = 0;
        let bestRaw = 0;
        for (let n = 1; n <= 75; n++) {
            const raw = tally[n];
            if (!raw) continue;
            const rank = splitRank(raw);
            if (rank > bestRank) {
                best = n;
                bestRank = rank;
                bestRaw = raw;
            }
        }
        if (!best) return null;
        const paid = bestRaw > MAX_SPLIT_WINNERS ? MAX_SPLIT_WINNERS : bestRaw;
        return { num: best, count: paid };
    }

    function soloFinisherBall(group, opts) {
        const tally = tallyFinishers(group, opts);
        const solos = [];
        for (let n = 1; n <= 75; n++) {
            if (tally[n] === 1) solos.push(n);
        }
        if (!solos.length) return null;
        const rng = opts && typeof opts.rng === 'function' ? opts.rng : Math.random;
        const num = solos[Math.floor(rng() * solos.length)];
        return { num: num, count: 1 };
    }

    function trieCollect(sortedNums, out) {
        function rec(node, si) {
            const ids = node.ids;
            if (ids && ids.length) {
                for (let i = 0; i < ids.length; i++) out.push(ids[i]);
            }
            const child = node.child;
            if (!child) return;
            for (let i = si; i < sortedNums.length; i++) {
                const next = child[sortedNums[i]];
                if (next) rec(next, i + 1);
            }
        }
        rec(index.trieRoot, 0);
    }

    function freshByRescan(group, called, num) {
        const calledSet = new Set((called || []).map(function (n) { return Number(n); }));
        const tickets = [];
        const ownedCards = cardsOf(group);
        for (let c = 0; c < ownedCards.length; c++) {
            const card = ownedCards[c];
            let already = false;
            let hits = false;
            const owned = card.lines;
            for (let i = 0; i < owned.length; i++) {
                const line = owned[i];
                if (line.dead) continue;
                let missing = 0;
                let hasNum = false;
                const nums = line.nums;
                for (let k = 0; k < nums.length; k++) {
                    if (calledSet.has(nums[k])) continue;
                    missing += 1;
                    if (nums[k] === num) hasNum = true;
                }
                if (missing === 0) already = true;
                else if (missing === 1 && hasNum) hits = true;
            }
            if (!already && hits) tickets.push(card.ticket);
        }
        return tickets;
    }

    function freshFromExtras(group, extras, num) {
        const inExtra = new Uint8Array(76);
        const unique = [];
        const seen = new Uint8Array(76);
        for (let i = 0; i < extras.length; i++) {
            const n = Number(extras[i]);
            if (!Number.isInteger(n) || n < 1 || n > 75 || seen[n]) continue;
            seen[n] = 1;
            inExtra[n] = 1;
            unique.push(n);
        }
        if (!seen[num] && num >= 1 && num <= 75) unique.push(num);
        unique.sort(function (a, b) { return a - b; });
        const q = markPlayers(group);
        const hits = [];
        trieCollect(unique, hits);
        const maybe = [];
        for (let i = 0; i < hits.length; i++) {
            const line = lines[hits[i]];
            if (!line || line.dead || line.card.dead || line.card.complete) continue;
            if (line.card.mark !== q) continue;
            const card = line.card;
            if (inExtra[num] || !hasBit(line, num)) {
                card.already = q;
            } else if (card.fresh !== q) {
                card.fresh = q;
                maybe.push(card);
            }
        }
        const tickets = [];
        for (let i = 0; i < maybe.length; i++) {
            if (maybe[i].already === q) continue;
            tickets.push(maybe[i].ticket);
        }
        return tickets;
    }

    function groupCountsFromExtras(targetPlayers, botPlayers, otherPlayers, extras, num) {
        const inExtra = new Uint8Array(76);
        const unique = [];
        const seen = new Uint8Array(76);
        for (let i = 0; i < extras.length; i++) {
            const n = Number(extras[i]);
            if (!Number.isInteger(n) || n < 1 || n > 75 || seen[n]) continue;
            seen[n] = 1;
            inExtra[n] = 1;
            unique.push(n);
        }
        if (!seen[num] && num >= 1 && num <= 75) unique.push(num);
        unique.sort(function (a, b) { return a - b; });
        const q = ++index.query;
        function stamp(group, id) {
            const list = group || [];
            for (let i = 0; i < list.length; i++) {
                const owned = byPlayer.get(list[i]);
                if (!owned) continue;
                for (let c = 0; c < owned.length; c++) {
                    owned[c].mark = q;
                    owned[c].group = id;
                }
            }
        }
        stamp(targetPlayers, 1);
        stamp(botPlayers, 2);
        stamp(otherPlayers, 3);
        const hits = [];
        trieCollect(unique, hits);
        const maybe = [];
        for (let i = 0; i < hits.length; i++) {
            const line = lines[hits[i]];
            if (!line || line.dead || line.card.dead || line.card.complete) continue;
            if (line.card.mark !== q) continue;
            const card = line.card;
            if (inExtra[num] || !hasBit(line, num)) card.already = q;
            else if (card.fresh !== q) {
                card.fresh = q;
                maybe.push(card);
            }
        }
        const counts = [0, 0, 0, 0];
        for (let i = 0; i < maybe.length; i++) {
            const card = maybe[i];
            if (card.already === q) continue;
            counts[card.group] += 1;
        }
        return { target: counts[1], bots: counts[2], others: counts[3] };
    }

    function freshGroupCounts(targetPlayers, botPlayers, otherPlayers, called, num) {
        const n = Number(num);
        if (!Number.isInteger(n) || n < 1 || n > 75) return { target: 0, bots: 0, others: 0 };
        const list = called || [];
        const mine = index.calledList;
        if (list.length < mine.length) {
            return {
                target: freshByRescan(targetPlayers, list, n).length,
                bots: freshByRescan(botPlayers, list, n).length,
                others: freshByRescan(otherPlayers, list, n).length
            };
        }
        for (let i = 0; i < mine.length; i++) {
            if (Number(list[i]) !== mine[i]) {
                return {
                    target: freshByRescan(targetPlayers, list, n).length,
                    bots: freshByRescan(botPlayers, list, n).length,
                    others: freshByRescan(otherPlayers, list, n).length
                };
            }
        }
        const extras = [];
        for (let i = mine.length; i < list.length; i++) extras.push(Number(list[i]));
        return groupCountsFromExtras(targetPlayers, botPlayers, otherPlayers, extras, n);
    }

    function freshCompletingTickets(group, called, num) {
        const n = Number(num);
        if (!Number.isInteger(n) || n < 1 || n > 75) return [];
        const list = called || [];
        const mine = index.calledList;
        if (list.length < mine.length) return freshByRescan(group, list, n);
        for (let i = 0; i < mine.length; i++) {
            if (Number(list[i]) !== mine[i]) return freshByRescan(group, list, n);
        }
        const extras = [];
        for (let i = mine.length; i < list.length; i++) extras.push(Number(list[i]));
        return freshFromExtras(group, extras, n);
    }

    function uncalledNumbers(group) {
        const out = [];
        const seen = new Uint8Array(76);
        const ownedCards = cardsOf(group);
        const called = index.calledSet;
        for (let c = 0; c < ownedCards.length; c++) {
            const walk = ownedCards[c].walk;
            for (let i = 0; i < walk.length; i++) {
                const n = walk[i];
                if (n < 1 || n > 75 || called[n] || seen[n]) continue;
                seen[n] = 1;
                out.push(n);
            }
        }
        return out;
    }

    function hitsFor(n) {
        if (!Number.isInteger(n) || n < 1 || n > 75) return null;
        const hits = index.completing[n];
        if (!hits || !hits.length) return null;
        return hits;
    }

    function classifyPools(sequence, sets) {
        sets = sets || {};
        const blocked = new Set(sets.blockedPhones || []);
        const eligible = new Set(sets.eligibleRealPhones || []);
        const depositors = new Set(sets.depositorPhones || []);
        const winForBots = [];
        const winForBlocked = [];
        const winForEligibleReal = [];
        const winForDepositor = [];
        const list = sequence || [];
        for (let i = 0; i < list.length; i++) {
            const n = Number(list[i]);
            const hits = hitsFor(n);
            if (!hits) continue;
            let bot = false;
            let blk = false;
            let elig = false;
            let dep = false;
            for (let h = 0; h < hits.length; h++) {
                const line = hits[h];
                if (!line || line.dead || line.card.dead || line.card.complete) continue;
                const player = line.player;
                if (player && player.isBot) bot = true;
                const phone = player && player.phone;
                if (blocked.has(phone)) blk = true;
                if (eligible.has(phone)) elig = true;
                if (depositors.has(phone)) dep = true;
            }
            if (bot) winForBots.push(n);
            if (blk) winForBlocked.push(n);
            if (elig) winForEligibleReal.push(n);
            if (dep) winForDepositor.push(n);
        }
        return {
            winForBots: winForBots,
            winForBlocked: winForBlocked,
            winForEligibleReal: winForEligibleReal,
            winForDepositor: winForDepositor
        };
    }

    function restrictedHits(sequence, isRestricted) {
        const blocked = [];
        const fourCorner = [];
        const list = sequence || [];
        const pred = typeof isRestricted === 'function' ? isRestricted : function () { return false; };
        for (let i = 0; i < list.length; i++) {
            const n = Number(list[i]);
            const hits = hitsFor(n);
            if (!hits) continue;
            let blk = false;
            let corner = false;
            for (let h = 0; h < hits.length; h++) {
                const line = hits[h];
                if (!line || line.dead || line.card.dead || line.card.complete) continue;
                const player = line.player;
                if (!player || player.isBot || !pred(player)) continue;
                blk = true;
                if (line.isCorner) corner = true;
            }
            if (blk) blocked.push(n);
            if (corner) fourCorner.push(n);
        }
        return { blocked: blocked, fourCorner: fourCorner };
    }

    function replaceCardLines(card, grid) {
        const previous = card.lines;
        for (let i = 0; i < previous.length; i++) {
            previous[i].dead = true;
            unlinkBotLine(previous[i]);
            detachLine(previous[i]);
        }
        if (card.complete) {
            card.complete = false;
            index.completeCount = Math.max(0, index.completeCount - 1);
        }
        card.lines = [];
        card.firstBirth = card.player && card.player.isBot ? new Uint16Array(76) : null;
        card.walk = walkNumbers(grid);
        index.gridWalks += 1;
        const cells = bingoCells(grid);
        for (let i = 0; i < cells.length; i++) {
            const nums = cellNumbers(cells[i]);
            if (nums.length < 2) continue;
            const line = {
                idx: lines.length,
                card: card,
                player: card.player,
                ticket: card.ticket,
                lineIndex: i,
                isCorner: i === 12,
                nums: nums,
                miss: [],
                missCount: 0,
                m0: 0,
                m1: 0,
                m2: 0,
                dead: false,
                completingOn: 0,
                completeSlot: -1,
                trieNode: null,
                trieSlot: -1
            };
            restoreLine(line);
            lines.push(line);
            card.lines.push(line);
            if (card.player && card.player.isBot && card.firstBirth) {
                const birth = line.idx + 1;
                for (let k = 0; k < nums.length; k++) {
                    const num = nums[k];
                    if (!card.firstBirth[num] || birth < card.firstBirth[num]) card.firstBirth[num] = birth;
                }
            }
            for (let k = 0; k < nums.length; k++) {
                byNumber[nums[k]].push(line);
                if (card.player && card.player.isBot) botLinesByNumber[nums[k]].push(line);
                else humanLinesByNumber[nums[k]].push(line);
            }
        }
        const called = index.calledList;
        for (let i = 0; i < card.lines.length; i++) {
            const line = card.lines[i];
            for (let c = 0; c < called.length; c++) {
                const n = called[c];
                if (!hasBit(line, n)) continue;
                stripNumber(line, n);
            }
        }
        for (let i = 0; i < card.lines.length; i++) {
            if (card.complete) break;
            attachFresh(card.lines[i]);
        }
        for (let i = 0; i < card.lines.length; i++) refreshBotLine(card.lines[i]);
    }

    index.noteCalled = noteCalled;
    index.syncCalled = syncCalled;
    index.hasComplete = function () { return index.completeCount > 0; };
    index.completeCards = function () {
        const out = [];
        for (let i = 0; i < cards.length; i++) {
            if (cards[i].complete && !cards[i].dead) out.push(cards[i]);
        }
        return out;
    };
    index.enumerateLines = enumerateLines;
    index.oneAwayNumbers = oneAwayNumbers;
    index.bestFinisherBall = bestFinisherBall;
    index.soloFinisherBall = soloFinisherBall;
    index.freshCompletingTickets = freshCompletingTickets;
    index.freshGroupCounts = freshGroupCounts;
    index.botLinesTouching = function (n) {
        const num = Number(n);
        if (!Number.isInteger(num) || num < 1 || num > 75) return [];
        return botLinesByNumber[num];
    };
    index.uncalledNumbers = uncalledNumbers;
    index.classifyPools = classifyPools;
    index.restrictedHits = restrictedHits;
    index.linesTouching = function (n) {
        const num = Number(n);
        if (!Number.isInteger(num) || num < 1 || num > 75) return [];
        return byNumber[num];
    };
    index.markPlayers = markPlayers;
    index.isMarked = function (line) {
        return !!(line && line.card && line.card.mark === index.mark && !line.dead && !line.card.dead);
    };
    index.rebuildTicket = function (ticket) {
        const card = byTicketRef.get(ticket);
        if (!card || card.dead) return false;
        replaceCardLines(card, ticket && ticket.grid);
        return true;
    };
    index.calledSnapshot = function () { return index.calledList.slice(); };
    index.leavesOneAway = function (n) {
        const num = Number(n);
        if (!Number.isInteger(num) || num < 1 || num > 75) return false;
        return index.approachCount[num] > 0;
    };
    return index;
}

/**
 * One warmup pass over calls 1–10. Marks every number that sits on a short
 * line, records one scattered trajectory that does not leave a card one
 * number away, then puts the index back to the called list it had on entry.
 * Card grids are not walked.
 */
function mapEarlyDrawTrajectories(index) {
    if (!index || !index.lines || typeof index.noteCalled !== 'function') return index;
    const snapshot = index.calledSnapshot();
    const walks = index.gridWalks;
    const drawWalks = index.drawGridWalks;
    if (snapshot.length) index.syncCalled([]);

    const earlyRisk = new Uint8Array(76);
    const earlyHorizon = new Uint8Array(76);
    for (let n = 1; n <= 75; n++) earlyHorizon[n] = 99;
    const lines = index.lines;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line || line.dead) continue;
        const length = line.nums.length;
        if (length < 2 || length > 8) continue;
        for (let k = 0; k < line.nums.length; k++) {
            const n = line.nums[k];
            if (n < 1 || n > 75) continue;
            earlyRisk[n] = 1;
            if (length < earlyHorizon[n]) earlyHorizon[n] = length;
        }
    }

    const earlyOneAwayByCall = [];
    const earlyTrajectory = [];
    const pool = [];
    for (let n = 1; n <= 75; n++) pool.push(n);
    for (let step = 0; step < 10; step++) {
        const oneAway = [];
        for (let n = 1; n <= 75; n++) {
            const bucket = index.completing[n];
            if (bucket && bucket.length) oneAway.push(n);
        }
        earlyOneAwayByCall.push(oneAway);
        let best = null;
        let bestHorizon = -1;
        for (let i = 0; i < pool.length; i++) {
            const n = pool[i];
            const bucket = index.completing[n];
            if (bucket && bucket.length) continue;
            if (index.leavesOneAway && index.leavesOneAway(n)) continue;
            const horizon = earlyHorizon[n] || 99;
            if (horizon > bestHorizon) {
                bestHorizon = horizon;
                best = n;
            }
        }
        if (best == null) {
            for (let i = 0; i < pool.length; i++) {
                const n = pool[i];
                const bucket = index.completing[n];
                if (bucket && bucket.length) continue;
                best = n;
                break;
            }
        }
        if (best == null && pool.length) best = pool[0];
        if (best == null) break;
        earlyTrajectory.push(best);
        index.noteCalled(best);
        const at = pool.indexOf(best);
        if (at >= 0) pool.splice(at, 1);
    }

    index.syncCalled(snapshot);
    index.gridWalks = walks;
    index.drawGridWalks = drawWalks;
    index.earlyRisk = earlyRisk;
    index.earlyHorizon = earlyHorizon;
    index.earlyTrajectory = earlyTrajectory;
    index.earlyOneAwayByCall = earlyOneAwayByCall;
    return index;
}

module.exports = {
    buildRoundLineIndex: buildRoundLineIndex,
    mapEarlyDrawTrajectories: mapEarlyDrawTrajectories
};
