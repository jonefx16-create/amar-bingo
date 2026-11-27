'use strict';

/**
 * Bot win controller.
 * One place for the solo-win quota, the vault-safe winner plan, and the
 * split-size rank used by the draw. The live loop asks this module who the
 * round is for; it does not keep a second copy of that decision.
 */

const SOLO_WIN_WINDOW = 10;
// 3 solo bot wins in every 10 completed games (30%). 4 made the solo land too early.
const SOLO_WIN_QUOTA = 3;
const MAX_SPLIT_WINNERS = 5;

function clampSoloBotPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 15;
    if (n <= 0) return 0;
    if (n >= 100) return 100;
    return n;
}

function normalizeSoloChance(percent) {
    const n = Number(percent);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n >= 100) return 1;
    return n / 100;
}

/**
 * Higher is a better bot-only close.
 * A group of 2 to 5 is paid in full, so the largest of those wins.
 * A ball that finishes 6 or more leaves an unpaid card, so it ranks under
 * every in-cap group and loses to a smaller group that fits the cap.
 * A single bot is a solo, used only when no group is ready.
 */
function splitRank(count) {
    const n = Number(count) || 0;
    if (n >= 2 && n <= MAX_SPLIT_WINNERS) return 100 + n;
    if (n > MAX_SPLIT_WINNERS) return 50 - (n - MAX_SPLIT_WINNERS);
    if (n === 1) return 1;
    return 0;
}

/**
 * Last-resort ball. A four-corner call is not a bingo, and swapping it out
 * afterwards skips the five-line number that should have been drawn.
 * Prefer any other number in the pool. A corner is returned only when the
 * pool has nothing else.
 */
function callableEmergencyNumber(pool, corners) {
    const list = pool || [];
    const cornerSet = new Set((corners || []).map((n) => Number(n)));
    for (let i = 0; i < list.length; i++) {
        const n = Number(list[i]);
        if (!cornerSet.has(n)) return n;
    }
    return list.length ? Number(list[0]) : null;
}

function isBotSoloWin(winners) {
    if (!Array.isArray(winners) || winners.length !== 1) return false;
    const player = winners[0] && winners[0].player;
    return !!(player && player.isBot);
}

function createBotWinController() {
    let played = 0;
    let soloWins = 0;
    let carried = 0;
    let history = [];
    let lastBlock = null;

    function need() {
        return SOLO_WIN_QUOTA + carried;
    }

    function mustSoloNow() {
        const left = SOLO_WIN_WINDOW - played;
        if (left <= 0) return false;
        const deficit = need() - soloWins;
        if (deficit <= 0) return false;
        if (deficit >= left) return true;
        const ideal = Math.ceil(((played + 1) * need()) / SOLO_WIN_WINDOW);
        return soloWins < Math.min(played + 1, ideal);
    }

    function soloChance(percent) {
        const configured = normalizeSoloChance(percent);
        if (mustSoloNow()) return 1;
        const deficit = need() - soloWins;
        const left = SOLO_WIN_WINDOW - played;
        if (deficit <= 0 || left <= 0) return configured;
        return Math.max(configured, deficit / left);
    }

    function snapshot() {
        return {
            played: played,
            soloWins: soloWins,
            carried: carried,
            window: SOLO_WIN_WINDOW,
            quota: SOLO_WIN_QUOTA,
            history: history.slice(),
            lastBlock: lastBlock
        };
    }

    function recordCompletedGame(winnersOrFlag) {
        let botSolo = false;
        if (typeof winnersOrFlag === 'boolean') botSolo = winnersOrFlag;
        else if (winnersOrFlag && Object.prototype.hasOwnProperty.call(winnersOrFlag, 'botSolo')) botSolo = !!winnersOrFlag.botSolo;
        else botSolo = isBotSoloWin(winnersOrFlag);
        played += 1;
        if (botSolo) soloWins += 1;
        history.push(botSolo);
        if (played < SOLO_WIN_WINDOW) {
            return {
                botSolo: botSolo,
                closed: false,
                played: played,
                soloWins: soloWins,
                carried: carried,
                met: soloWins >= need()
            };
        }
        const required = need();
        const short = Math.max(0, required - soloWins);
        const block = {
            botSolo: botSolo,
            closed: true,
            played: played,
            soloWins: soloWins,
            required: required,
            met: soloWins >= required,
            history: history.slice()
        };
        carried = Math.min(SOLO_WIN_QUOTA, short);
        played = 0;
        soloWins = 0;
        history = [];
        lastBlock = block;
        return Object.assign({ carried: carried }, block);
    }

    return {
        mustSoloNow: mustSoloNow,
        soloChance: soloChance,
        snapshot: snapshot,
        recordCompletedGame: recordCompletedGame
    };
}

/**
 * The vault plan previously inlined in the draw loop.
 * A covered depositor vault can aim at that depositor. A pool that cannot
 * fund the pot, even after a 2-to-5 split, stays on bots so the round does
 * not open a deficit. Decoy rounds are bots and pay nothing.
 */
function planVaultForce(ctx) {
    ctx = ctx || {};
    const rng = typeof ctx.rng === 'function' ? ctx.rng : Math.random;
    const hiddenPool = Number(ctx.virtualPrizePool) || 0;
    const vaultTwo = Number(ctx.vaultTwoBalance) || 0;
    const vaultThree = Number(ctx.vaultThreeBalance) || 0;
    const finalTotalPrize = Number(ctx.finalTotalPrize) || 0;
    const decoyChance = ctx.decoyChance != null ? Number(ctx.decoyChance) : 0.15;
    const depositorCount = Number(ctx.depositorCount) || 0;
    const eligibleBonusCount = Number(ctx.eligibleBonusCount) || 0;
    let mixBotCount = ctx.mixBotCount == null ? 1 : Number(ctx.mixBotCount);

    if (rng() < decoyChance) {
        return { forceWinner: 'bots', mixBotCount: mixBotCount, vaultSafe: true, reason: 'decoy' };
    }
    const maxSafePayout = hiddenPool * 0.20;
    if (vaultTwo >= finalTotalPrize && depositorCount > 0) {
        return { forceWinner: 'mix_dep', mixBotCount: 0, vaultSafe: true, reason: 'vault-two' };
    }
    if (vaultThree >= (finalTotalPrize / 2) && depositorCount > 0) {
        return { forceWinner: 'mix_dep', mixBotCount: 1, vaultSafe: true, reason: 'vault-three' };
    }
    if (hiddenPool >= finalTotalPrize && finalTotalPrize <= maxSafePayout) {
        const forceWinner = eligibleBonusCount > 0 ? 'real' : (depositorCount > 0 ? 'mix_dep' : 'bots');
        return { forceWinner: forceWinner, mixBotCount: 0, vaultSafe: true, reason: 'pool' };
    }
    const targetPayout = (hiddenPool >= finalTotalPrize) ? maxSafePayout : Math.max(hiddenPool, 1);
    let neededSplits = Math.ceil(finalTotalPrize / targetPayout);
    if (neededSplits > MAX_SPLIT_WINNERS) neededSplits = MAX_SPLIT_WINNERS;
    if (neededSplits < 2) neededSplits = 2;
    if (hiddenPool < (finalTotalPrize / neededSplits) || hiddenPool <= 0) {
        return { forceWinner: 'bots', mixBotCount: mixBotCount, vaultSafe: true, reason: 'underfunded' };
    }
    const forceWinner = eligibleBonusCount > 0 ? 'mix' : (depositorCount > 0 ? 'mix_dep' : 'bots');
    return { forceWinner: forceWinner, mixBotCount: neededSplits - 1, vaultSafe: true, reason: 'split' };
}

/**
 * Winner for this draw tick.
 * A scheduled bot solo is taken only when a bot is seated and no human bingo
 * is already locked. That solo pays no real money, so it cannot debit a vault.
 * Skipping a locked human ball, or inventing a bot when none is seated, is refused.
 */
function planRoundWinner(ctx, controller) {
    ctx = ctx || {};
    const quota = controller || createBotWinController();
    const locked = ctx.lockedForce || null;
    let forceWinner = locked || ctx.configuredForce || 'bots';
    let mixBotCount = ctx.mixBotCount == null ? 1 : Number(ctx.mixBotCount);
    if (!locked && forceWinner === 'ai') {
        const vault = planVaultForce(ctx);
        forceWinner = vault.forceWinner;
        mixBotCount = vault.mixBotCount;
    }

    const eligibleRealCount = Number(ctx.eligibleRealCount) || 0;
    const depositorCount = Number(ctx.depositorCount) || 0;
    const botCount = Number(ctx.botCount) || 0;
    if (eligibleRealCount === 0) forceWinner = 'bots';
    if (botCount === 0 && (forceWinner === 'mix' || forceWinner === 'mix_dep')) forceWinner = 'real';
    if (depositorCount === 0 && forceWinner === 'mix_dep') {
        forceWinner = eligibleRealCount > 0 ? 'real' : 'bots';
    }

    const humanLocked = !!ctx.humanLocked;
    const must = quota.mustSoloNow();
    let quotaForced = false;
    let soloBotChance = quota.soloChance(ctx.soloBotWinPercent);
    if (must && botCount > 0 && !humanLocked) {
        forceWinner = 'bots';
        soloBotChance = 1;
        quotaForced = true;
    }

    return {
        forceWinner: forceWinner,
        mixBotCount: mixBotCount,
        soloBotChance: soloBotChance,
        quotaForced: quotaForced,
        mustSolo: must,
        humanLocked: humanLocked,
        vaultSafe: true,
        window: quota.snapshot()
    };
}

const EXTRA_MALE_ETH_BOT_NAMES = require('./ethMaleNames');
const MALE_ETH_BOT_NAMES = ["Abebe", "Kebede", "Chala", "Hagos", "Dawit", "Yosef", "Ephrem", "Tesfaye", "Girma", "Bereket", "Abel", "Eyob", "Samuel", "Biniam", "Mulugeta", "Tewodros", "Lema", "Yonas", "Habtamu", "Surafel", "Natnael", "Nahom", "Kaleb", "Fasika", "Amanuel", "Henok", "Robel", "Mikias", "Abiy", "Bekele", "Zelalem", "Elias", "Daniel", "Ermias", "Tadesse", "Wondimu", "Gizachew", "Tamirat", "Mekonnen", "Getachew"].concat(EXTRA_MALE_ETH_BOT_NAMES);

function botNameKey(name) {
    return String(name || '').trim().toLowerCase();
}

function botNameEndsWithNumber(name) {
    return /[0-9]$/.test(String(name || '').trim());
}

/**
 * Bot users shown in the admin list and seated in a round.
 * A name that ends with a number stays in the database and is left out here.
 */
function selectVisibleBotUsers(bots) {
    const out = [];
    const list = bots || [];
    for (let i = 0; i < list.length; i++) {
        const bot = list[i];
        if (!bot || botNameEndsWithNumber(bot.name)) continue;
        out.push(bot);
    }
    return out;
}

/**
 * A player account has a login or a wallet. A bot record does not.
 * Rename must never treat one of these as a bot.
 */
function isRealPlayerAccount(record) {
    if (!record) return false;
    if (record.password != null && record.password !== '') return true;
    if (record.status != null && record.status !== '') return true;
    if (record.mainBalance != null || record.playBalance != null) return true;
    if (record.telegramId != null && record.telegramId !== '') return true;
    return false;
}

/**
 * Bots whose names may be regenerated.
 * Active bots stay as they are. Real player accounts are dropped even if
 * they were mixed into the same list.
 */
function selectInactiveBotsForRename(records) {
    const out = [];
    const list = records || [];
    for (let i = 0; i < list.length; i++) {
        const bot = list[i];
        if (!bot || bot.isActive !== false || isRealPlayerAccount(bot)) continue;
        out.push(bot);
    }
    return out;
}

/**
 * Bot records the admin list can rename.
 * Active and disabled bots are both included. A real player account is not.
 */
function selectBotsForRename(records) {
    const out = [];
    const list = records || [];
    for (let i = 0; i < list.length; i++) {
        const bot = list[i];
        if (!bot || isRealPlayerAccount(bot)) continue;
        if (!String(bot.name || '').trim()) continue;
        out.push(bot);
    }
    return out;
}

const INACTIVE_PLAYER_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

function playerStatusValue(status) {
    return String(status == null ? '' : status).trim().toLowerCase();
}

/**
 * Banned, deleted, and other blocked accounts never donate a bot name.
 */
function isBlockedNameSource(status) {
    const value = playerStatusValue(status);
    return value === 'banned' || value === 'deleted' || value === 'disabled' || value === 'suspended' || value === 'blocked';
}

/**
 * An account explicitly marked inactive or idle.
 * A missing status is not inactive. Banned is not inactive.
 */
function isInactivePlayerStatus(status) {
    const value = playerStatusValue(status);
    return value === 'inactive' || value === 'idle';
}

/**
 * A real player who has been quiet for a long time, or whose status is inactive or idle.
 * Banned and deleted accounts are refused even when their last visit is old.
 * An active account qualifies only after INACTIVE_PLAYER_IDLE_MS with no activity.
 */
function isIdlePlayerAccount(user, now) {
    if (!user || isBlockedNameSource(user.status)) return false;
    if (isInactivePlayerStatus(user.status)) return true;
    const status = playerStatusValue(user.status);
    if (status && status !== 'active') return false;
    const at = user.lastActive == null || user.lastActive === '' ? NaN : new Date(user.lastActive).getTime();
    if (!Number.isFinite(at)) return false;
    const clock = now == null ? Date.now() : (now instanceof Date ? now.getTime() : Number(now));
    if (!Number.isFinite(clock)) return false;
    return clock - at >= INACTIVE_PLAYER_IDLE_MS;
}

/**
 * Names worth copying onto a bot. Digits and placeholder names stay out.
 */
function usableInactiveUserName(name) {
    const cleaned = String(name || '').trim();
    if (cleaned.length <= 2) return false;
    if (/\d/.test(cleaned)) return false;
    if (cleaned.toLowerCase().indexOf('user') !== -1) return false;
    if (botNameEndsWithNumber(cleaned)) return false;
    return true;
}

/**
 * Names taken from idle player accounts only.
 * Banned, deleted, disabled, and recently active accounts are dropped.
 * The accounts themselves are not modified.
 */
function collectInactiveUserNames(users, now) {
    const seen = new Set();
    const out = [];
    const list = users || [];
    for (let i = 0; i < list.length; i++) {
        const user = list[i];
        if (!isIdlePlayerAccount(user, now)) continue;
        const name = String(user.name || '').trim();
        if (!usableInactiveUserName(name)) continue;
        const key = botNameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

/**
 * A replacement is valid only when it is one of `pool`, or that name plus
 * a short hyphen or dot suffix. Active-user names are not in the pool.
 */
function nameComesFromBotList(name, pool) {
    const cleaned = String(name || '').trim();
    if (!cleaned || botNameEndsWithNumber(cleaned)) return false;
    const source = pool && pool.length ? pool : MALE_ETH_BOT_NAMES;
    const exact = botNameKey(cleaned);
    for (let i = 0; i < source.length; i++) {
        if (botNameKey(String(source[i] || '').trim()) === exact) return true;
    }
    const marked = cleaned.match(/^(.*)[-.]([a-z]{1,2})$/);
    if (!marked) return false;
    const stem = botNameKey(marked[1]);
    if (!stem) return false;
    for (let i = 0; i < source.length; i++) {
        if (botNameKey(String(source[i] || '').trim()) === stem) return true;
    }
    return false;
}

/**
 * New names for inactive bots.
 * With `exclusivePool`, an empty pool renames nobody. That is how the
 * admin rename uses inactive-user names without falling back to anyone else.
 */
function planInactiveBotRenames(records, options) {
    const opts = options || {};
    const exclusive = opts.exclusivePool === true;
    const supplied = opts.pool && opts.pool.length ? opts.pool : null;
    const pool = supplied || (exclusive ? [] : MALE_ETH_BOT_NAMES);
    if (!pool.length) return [];
    let targets = opts.includeActive === true
        ? selectBotsForRename(records)
        : selectInactiveBotsForRename(records);
    const limit = Math.max(0, Math.floor(Number(opts.limit) || 0));
    if (limit > 0) targets = targets.slice(0, limit);
    const held = (opts.reserved || []).slice();
    for (let i = 0; i < targets.length; i++) held.push(targets[i].name);
    const names = generateUniqueBotNames(targets.length, held, pool, {
        keepPoolNames: exclusive || opts.keepPoolNames === true
    });
    const taken = new Set();
    for (let i = 0; i < held.length; i++) {
        const key = botNameKey(held[i]);
        if (key) taken.add(key);
    }
    const updates = [];
    let cursor = 0;
    for (let i = 0; i < names.length && cursor < targets.length; i++) {
        const key = botNameKey(names[i]);
        if (!key || taken.has(key) || !nameComesFromBotList(names[i], pool)) continue;
        taken.add(key);
        updates.push({ _id: targets[cursor]._id, name: names[i] });
        cursor += 1;
    }
    return updates;
}

/**
 * One inactive-user name per bot.
 * Names are copied exactly from `pool`. A name already used by a bot that
 * is not in this batch stays reserved. Nothing is invented with a hyphen
 * or dot suffix, so the same name is never given to a second bot.
 * Bots left over when the pool runs out are counted in `skipped`.
 */
const BOT_USERNAME_STYLE_SHARE = 0.1;

function enabledBotNameStyles(options) {
    const opts = options || {};
    const styles = [];
    if (opts.at === true || opts.styleAt === true) styles.push('at');
    if (opts.caps === true || opts.styleCaps === true) styles.push('caps');
    if (opts.hyphen === true || opts.styleHyphen === true) styles.push('hyphen');
    return styles;
}

/**
 * One decorative form of an inactive-user name.
 * The letters still come from that name. A style that does not change
 * the name, or that would end in a digit, is rejected.
 */
function styleBotUsername(name, style) {
    const base = String(name || '').trim();
    if (!base) return '';
    if (style === 'at') {
        if (base.charAt(0) === '@') return '';
        return '@' + base.replace(/^@+/, '');
    }
    if (style === 'caps') {
        const upper = base.toUpperCase();
        return upper === base ? '' : upper;
    }
    if (style === 'hyphen') {
        const core = base.replace(/^@+/, '');
        if (!core || core.indexOf('-') !== -1 || core.length < 4) return '';
        const cut = Math.ceil(core.length / 2);
        if (cut < 2 || cut >= core.length) return '';
        return core.slice(0, cut) + '-' + core.slice(cut);
    }
    return '';
}

/**
 * The inactive-user name under a styled bot username, with a leading @ removed.
 * ALL CAPS still matches that name through botNameKey. A hyphen we inserted
 * is checked separately by styledNameUsesPool so a pool name that already
 * contains a hyphen is not rewritten.
 */
function botUsernameStyleBase(name) {
    let value = String(name || '').trim();
    if (value.charAt(0) === '@') value = value.slice(1).trim();
    return value;
}

function styledNameUsesPool(name, pool) {
    const keys = pool instanceof Set ? pool : new Set();
    if (!(pool instanceof Set)) {
        const source = pool || [];
        for (let i = 0; i < source.length; i++) {
            const key = botNameKey(source[i]);
            if (key) keys.add(key);
        }
    }
    const base = botUsernameStyleBase(name);
    if (keys.has(botNameKey(base))) return true;
    const hyphen = base.indexOf('-');
    if (hyphen > 1 && hyphen === base.lastIndexOf('-') && hyphen < base.length - 1) {
        const joined = base.slice(0, hyphen) + base.slice(hyphen + 1);
        if (keys.has(botNameKey(joined))) return true;
    }
    return false;
}

/**
 * About 10% of a finished unique rename picks up one enabled style.
 * Styles that are off are not used. A styled name that collides with a
 * reserved or sibling name is left plain. Real player records are not
 * in `updates`, and this function does not read or write them.
 */
function applyBotUsernameStyles(updates, options) {
    const list = Array.isArray(updates) ? updates : [];
    const styles = enabledBotNameStyles(options);
    if (!styles.length || !list.length) return { updates: list, styled: 0 };
    const rng = (options && typeof options.rng === 'function') ? options.rng : Math.random;
    const reservedKeys = new Set();
    const reserved = (options && options.reserved) || [];
    for (let i = 0; i < reserved.length; i++) {
        const key = botNameKey(reserved[i]);
        if (key) reservedKeys.add(key);
    }
    const used = new Set(reservedKeys);
    for (let i = 0; i < list.length; i++) {
        const key = botNameKey(list[i] && list[i].name);
        if (key) used.add(key);
    }
    const want = Math.round(list.length * BOT_USERNAME_STYLE_SHARE);
    const order = [];
    for (let i = 0; i < list.length; i++) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        const swap = order[i];
        order[i] = order[j];
        order[j] = swap;
    }
    let styled = 0;
    let cursor = 0;
    for (let n = 0; n < order.length && styled < want; n++) {
        const row = list[order[n]];
        if (!row) continue;
        const original = String(row.name || '').trim();
        const oldKey = botNameKey(original);
        let applied = '';
        for (let attempt = 0; attempt < styles.length; attempt++) {
            const style = styles[(cursor + attempt) % styles.length];
            const next = styleBotUsername(original, style);
            if (!next || next === original || botNameEndsWithNumber(next)) continue;
            const key = botNameKey(next);
            if (!key) continue;
            if (key !== oldKey && used.has(key)) continue;
            if (key !== oldKey && !reservedKeys.has(oldKey)) used.delete(oldKey);
            used.add(key);
            row.name = next;
            row.nameStyle = style;
            applied = style;
            break;
        }
        cursor += 1;
        if (applied) styled += 1;
    }
    return { updates: list, styled: styled };
}

function planUniqueInactiveRenames(targets, options) {
    const opts = options || {};
    const list = selectBotsForRename(targets);
    const used = new Set();
    const held = opts.reserved || [];
    for (let i = 0; i < held.length; i++) {
        const key = botNameKey(held[i]);
        if (key) used.add(key);
    }
    const available = [];
    const inPool = new Set();
    const source = opts.pool || [];
    for (let i = 0; i < source.length; i++) {
        const cleaned = String(source[i] || '').trim();
        if (!usableInactiveUserName(cleaned)) continue;
        const key = botNameKey(cleaned);
        if (!key || used.has(key) || inPool.has(key)) continue;
        inPool.add(key);
        available.push(cleaned);
    }
    const keepIds = new Set();
    for (let i = 0; i < list.length; i++) {
        const key = botNameKey(list[i].name);
        if (!key || !inPool.has(key) || used.has(key)) continue;
        used.add(key);
        keepIds.add(String(list[i]._id));
    }
    const updates = [];
    let cursor = 0;
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
        const bot = list[i];
        if (keepIds.has(String(bot._id))) continue;
        while (cursor < available.length && used.has(botNameKey(available[cursor]))) cursor += 1;
        if (cursor >= available.length) {
            skipped += 1;
            continue;
        }
        const name = available[cursor];
        cursor += 1;
        const key = botNameKey(name);
        used.add(key);
        if (botNameKey(bot.name) === key) continue;
        updates.push({ _id: bot._id, name: name });
    }
    return { updates: updates, skipped: skipped };
}

/**
 * Admin username list. Only inactive bots, and each username once.
 */
function selectInactiveBotUsernames(bots) {
    const seen = new Set();
    const out = [];
    const list = bots || [];
    for (let i = 0; i < list.length; i++) {
        const bot = list[i];
        if (!bot || bot.isActive !== false) continue;
        const name = String(bot.name || '').trim();
        const key = botNameKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(bot);
    }
    return out;
}

function stripTrailingCapitals(name) {
    return String(name || '').trim().replace(/[A-Z]+$/, '');
}

const BOT_NAME_MARKS = ['-', '.'];
const BOT_NAME_LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * A mark is only for a given name that is already taken.
 * Neighboring copies use different marks, Abebe-a then Kebede.b,
 * and never a second given name such as Kebede.
 */
function markedBotName(base, copy, salt) {
    const n = Math.floor(Number(copy) || 0);
    const shift = Math.floor(Number(salt) || 0);
    if (n < 0) return '';
    const slot = n + shift;
    const mark = BOT_NAME_MARKS[slot % BOT_NAME_MARKS.length];
    const letter = BOT_NAME_LETTERS.charAt(slot % BOT_NAME_LETTERS.length);
    if (n < BOT_NAME_LETTERS.length) return base + mark + letter;
    const tail = n - BOT_NAME_LETTERS.length;
    if (tail >= BOT_NAME_LETTERS.length) return '';
    return base + mark + letter + BOT_NAME_LETTERS.charAt((tail + shift) % BOT_NAME_LETTERS.length);
}

/**
 * Unique bot usernames drawn from `pool`.
 * Plain given names are used first. A hyphen or dot plus a short suffix
 * is added only when that given name is already taken.
 * A trailing capital such as AbebeA is removed. Names that end with a
 * digit stay excluded so they remain visible to the joiner.
 */
function generateUniqueBotNames(amount, reserved, pool, options) {
    const keepPoolNames = !!(options && options.keepPoolNames);
    const want = Math.max(0, Math.floor(Number(amount) || 0));
    const used = new Set();
    const held = reserved || [];
    for (let i = 0; i < held.length; i++) {
        const key = botNameKey(held[i]);
        if (key) used.add(key);
    }
    const base = [];
    const seenBase = new Set();
    const source = pool && pool.length ? pool : MALE_ETH_BOT_NAMES;
    for (let i = 0; i < source.length; i++) {
        const name = keepPoolNames ? String(source[i] || '').trim() : stripTrailingCapitals(source[i]);
        const key = botNameKey(name);
        if (!key || seenBase.has(key) || botNameEndsWithNumber(name)) continue;
        if (!keepPoolNames && /[A-Z]$/.test(name)) continue;
        seenBase.add(key);
        base.push(name);
    }
    const out = [];
    function push(name) {
        if (out.length >= want) return;
        const cleaned = keepPoolNames ? String(name || '').trim() : stripTrailingCapitals(name);
        if (!cleaned || botNameEndsWithNumber(cleaned)) return;
        if (!keepPoolNames && /[A-Z]$/.test(cleaned)) return;
        const key = botNameKey(cleaned);
        if (!key || used.has(key)) return;
        used.add(key);
        out.push(cleaned);
    }
    for (let i = 0; i < base.length; i++) push(base[i]);
    const copies = [];
    for (let i = 0; i < base.length; i++) copies.push(0);
    let idle = 0;
    while (out.length < want && base.length && idle < 3) {
        let added = false;
        for (let i = 0; i < base.length && out.length < want; i++) {
            const next = markedBotName(base[i], copies[i], i);
            if (!next) continue;
            const before = out.length;
            push(next);
            copies[i] += 1;
            if (out.length > before) added = true;
        }
        idle = added ? 0 : idle + 1;
    }
    return out;
}

function escapeBotSearch(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mongo filter for the admin bot table.
 * Names that end with a digit stay out, and a search matches name or phone.
 */
function botListFilter(search) {
    const visible = { name: { $not: /[0-9]$/ } };
    const term = String(search || '').trim();
    if (!term) return visible;
    const safe = escapeBotSearch(term);
    return {
        $and: [
            visible,
            { $or: [
                { name: { $regex: safe, $options: 'i' } },
                { phone: { $regex: safe, $options: 'i' } }
            ] }
        ]
    };
}

const BOT_LIST_PAGE_SIZE = 50;

/**
 * One page of the admin bot table. The full roster is not rendered at once.
 */
function pageBotList(bots, options) {
    const opts = options || {};
    const page = Math.max(1, Math.floor(Number(opts.page) || 1));
    const limit = Math.min(BOT_LIST_PAGE_SIZE, Math.max(1, Math.floor(Number(opts.limit) || BOT_LIST_PAGE_SIZE)));
    const term = String(opts.search || '').trim().toLowerCase();
    const visible = selectVisibleBotUsers(bots).filter((bot) => {
        if (!term) return true;
        const name = String(bot.name || '').toLowerCase();
        const phone = String(bot.phone || '').toLowerCase();
        return name.indexOf(term) !== -1 || phone.indexOf(term) !== -1;
    });
    const start = (page - 1) * limit;
    return {
        bots: visible.slice(start, start + limit),
        total: visible.length,
        page: page,
        limit: limit
    };
}

/**
 * Usernames still free after `reserved` names are taken.
 * Comparison ignores case and surrounding spaces, so Abebe and abebe collide.
 */
function assignUniqueBotNames(candidates, reserved) {
    const used = new Set();
    const held = reserved || [];
    for (let i = 0; i < held.length; i++) {
        const key = botNameKey(held[i]);
        if (key) used.add(key);
    }
    const out = [];
    const list = candidates || [];
    for (let i = 0; i < list.length; i++) {
        const name = String(list[i] || '').trim();
        const key = botNameKey(name);
        if (!key || used.has(key) || botNameEndsWithNumber(name)) continue;
        used.add(key);
        out.push(name);
    }
    return out;
}

function applyBotMasterSettings(settings, body) {
    if (!settings) return settings;
    const src = body || {};
    settings.isBotSystemActive = src.isBotSystemActive;
    settings.botWinnerForce = src.botWinnerForce;
    settings.botDist1 = src.botDist1;
    settings.botDist2 = src.botDist2;
    settings.botDist3 = src.botDist3;
    settings.botDist4 = src.botDist4;
    if (src.soloBotWinPercent !== undefined) {
        settings.soloBotWinPercent = clampSoloBotPercent(src.soloBotWinPercent);
    }
    return settings;
}

module.exports = {
    SOLO_WIN_WINDOW,
    SOLO_WIN_QUOTA,
    MAX_SPLIT_WINNERS,
    clampSoloBotPercent,
    normalizeSoloChance,
    splitRank,
    callableEmergencyNumber,
    isBotSoloWin,
    createBotWinController,
    planVaultForce,
    planRoundWinner,
    applyBotMasterSettings,
    MALE_ETH_BOT_NAMES,
    botNameKey,
    botNameEndsWithNumber,
    generateUniqueBotNames,
    botListFilter,
    pageBotList,
    BOT_LIST_PAGE_SIZE,
    selectVisibleBotUsers,
    selectInactiveBotUsernames,
    isRealPlayerAccount,
    selectInactiveBotsForRename,
    selectBotsForRename,
    INACTIVE_PLAYER_IDLE_MS,
    isBlockedNameSource,
    isInactivePlayerStatus,
    isIdlePlayerAccount,
    collectInactiveUserNames,
    nameComesFromBotList,
    planInactiveBotRenames,
    planUniqueInactiveRenames,
    assignUniqueBotNames,
    BOT_USERNAME_STYLE_SHARE,
    enabledBotNameStyles,
    styleBotUsername,
    botUsernameStyleBase,
    styledNameUsesPool,
    applyBotUsernameStyles
};
