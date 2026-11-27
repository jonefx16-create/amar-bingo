const  express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const fs = require('fs');
const { Server } = require('socket.io');
const TelegramBot = require('node-telegram-bot-api');
const { buildAdminUserSearchQuery } = require('./adminUserSearch');
const { normalizePhone, gameHistoryQuery, stripUserFromGame } = require('./adminDeleteUser');
const claimBroadcast = require('./claimBroadcast');
const cooldownManager = require('./cooldownManager');
const adminLiveView = require('./adminLiveView'); 

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
// ሀከሮች የትኛውን ቴክኖሎጂ እንደምትጠቀም እንዳያውቁ ይደብቃል
app.disable('x-powered-by');    

// 🔴 RENDER LOGGING - እያንዳንዱን የዌብሳይት እና የጌም እንቅስቃሴ ሪከርድ ያደርጋል
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        
        // 🔥 የድምፅ ፋይሎችን (.mp3, .wav) ሎግ ላይ እንዳያወጣ እና እንዳያጨናንቅ የሚያግድ (Ignore Sounds)
        if (req.originalUrl.includes('.mp3') || req.originalUrl.includes('.wav') || req.originalUrl.includes('sound')) {
            return; // ድምፅ ከሆነ ሎግ ላይ አታውጣው (ዝለለው)
        }

        // ከ 500ms በላይ ከፈጀ ቀይ (ማስጠንቀቂያ) ያሳያል
        if(duration > 500) {
            console.log(`⚠️ [SLOW API] ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | IP: ${req.ip} | Time: ${duration}ms`);
        } else {
            console.log(`✅ [INFO] ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | IP: ${req.ip} | Time: ${duration}ms`);
        }
    });
    next();
});

// 🔥 SECURITY: Basic Rate Limiting for Registration Spam    

// 🔥 SECURITY: Basic Rate Limiting for Registration Spam
const registerRateLimiter = new Map();

const io = new Server(server, { 
    cors: { origin: "*" },
    perMessageDeflate: { threshold: 1024 } 
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// ==========================================
// 🔵 DATABASE CONNECTION (ULTIMATE FIX)
// ==========================================
// Amar Bingo cluster. Set MONGODB_PASSWORD in the host environment (Render) before deploying.
const dbUser = "amarmeftuh971_db_user";
const dbPass = encodeURIComponent(process.env.MONGODB_PASSWORD || "Jo97BJbi3208"); // ፓስወርዱን በራሱ አስተካክሎ እንዲያነብ ያደርገዋል
const dbName = "amarBingo";
const dbCluster = "cluster0.ktvuu20.mongodb.net";

const mongoURI = `mongodb+srv://${dbUser}:${dbPass}@${dbCluster}/${dbName}?retryWrites=true&w=majority`;

mongoose.connect(mongoURI, { 
    autoIndex: true, 
    maxPoolSize: 50 
}).then(() => console.log("✅ Database Connected Successfully"))
  .catch(err => console.log("❌ DB Connection Error:", err.message));

// ==========================================
// 🔵 MODELS
// ==========================================
const User = mongoose.model('User', new mongoose.Schema({
    phone: { type: String, required: true, unique: true, index: true },
    refCode: { type: String, default: "", index: true }, 
    telegramId: { type: String, default: "", index: true }, 
    name: { type: String, index: true },
    firstName: { type: String, default: "" },
    telegramUsername: { type: String, default: "", index: true },
    password: { type: String, required: true },
    referredBy: { type: String, default: "", index: true },
    totalInvites: { type: Number, default: 0 },
    referralDayKey: { type: String, default: "" },
    referralDayCount: { type: Number, default: 0 }, 
    inviteBonusEarned: { type: Number, default: 0 },
    mainBalance: { type: Number, default: 0 }, 
    playBalance: { type: Number, default: 0 }, 
    unplayedRealDeposit: { type: Number, default: 0 }, 
    played: { type: Number, default: 0 }, 
    won: { type: Number, default: 0 },
    totalWon: { type: Number, default: 0 },
    wonRecordSynced: { type: Boolean, default: false },
    periodTickets: { type: Number, default: 0 },
    ticketCycleReady: { type: Boolean, default: false },
    periodWon: { type: Number, default: 0 },
    periodWonReady: { type: Boolean, default: false },
    weeklyRankOverride: { type: Number, default: null },
    seasonCardsPlayed: { type: Number, default: 0 },
    seasonId: { type: String, default: '' },
    eatDayKey: { type: String, default: "" },
    depositTodayEtb: { type: Number, default: 0 },
    dailyRealBets: { type: Number, default: 0 },
    dailyWins: { type: Number, default: 0 },
    roundsTodayWithoutWin: { type: Number, default: 0 },
    winsToday: { type: Number, default: 0 },
    totalDeposited: { type: Number, default: 0 }, 
    totalWithdrawn: { type: Number, default: 0 }, 
    totalTicketsBought: { type: Number, default: 0 }, 
    status: { type: String, default: 'active', index: true },
    language: { type: String, default: 'am' },
    isPromoter: { type: Boolean, default: false, index: true },
    promoterPercent: { type: Number, default: 10 },
    promoterEarned: { type: Number, default: 0 },
    promoterUnpaidBalance: { type: Number, default: 0 }, 
    hasMadeFirstDeposit: { type: Boolean, default: false }, 
    promoterCommissionGenerated: { type: Number, default: 0 },
    referredViaPromo: { type: Boolean, default: false }, 
    compensatedInvites: { type: Number, default: 0 },
    diagnosticFraudReported: { type: Boolean, default: false },
    diagnosticNegativeReported: { type: Boolean, default: false },
    contactVerified: { type: Boolean, default: false },
    verificationStatus: { type: String, default: 'pending' },
    lastActive: { type: Date, default: Date.now }
}));

const { BotUser, initBotDatabase } = require('./bots/bot.model');
const gameEngine = require('./game');
const birrBalance = require('./game/birrBalance');
const contactGuard = require('./contactGuard');
initBotDatabase();

const Transaction = mongoose.model('Transaction', new mongoose.Schema({
    phone: { type: String, index: true }, 
    type: { type: String, index: true }, 
    amount: Number, 
    bonusGiven: { type: Number, default: 0 }, 
    method: String, 
    status: { type: String, default: 'Pending', index: true }, 
    date: { type: Date, default: Date.now, index: true }, 
    smsText: {type: String, default: ""},
    description: { type: String, default: "" },
    txRef: { type: String, default: "", index: true },
    hiddenFromAdmin: { type: Boolean, default: false },
    birrFloatDeducted: { type: Boolean, default: false }
}));
// የተጠቀሙባቸውን ደረሰኞች (TxRef) ብቻ ለዘላለም የሚይዝ ማህደር
const TxArchive = mongoose.model('TxArchive', new mongoose.Schema({
    txRef: { type: String, unique: true, index: true }
}));

const BankSMS = mongoose.model('BankSMS', new mongoose.Schema({
    rawText: String, 
    txRef: { type: String, index: true }, 
    amount: Number, 
    isUsed: { type: Boolean, default: false, index: true }, 
    dateReceived: { type: Date, default: Date.now }
}));

const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({
    gameId: { type: Number, index: true }, 
    roundId: { type: Number, index: true },
    ticketId: String, 
    winnerName: String, 
    winnerPhone: { type: String, index: true }, 
    winnerId: { type: String, index: true },
    winnerPhoneList: { type: [String], default: [] },
    winnerPayout: { type: Number, default: 0 },
    participantPhones: { type: [String], default: [], index: true },
    prize: Number,
    adminProfit: { type: Number, default: 0 }, 
    ticketPrice: Number, 
    winningGrid: Array, 
    calledNumbers: Array, 
    playersData: Array, 
    date: { type: Date, default: Date.now, index: true },
    createdAt: { type: Date, default: Date.now, index: true }
}));

const ActiveBonus = mongoose.model('ActiveBonus', new mongoose.Schema({
    amount: Number, 
    maxUsers: Number, 
    currentClaims: { type: Number, default: 0 }, 
    claimedBy: [String], 
    expiresAt: Date, 
    isActive: { type: Boolean, default: true }, 
    date: { type: Date, default: Date.now },
    depositorsOnly: { type: Boolean, default: false },
    minDepositAmount: { type: Number, default: 0 },
    requireDepositWithinHours: { type: Number, default: 0 }
}));

const PromoCode = mongoose.model('PromoCode', new mongoose.Schema({
    code: { type: String, unique: true, index: true },
    amount: Number,
    maxUses: Number,
    currentUses: { type: Number, default: 0 },
    expiresAt: { type: Date, default: () => Date.now() + 30*24*60*60*1000 }, 
    usedBy: [String],
    requireDeposit: { type: Boolean, default: false }, 
    minDepositAmount: { type: Number, default: 0 },
    requireDepositWithinHours: { type: Number, default: 0 } 
}));

const SystemSettings = mongoose.model('SystemSettings', new mongoose.Schema({
    adminPass: { type: String, default: "Jo97BJbi3208" }, 
    financePass: { type: String, default: "YOUR_FINANCE_PASSWORD" }, 
    telegramChannel: { type: String, default: "" }, 
    ticketPrice: { type: Number, default: 10 }, 
    isGamePaused: { type: Boolean, default: false }, 
    gameTimer: { type: Number, default: 40 },
    virtualPrizePool: { type: Number, default: 0 }, 
    vaultTwoBalance: { type: Number, default: 0 }, 
    vaultTwoPercent: { type: Number, default: 10 }, 
    vaultThreeBalance: { type: Number, default: 0 }, 
    vaultThreePercent: { type: Number, default: 10 }, 
    decoyChancePercent: { type: Number, default: 15 }, 
    soloBotWinPercent: { type: Number, default: 15 },
    vaultTransferEnabled: { type: Boolean, default: true },
    vaultTransferredAmount: { type: Number, default: 0 },
    vaultBlockedAmount: { type: Number, default: 0 },
    bonusWinPercent: { type: Number, default: 0 }, 
    isBotSystemActive: { type: Boolean, default: false },
    botWinnerForce: { type: String, default: 'bots' }, 
    mixBotCount: { type: Number, default: 1 }, 
    botDist1: { type: Number, default: 5 }, 
    botDist2: { type: Number, default: 4 }, 
    botDist3: { type: Number, default: 3 }, 
    botDist4: { type: Number, default: 3 }, 
    isBotScheduleActive: { type: Boolean, default: false },
    botRampMinutes: { type: Number, default: 30 },
    weeklyLeaderboardResetAt: { type: Date, default: null },
    ticketCountsResetAt: { type: Date, default: null },
    weeklyStatsAligned: { type: Boolean, default: false },
    tournamentSeasonId: { type: String, default: '' },
    tournamentStartedAt: { type: Date, default: null },
    tournamentEndsAt: { type: Date, default: null },
    tournamentStatus: { type: String, default: 'idle' },
    botSchedule1: { type: Object, default: { start: 0, end: 6, min: 10, max: 15 } },
    botSchedule2: { type: Object, default: { start: 6, end: 9, min: 15, max: 25 } },
    botSchedule3: { type: Object, default: { start: 9, end: 12, min: 20, max: 35 } },
    botSchedule4: { type: Object, default: { start: 12, end: 15, min: 30, max: 45 } },
    botSchedule5: { type: Object, default: { start: 15, end: 18, min: 40, max: 60 } },
    botSchedule6: { type: Object, default: { start: 18, end: 21, min: 55, max: 85 } },
    botSchedule7: { type: Object, default: { start: 21, end: 24, min: 70, max: 110 } },
    depBonusSchedulerActive: { type: Boolean, default: false },
    depBonusSchedulerMinAmount: { type: Number, default: 0 },
    depBonusSchedulerPercent: { type: Number, default: 0 },
    depBonusSchedulerStart: { type: String, default: '14:00' },
    depBonusSchedulerEnd: { type: String, default: '16:00' },
    cardBoardOrder: { type: [Number], default: [] },
    cardGridSeed: { type: Number, default: 0 },
    nextRoundId: { type: Number, default: 0 },
    depBonusMinAmount: { type: Number, default: 50 }, 
    depBonusPercent: { type: Number, default: 50 }, 
    depBonusTier2Min: { type: Number, default: 200 },
    depBonusTier2Percent: { type: Number, default: 100 },
    depBonusTier3Min: { type: Number, default: 300 },
    depBonusTier3Percent: { type: Number, default: 150 },
    depBonusTimeRestricted: { type: Boolean, default: false }, 
    happyHourStart: { type: Number, default: 0 }, 
    happyHourEnd: { type: Number, default: 23 },
    depBannerTextAm: { type: String, default: "" }, 
    depBannerTextEn: { type: String, default: "" },
    witBonusMinAmount: { type: Number, default: 100 }, 
    witBonusPercent: { type: Number, default: 5 }, 
    isWitBonusActive: { type: Boolean, default: false }, 
    witBonusTimeRestricted: { type: Boolean, default: false }, 
    witHappyHourStart: { type: Number, default: 0 }, 
    witHappyHourEnd: { type: Number, default: 23 },
    witBannerTextAm: { type: String, default: "" }, 
    witBannerTextEn: { type: String, default: "" },
    registerBonus: { type: Number, default: 10 }, 
    inviteBonus: { type: Number, default: 10 }, 
    adminProfitPercent: { type: Number, default: 15 },
    maxTicketsPerUser: { type: Number, default: 4 },
    minWithdrawLimit: { type: Number, default: 50 },
    winPopupTimer: { type: Number, default: 12 },
    jackpotBoostAmount: { type: Number, default: 0 },
    // 👇 እነዚህን በትክክል በኮማ ተለያይተው እዚህ ጋር ያስገቡ
    telebirrAccountName: { type: String, default: "YOUR_ACCOUNT_NAME" },
    telebirrAccountNumber: { type: String, default: "YOUR_PHONE_NUMBER" },
    cbeAccountName: { type: String, default: "YOUR_ACCOUNT_NAME" },
    cbeAccountNumber: { type: String, default: "YOUR_PHONE_NUMBER" },
    birrBalance: { type: Number, default: 0 }
}));

const SystemLog = mongoose.model('SystemLog', new mongoose.Schema({
    phone: String,
    actionType: String,
    details: String,
    severity: String,
    date: { type: Date, default: Date.now }
}));

const SupportMessage = mongoose.model('SupportMessage', new mongoose.Schema({
    telegramId: String,
    phone: String,
    name: String,
    text: String,
    sender: String,
    isLatest: { type: Boolean, default: true },
    date: { type: Date, default: Date.now }
}));

const ScheduledPost = mongoose.model('ScheduledPost', new mongoose.Schema({
    text: { type: String, required: true },
    eatDate: String,
    eatTime: String,
    scheduledAt: { type: Date, required: true, index: true },
    status: { type: String, default: 'queued', index: true },
    createdAt: { type: Date, default: Date.now },
    sentAt: Date
}));

const ClaimBroadcast = mongoose.model('ClaimBroadcast', new mongoose.Schema({
    kind: { type: String, default: 'claim', index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    isLatest: { type: Boolean, default: true, index: true },
    status: { type: String, default: 'sending', index: true },
    deletedAt: Date
}));

const ClaimBroadcastMessage = mongoose.model('ClaimBroadcastMessage', new mongoose.Schema({
    batchId: { type: String, index: true },
    chatId: { type: String, required: true },
    messageId: { type: Number, required: true }
}));

const UserPenalty = mongoose.model('UserPenalty', new mongoose.Schema({
    phone: { type: String, unique: true, index: true },
    gamesRemaining: { type: Number, default: 0 },
    bannedUntil: { type: Number, default: 0 },
    kind: { type: String, default: '' },
    reason: { type: String, default: '' },
    updatedAt: { type: Date, default: Date.now }
}));

const RoundEntrySchema = new mongoose.Schema({
    gameId: { type: Number, required: true, index: true },
    roundId: { type: Number, index: true },
    phone: { type: String, required: true, index: true },
    name: String,
    ticketId: { type: Number, required: true, index: true },
    grid: Array,
    paidFromPlay: { type: Number, default: 0 },
    paidFromMain: { type: Number, default: 0 },
    paidFromBonus: { type: Number, default: 0 },
    mainWalletBlocked: { type: Boolean, default: false },
    platformFee: { type: Number, default: 0 },
    netToPool: { type: Number, default: 0 },
    cardFilter: String,
    isBot: { type: Boolean, default: false },
    status: { type: String, default: 'active', index: true },
    isClosed: { type: Boolean, default: false },
    marks: { type: Array, default: undefined },
    committedAt: { type: Date, default: Date.now }
});
RoundEntrySchema.index({ gameId: 1, ticketId: 1 }, { unique: true });
RoundEntrySchema.index({ gameId: 1, status: 1 });
RoundEntrySchema.index({ gameId: 1, phone: 1, ticketId: 1 });
const RoundEntry = mongoose.model('RoundEntry', RoundEntrySchema);

const botRampController = gameEngine.createBotRampController({ maxBots: gameEngine.MAX_BOTS_PER_ROUND });
const botWinController = gameEngine.createBotWinController();
let promoterStatsCache = { at: 0, payload: null };
let weeklyLeaderboardCache = { at: 0, payload: null };

function invalidateWeeklyLeaderboard() {
    weeklyLeaderboardCache = { at: 0, payload: null };
}

function ensureEatDayCounters(user, now) {
    if (!user) return;
    const loss = gameEngine.rolloverDailyLoss(user, now);
    if (user.eatDayKey !== loss.eatDayKey) {
        user.eatDayKey = loss.eatDayKey;
        user.depositTodayEtb = 0;
        user.roundsTodayWithoutWin = 0;
        user.winsToday = 0;
    }
    user.dailyRealBets = loss.dailyRealBets;
    user.dailyWins = loss.dailyWins;
}

function creditUserDailyDeposit(user, amount, now) {
    if (!user) return;
    ensureEatDayCounters(user, now);
    user.depositTodayEtb = (Number(user.depositTodayEtb) || 0) + (Number(amount) || 0);
}

const TICKET_COUNT_RESET_MS = 7 * 24 * 60 * 60 * 1000;

function applyPeriodTickets(user, delta) {
    if (!user) return;
    const change = Number(delta) || 0;
    user.periodTickets = Math.max(0, (Number(user.periodTickets) || 0) + change);
    user.ticketCycleReady = true;
}

async function currentCycleStart() {
    const settings = await SystemSettings.findOne().select('ticketCountsResetAt').lean();
    const anchor = settings && settings.ticketCountsResetAt ? new Date(settings.ticketCountsResetAt) : null;
    if (!anchor || !Number.isFinite(anchor.getTime())) return new Date();
    return anchor;
}

async function applyRecordedWin(user, amount) {
    if (!user) return;
    const prize = Number(amount) || 0;
    if (!user.periodWonReady) {
        const since = await currentCycleStart();
        const prior = await Transaction.aggregate([
            { $match: { phone: String(user.phone), type: 'win', status: 'Approved', date: { $gte: since } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        user.periodWon = Number(prior[0] && prior[0].total) || 0;
        user.periodWonReady = true;
    }
    user.periodWon = (Number(user.periodWon) || 0) + prize;
    if (!user.wonRecordSynced) {
        const priorAll = await Transaction.aggregate([
            { $match: { phone: String(user.phone), type: 'win', status: 'Approved' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        user.totalWon = Number(priorAll[0] && priorAll[0].total) || 0;
        user.wonRecordSynced = true;
    }
    user.totalWon = (Number(user.totalWon) || 0) + prize;
}

async function syncAllTimeWins() {
    const wins = await Transaction.aggregate([
        { $match: { type: 'win', status: 'Approved' } },
        { $group: { _id: '$phone', total: { $sum: '$amount' } } }
    ]);
    const ops = [];
    wins.forEach((row) => {
        const phone = row && row._id != null ? String(row._id) : '';
        if (!phone) return;
        const wonAmount = Number(row.total) || 0;
        ops.push({
            updateOne: {
                filter: { phone },
                update: [{
                    $set: {
                        wonRecordSynced: true,
                        totalWon: { $max: [{ $ifNull: ['$totalWon', 0] }, wonAmount] }
                    }
                }]
            }
        });
    });
    for (let i = 0; i < ops.length; i += 500) {
        await User.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
    await User.updateMany(
        { wonRecordSynced: { $ne: true } },
        { $set: { wonRecordSynced: true } }
    );
}

const WEEKLY_STAT_RESET = { periodTickets: 0, periodWon: 0, ticketCycleReady: true, periodWonReady: true };

async function alignWeeklyStats(since) {
    const wins = await Transaction.aggregate([
        { $match: { type: 'win', status: 'Approved', date: { $gte: since } } },
        { $group: { _id: '$phone', total: { $sum: '$amount' } } }
    ]);
    const ticketRows = await GameHistory.aggregate([
        { $match: { date: { $gte: since } } },
        { $unwind: '$playersData' },
        { $match: { 'playersData.isBot': { $ne: true }, 'playersData.phone': { $nin: [null, ''] } } },
        { $group: { _id: '$playersData.phone', tickets: { $sum: { $ifNull: ['$playersData.tickets', 0] } } } }
    ]);
    const wonByPhone = {};
    wins.forEach((row) => {
        const phone = row && row._id != null ? String(row._id) : '';
        if (!phone) return;
        wonByPhone[phone] = Number(row.total) || 0;
    });
    const ticketsByPhone = {};
    ticketRows.forEach((row) => {
        const phone = row && row._id != null ? String(row._id) : '';
        if (!phone) return;
        ticketsByPhone[phone] = Math.max(0, Number(row.tickets) || 0);
    });
    let liveState = '';
    let livePlayers = null;
    try {
        liveState = gameState;
        livePlayers = activePlayers;
    } catch (e) {}
    if ((liveState === 'WAITING' || liveState === 'PLAYING') && livePlayers) {
        Object.values(livePlayers).forEach((player) => {
            if (!player || player.isBot || player.phone == null || player.phone === '') return;
            const phone = String(player.phone);
            const liveTickets = Number(player.tickets) || (Array.isArray(player.ticketsData) ? player.ticketsData.length : 0);
            ticketsByPhone[phone] = (ticketsByPhone[phone] || 0) + Math.max(0, liveTickets);
        });
    }
    const phones = Object.keys(Object.assign({}, wonByPhone, ticketsByPhone));
    const ops = phones.map((phone) => {
        const wonAmount = wonByPhone[phone] || 0;
        return {
            updateOne: {
                filter: { phone },
                update: [{
                    $set: {
                        periodTickets: ticketsByPhone[phone] || 0,
                        ticketCycleReady: true,
                        periodWonReady: true,
                        periodWon: {
                            $cond: [
                                { $eq: ['$periodWonReady', true] },
                                { $max: [{ $ifNull: ['$periodWon', 0] }, wonAmount] },
                                wonAmount
                            ]
                        }
                    }
                }]
            }
        };
    });
    for (let i = 0; i < ops.length; i += 500) {
        await User.bulkWrite(ops.slice(i, i + 500), { ordered: false });
    }
    await User.updateMany(
        phones.length ? { phone: { $nin: phones }, periodWonReady: { $ne: true } } : { periodWonReady: { $ne: true } },
        { $set: WEEKLY_STAT_RESET }
    );
}

async function ensureTicketCountCycle() {
    const settings = await SystemSettings.findOne();
    if (!settings) return;
    const now = Date.now();
    if (!settings.ticketCountsResetAt) {
        await User.updateMany({}, { $set: WEEKLY_STAT_RESET });
        settings.ticketCountsResetAt = new Date(now);
        settings.weeklyStatsAligned = true;
        await settings.save();
        return;
    }
    const anchor = new Date(settings.ticketCountsResetAt).getTime();
    if (!Number.isFinite(anchor) || (now - anchor) >= TICKET_COUNT_RESET_MS) {
        await User.updateMany({}, { $set: WEEKLY_STAT_RESET });
        settings.ticketCountsResetAt = new Date(now);
        settings.weeklyStatsAligned = true;
        await settings.save();
        return;
    }
    if (!settings.weeklyStatsAligned) {
        await alignWeeklyStats(new Date(anchor));
        settings.weeklyStatsAligned = true;
        await settings.save();
    }
}

setInterval(() => {
    ensureTicketCountCycle().catch(() => {});
}, 60 * 1000);

function applyConfiguredDepositBonus(amount, user, now) {
    const info = gameEngine.computeDepositBonus(amount, user, GLOBAL_SETTINGS, now);
    return {
        bonus: Number(info.bonus) || 0,
        source: info.source || 'none',
        giveBonus: !!info.giveBonus,
        percent: info.percent || 0
    };
}

function collectParticipantPhones(players) {
    const phones = [];
    const seen = new Set();
    Object.values(players || {}).forEach((p) => {
        const phone = p && p.phone != null ? String(p.phone) : '';
        if (!phone || seen.has(phone)) return;
        seen.add(phone);
        phones.push(phone);
    });
    return phones;
}

async function ensurePerformanceIndexes() {
    const jobs = [
        GameHistory.collection.createIndex({ participantPhones: 1, date: -1 }),
        GameHistory.collection.createIndex({ 'playersData.phone': 1, date: -1 }),
        GameHistory.collection.createIndex({ roundId: 1, createdAt: -1, winnerId: 1 }),
        GameHistory.collection.createIndex({ gameId: 1, date: -1 }),
        GameHistory.collection.createIndex({ winnerPhone: 1, date: -1 }),
        GameHistory.collection.createIndex({ winnerId: 1, createdAt: -1 }),
        Transaction.collection.createIndex({ type: 1, status: 1, date: -1 }),
        Transaction.collection.createIndex({ phone: 1, type: 1, date: -1 }),
        User.collection.createIndex({ isPromoter: 1, promoterEarned: -1 }),
        User.collection.createIndex({ referredBy: 1, referredViaPromo: 1 }),
        ScheduledPost.collection.createIndex({ status: 1, scheduledAt: 1 }),
        ClaimBroadcast.collection.createIndex({ kind: 1, isLatest: 1, createdAt: -1 }),
        ClaimBroadcastMessage.collection.createIndex({ batchId: 1 }),
        UserPenalty.collection.createIndex({ phone: 1 }, { unique: true }),
        RoundEntry.collection.createIndex({ gameId: 1, status: 1 }),
        RoundEntry.collection.createIndex({ gameId: 1, phone: 1, ticketId: 1 })
    ];
    await Promise.all(jobs.map((p) => p.catch((err) => {
        console.log('Index ensure skipped:', err && err.message);
    })));
}

mongoose.connection.once('open', () => {
    ensurePerformanceIndexes();
    syncAllTimeWins().catch(() => {});
    ensureTicketCountCycle().catch(() => {});
});

let dailyHouseProfit = 0;
let currentDayTracker = new Date().getDate();

setInterval(() => {
    let today = new Date().getDate();
    if (today !== currentDayTracker) {
        dailyHouseProfit = 0;
        currentDayTracker = today;
    }
}, 60000);

let GLOBAL_SETTINGS = {};
let roundCardGridSeed = 0;
let roundGridSeedLocked = false;
async function loadSettings() {
    let s = await SystemSettings.findOne();
    if(!s) { s = await new SystemSettings({}).save(); }
    GLOBAL_SETTINGS = { 
        adminPass: s.adminPass, 
        financePass: s.financePass, 
        telegramChannel: s.telegramChannel || "",
        ticketPrice: s.ticketPrice, 
        isGamePaused: s.isGamePaused, 
        gameTimer: s.gameTimer || 40, 
        
        virtualPrizePool: s.virtualPrizePool || 0, 
        vaultTwoBalance: s.vaultTwoBalance || 0,
        vaultTwoPercent: s.vaultTwoPercent !== undefined ? s.vaultTwoPercent : 10,
        vaultThreeBalance: s.vaultThreeBalance || 0,
        vaultThreePercent: s.vaultThreePercent !== undefined ? s.vaultThreePercent : 10,
        vaultTransferEnabled: s.vaultTransferEnabled !== false,
        vaultTransferredAmount: s.vaultTransferredAmount || 0,
        vaultBlockedAmount: s.vaultBlockedAmount || 0,

        decoyChancePercent: s.decoyChancePercent !== undefined ? s.decoyChancePercent : 15, 
        soloBotWinPercent: s.soloBotWinPercent !== undefined ? s.soloBotWinPercent : 15,
        bonusWinPercent: s.bonusWinPercent !== undefined ? s.bonusWinPercent : 0, 

        isBotSystemActive: s.isBotSystemActive || false,
        botWinnerForce: s.botWinnerForce || 'bots',
        mixBotCount: s.mixBotCount !== undefined ? s.mixBotCount : 1,
        botDist1: s.botDist1 !== undefined ? s.botDist1 : 5,
        botDist2: s.botDist2 !== undefined ? s.botDist2 : 4,
        botDist3: s.botDist3 !== undefined ? s.botDist3 : 3,
        botDist4: s.botDist4 !== undefined ? s.botDist4 : 3,

        isBotScheduleActive: s.isBotScheduleActive || false,
        botRampMinutes: gameEngine.normalizeBotRampMinutes(s.botRampMinutes),
        weeklyLeaderboardResetAt: s.weeklyLeaderboardResetAt || null,
        tournamentSeasonId: s.tournamentSeasonId || '',
        tournamentStartedAt: s.tournamentStartedAt || null,
        tournamentEndsAt: s.tournamentEndsAt || null,
        tournamentStatus: s.tournamentStatus || 'idle',
        botSchedule1: s.botSchedule1 || { start: 0, end: 6, min: 10, max: 15 },
        botSchedule2: s.botSchedule2 || { start: 6, end: 9, min: 15, max: 25 },
        botSchedule3: s.botSchedule3 || { start: 9, end: 12, min: 20, max: 35 },
        botSchedule4: s.botSchedule4 || { start: 12, end: 15, min: 30, max: 45 },
        botSchedule5: s.botSchedule5 || { start: 15, end: 18, min: 40, max: 60 },
        botSchedule6: s.botSchedule6 || { start: 18, end: 21, min: 55, max: 85 },
        botSchedule7: s.botSchedule7 || { start: 21, end: 24, min: 70, max: 110 },
        depBonusSchedulerActive: !!s.depBonusSchedulerActive,
        depBonusSchedulerMinAmount: s.depBonusSchedulerMinAmount !== undefined ? s.depBonusSchedulerMinAmount : 0,
        depBonusSchedulerPercent: s.depBonusSchedulerPercent !== undefined ? s.depBonusSchedulerPercent : 0,
        depBonusSchedulerStart: s.depBonusSchedulerStart || '14:00',
        depBonusSchedulerEnd: s.depBonusSchedulerEnd || '16:00',
        cardBoardOrder: Array.isArray(s.cardBoardOrder) ? s.cardBoardOrder : [],
        cardGridSeed: Number(s.cardGridSeed) || 0,
        
        depBonusMinAmount: s.depBonusMinAmount !== undefined ? s.depBonusMinAmount : 50, 
        depBonusPercent: s.depBonusPercent !== undefined ? s.depBonusPercent : 50, 
        depBonusTier2Min: s.depBonusTier2Min !== undefined ? s.depBonusTier2Min : 200, 
        depBonusTier2Percent: s.depBonusTier2Percent !== undefined ? s.depBonusTier2Percent : 100, 
        depBonusTier3Min: s.depBonusTier3Min !== undefined ? s.depBonusTier3Min : 300, 
        depBonusTier3Percent: s.depBonusTier3Percent !== undefined ? s.depBonusTier3Percent : 150, 

        depBonusTimeRestricted: s.depBonusTimeRestricted || false, 
        happyHourStart: s.happyHourStart !== undefined ? s.happyHourStart : 0, 
        happyHourEnd: s.happyHourEnd !== undefined ? s.happyHourEnd : 23, 
        depBannerTextAm: s.depBannerTextAm || "", 
        depBannerTextEn: s.depBannerTextEn || "",
        
        witBonusMinAmount: s.witBonusMinAmount !== undefined ? s.witBonusMinAmount : 100, 
        witBonusPercent: s.witBonusPercent !== undefined ? s.witBonusPercent : 5, 
        isWitBonusActive: s.isWitBonusActive || false,
        witBonusTimeRestricted: s.witBonusTimeRestricted || false, 
        witHappyHourStart: s.witHappyHourStart !== undefined ? s.witHappyHourStart : 0, 
        witHappyHourEnd: s.witHappyHourEnd !== undefined ? s.witHappyHourEnd : 23,
        witBannerTextAm: s.witBannerTextAm || "", 
        witBannerTextEn: s.witBannerTextEn || "",
        
        registerBonus: s.registerBonus !== undefined ? s.registerBonus : 10, 
        inviteBonus: s.inviteBonus !== undefined ? s.inviteBonus : 10,
        adminProfitPercent: s.adminProfitPercent !== undefined ? s.adminProfitPercent : 15, 
        maxTicketsPerUser: s.maxTicketsPerUser !== undefined ? s.maxTicketsPerUser : 4,
        minWithdrawLimit: s.minWithdrawLimit !== undefined ? s.minWithdrawLimit : 50,
        winPopupTimer: s.winPopupTimer !== undefined ? s.winPopupTimer : 12,
        jackpotBoostAmount: s.jackpotBoostAmount !== undefined ? s.jackpotBoostAmount : 0,
       
        telebirrAccountName: s.telebirrAccountName || "YOUR_ACCOUNT_NAME",
        telebirrAccountNumber: s.telebirrAccountNumber || "YOUR_PHONE_NUMBER",
        cbeAccountName: s.cbeAccountName || "YOUR_ACCOUNT_NAME",
        cbeAccountNumber: s.cbeAccountNumber || "YOUR_PHONE_NUMBER",
        birrBalance: birrBalance.roundBirr(s.birrBalance),
        birrBalanceVersion: birrBalanceVersion
    };
    jackpotBoostAmount = GLOBAL_SETTINGS.jackpotBoostAmount;
    if (!roundGridSeedLocked) {
        roundCardGridSeed = Number(GLOBAL_SETTINGS.cardGridSeed) || 0;
        roundGridSeedLocked = true;
    }
}
let birrBalanceVersion = 0;
loadSettings();

async function changeBirrBalance(delta) {
    const step = birrBalance.roundBirr(delta);
    if (!step) {
        return { balance: birrBalance.roundBirr(GLOBAL_SETTINGS.birrBalance), version: birrBalanceVersion };
    }
    const updated = await SystemSettings.findOneAndUpdate(
        {},
        { $inc: { birrBalance: step } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const balance = birrBalance.roundBirr(updated ? updated.birrBalance : (Number(GLOBAL_SETTINGS.birrBalance) || 0) + step);
    if (updated && balance !== Number(updated.birrBalance)) {
        await SystemSettings.updateOne({ _id: updated._id }, { $set: { birrBalance: balance } });
    }
    return publishBirrBalance(balance);
}

function publishBirrBalance(balance) {
    const rounded = birrBalance.roundBirr(balance);
    birrBalanceVersion += 1;
    GLOBAL_SETTINGS.birrBalance = rounded;
    GLOBAL_SETTINGS.birrBalanceVersion = birrBalanceVersion;
    if (cachedLiveStats) cachedLiveStats.settings = GLOBAL_SETTINGS;
    io.emit('birr_balance', { birrBalance: rounded, version: birrBalanceVersion });
    return { balance: rounded, version: birrBalanceVersion };
}

async function setBirrBalance(amount) {
    const balance = birrBalance.roundBirr(amount);
    await SystemSettings.findOneAndUpdate(
        {},
        { $set: { birrBalance: balance } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return publishBirrBalance(balance);
}

// Amar Bingo: paste the new Telegram bot token here. The webhook path uses this value.
const telegramToken = "YOUR_TELEGRAM_BOT_TOKEN";
const bot = new TelegramBot(telegramToken, { polling: false }); 
const WEB_URL = "https://amar-bingo.onrender.com"; 

async function checkTelegramJoin(telegramId) {
    if (!GLOBAL_SETTINGS.telegramChannel || !telegramId) return true; 
    let channel = GLOBAL_SETTINGS.telegramChannel.startsWith('@') ? GLOBAL_SETTINGS.telegramChannel : '@' + GLOBAL_SETTINGS.telegramChannel;
    try {
        let member = await bot.getChatMember(channel, telegramId);
        if (['member', 'administrator', 'creator'].includes(member.status)) return true;
        return false;
    } catch (e) { return true; } 
}

function generateRefCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

function referralObjectIdFromTime(date) {
    const seconds = Math.floor(new Date(date).getTime() / 1000);
    return new mongoose.Types.ObjectId(seconds.toString(16).padStart(8, '0') + '0000000000000000');
}

async function countReferralSignupsToday(referrerPhone, now) {
    const dayStart = gameEngine.currentEatDayStart(now);
    const minId = referralObjectIdFromTime(dayStart);
    return User.countDocuments({ referredBy: String(referrerPhone || ''), _id: { $gte: minId } });
}

/**
 * Atomically reserve one of the 5 daily signups allowed for this invite link.
 * The window is the current Ethiopia calendar day.
 */
async function reserveReferralSignup(referrer, now) {
    if (!referrer || !referrer._id) {
        return { ok: false, message: gameEngine.REFERRAL_LIMIT_MESSAGE };
    }
    const dayKey = gameEngine.eatDayKey(now);
    const cap = gameEngine.MAX_SIGNUPS_PER_LINK_PER_DAY;
    const incremented = await User.findOneAndUpdate(
        { _id: referrer._id, referralDayKey: dayKey, referralDayCount: { $lt: cap } },
        { $inc: { referralDayCount: 1 } },
        { new: true }
    );
    if (incremented) return { ok: true, user: incremented };

    const fresh = await User.findById(referrer._id).select('referralDayKey referralDayCount phone');
    if (fresh && fresh.referralDayKey === dayKey && (Number(fresh.referralDayCount) || 0) >= cap) {
        return { ok: false, message: gameEngine.REFERRAL_LIMIT_MESSAGE };
    }

    const already = await countReferralSignupsToday(referrer.phone, now);
    const decision = gameEngine.referralSignupDecision(already, cap);
    if (!decision.allowed) {
        await User.updateOne(
            { _id: referrer._id, referralDayKey: { $ne: dayKey } },
            { $set: { referralDayKey: dayKey, referralDayCount: already } }
        );
        return { ok: false, message: decision.message };
    }

    const seeded = await User.findOneAndUpdate(
        { _id: referrer._id, referralDayKey: { $ne: dayKey } },
        { $set: { referralDayKey: dayKey, referralDayCount: already + 1 } },
        { new: true }
    );
    if (seeded) return { ok: true, user: seeded };

    const retry = await User.findOneAndUpdate(
        { _id: referrer._id, referralDayKey: dayKey, referralDayCount: { $lt: cap } },
        { $inc: { referralDayCount: 1 } },
        { new: true }
    );
    if (retry) return { ok: true, user: retry };
    return { ok: false, message: gameEngine.REFERRAL_LIMIT_MESSAGE };
}

async function releaseReferralSignup(referrerId, now) {
    if (!referrerId) return;
    const dayKey = gameEngine.eatDayKey(now);
    await User.updateOne(
        { _id: referrerId, referralDayKey: dayKey, referralDayCount: { $gt: 0 } },
        { $inc: { referralDayCount: -1 } }
    );
}

async function applyReferrerReward(referrerId, bonusApplied) {
    const inc = { totalInvites: 1 };
    if (bonusApplied) {
        const bonus = Number(GLOBAL_SETTINGS.inviteBonus) || 0;
        inc.playBalance = bonus;
        inc.inviteBonusEarned = bonus;
    }
    await User.updateOne({ _id: referrerId }, { $inc: inc });
}

async function rollbackReferrerReward(referrerId, bonusApplied, now) {
    // 🔥 ማስተካከያ: ኖርማል ሊንክ ከሆነ ብቻ ነው የቀን ቆጣሪውን ወደ ኋላ የምንመልሰው
    if (bonusApplied) {
        await releaseReferralSignup(referrerId, now);
    }
    const inc = { totalInvites: -1 };
    if (bonusApplied) {
        const bonus = Number(GLOBAL_SETTINGS.inviteBonus) || 0;
        inc.playBalance = -bonus;
        inc.inviteBonusEarned = -bonus;
    }
    await User.updateOne({ _id: referrerId }, { $inc: inc });
}

/**
 * Resolve an invite code and reserve a daily signup slot.
 * Returns { ok:false, limited:true } when this link already has 5 signups today.
 */
async function claimInviteLink(cleanRefCode, phone, isPromoLink) {
    if (!cleanRefCode || cleanRefCode === phone) {
        return { ok: true, actualRef: '', isPromoLink: !!isPromoLink, referrerId: null, bonusApplied: false };
    }
    const refUser = await User.findOne({ $or: [{ phone: cleanRefCode }, { refCode: cleanRefCode }] });
    if (!refUser || refUser.phone === phone) {
        return { ok: true, actualRef: '', isPromoLink: !!isPromoLink, referrerId: null, bonusApplied: false };
    }
    
    const promo = !!(isPromoLink && refUser.isPromoter);
    const bonusApplied = !promo;

    // 🔥 ዋናው ማስተካከያ: ፕሮሞ ሊንክ (Promoter) ከሆነ የቀን ገደብ (5 ሰው) አይመለከተውም! (ይዘለዋል)
    // ኖርማል ሊንክ ከሆነ ግን በቀን 5 ገደብ ይኖረዋል
    if (!promo) {
        const slot = await reserveReferralSignup(refUser);
        if (!slot.ok) {
            return { ok: false, limited: true, message: slot.message || gameEngine.REFERRAL_LIMIT_MESSAGE || 'Daily referral invite limit reached for this link' };
        }
    }

    await applyReferrerReward(refUser._id, bonusApplied);
    
    return {
        ok: true,
        actualRef: refUser.phone,
        isPromoLink: promo,
        referrerId: refUser._id,
        bonusApplied
    };
}

const WELCOME_PHOTO_URL = "https://i.postimg.cc/fyRC4Vsq/IMG-20260510-002811-640.jpg";

function getTxRef(text) {
    if (!text || typeof text !== 'string') return null;
    let msg = text.toUpperCase().replace(/\n/g, ' ');
    let ftMatch = msg.match(/\b(FT[0-9A-Z]{5,15})\b/);
    if (ftMatch) return ftMatch[1];
    let matches = msg.match(/\b(?![A-Z]+\b)(?!\d+\b)[A-Z0-9]{6,15}\b/g);
    if (matches && matches.length > 0) return matches[0];
    let exact = msg.replace(/\s+/g, '');
    if (exact.length >= 6 && exact.length <= 15 && !/^\d+$/.test(exact)) return exact;
    return null;
}

function getBankAmount(text) {
    if (!text || typeof text !== 'string') return 0;
    let msg = text.toUpperCase().replace(/\n/g, ' ');
    let amtMatch = msg.match(/(?:ETB|BIRR|BR|ብር)\s*([\d,]+(?:\.\d+)?)/i) || msg.match(/([\d,]+(?:\.\d+)?)\s*(?:ETB|BIRR|BR|ብር)/i);
    if (amtMatch) return parseFloat(amtMatch[1].replace(/,/g, ''));
    return 0;
}

async function isSmsAlreadyUsed(userInputSms) {
    let txRef = getTxRef(userInputSms);
    if (!txRef) return false; 
    let inBankSms = await BankSMS.findOne({ txRef: txRef, isUsed: true });
    if (inBankSms) return true;
    let inTxRef = await Transaction.findOne({ txRef: txRef, status: { $in: ['Approved', 'Pending'] } });
    return !!inTxRef;
}

function commitDepositVaultSplit(amount) {
    const booked = gameEngine.applyDepositVaultSplit({
        virtualPrizePool: GLOBAL_SETTINGS.virtualPrizePool,
        vaultTwoBalance: GLOBAL_SETTINGS.vaultTwoBalance,
        vaultThreeBalance: GLOBAL_SETTINGS.vaultThreeBalance,
        vaultTransferredAmount: GLOBAL_SETTINGS.vaultTransferredAmount,
        vaultBlockedAmount: GLOBAL_SETTINGS.vaultBlockedAmount,
        dailyHouseProfit: dailyHouseProfit
    }, amount, GLOBAL_SETTINGS);
    SystemSettings.updateOne({}, { $inc: booked.inc }).exec();
    GLOBAL_SETTINGS.virtualPrizePool = booked.next.virtualPrizePool;
    GLOBAL_SETTINGS.vaultTwoBalance = booked.next.vaultTwoBalance;
    GLOBAL_SETTINGS.vaultThreeBalance = booked.next.vaultThreeBalance;
    GLOBAL_SETTINGS.vaultTransferredAmount = booked.next.vaultTransferredAmount;
    GLOBAL_SETTINGS.vaultBlockedAmount = booked.next.vaultBlockedAmount;
    dailyHouseProfit = booked.next.dailyHouseProfit;
    return booked.plan;
}

async function autoApprovePendingDeposits() {
    try {
        const pendingTxs = await Transaction.find({ type: 'deposit', status: 'Pending' }).sort({ _id: -1 }).limit(1000);
        const unusedSMS = await BankSMS.find({ isUsed: false }).sort({ _id: -1 }).limit(1000);
        
        for (let tx of pendingTxs) {
            try { 
                if (!tx.txRef) continue; 
                
                // 🔴 ዋናው ማስተካከያ፡ ተጠቃሚው ቀድሞ ቢያስገባም ባንኩ ቀድሞ ቢልክም በትክክል እንዲያገናኘው ያደርጋል
                let matchedSMS = unusedSMS.find(sms => 
                    sms.txRef && 
                    tx.txRef && 
                    sms.txRef.toUpperCase().trim() === tx.txRef.toUpperCase().trim()
                );
                
                if (matchedSMS) {
                    let user = await User.findOne({ phone: tx.phone });
                    if (user) {
                        let actualReceivedAmount = Math.round(matchedSMS.amount);
                        let bonus = applyConfiguredDepositBonus(actualReceivedAmount, user).bonus;
                        
                        let totalCredit = actualReceivedAmount + bonus;
                        tx.amount = actualReceivedAmount; 
                        tx.bonusGiven = bonus; 
                        tx.status = 'Approved';
                        await tx.save();
                        
                        matchedSMS.isUsed = true;
                        await matchedSMS.save();
                        
                        user.playBalance += totalCredit;
                        user.totalDeposited += actualReceivedAmount;
                        user.unplayedRealDeposit += actualReceivedAmount;
                        creditUserDailyDeposit(user, actualReceivedAmount); 

                        commitDepositVaultSplit(actualReceivedAmount); 

                        if(user.referredBy && user.referredViaPromo) {
                            let promoter = await User.findOne({ phone: user.referredBy, isPromoter: true });
                            if(promoter) {
                                let commission = actualReceivedAmount * (promoter.promoterPercent / 100);
                                promoter.promoterUnpaidBalance += commission; 
                                promoter.promoterEarned += commission;
                                await promoter.save();
                                user.promoterCommissionGenerated += commission; 
                                io.emit('balance_updated', promoter.phone);
                                
                                if(promoter.telegramId) {
                                    let msg = `🎉 <b>የኮሚሽን ገቢ!</b>\n\nበእርስዎ የጋባዥ ሊንክ የመጣው <b>${user.name}</b> አሁን ገቢ አድርጓል።\n\n💰 <b>የእርስዎ ኮሚሽን:</b> +${commission} ETB\n💸 <b>ያልተከፈለ አጠቃላይ ኮሚሽን:</b> ${promoter.promoterUnpaidBalance} ETB`;
                                    bot.sendMessage(promoter.telegramId, msg, {parse_mode: 'HTML'}).catch(e=>{});
                                }
                            }
                        }
                        if (!user.hasMadeFirstDeposit) user.hasMadeFirstDeposit = true; 
                        await user.save();
                        io.emit('balance_updated', tx.phone);
                        
                        if(bonus > 0) {
                            io.emit('deposit_bonus_alert', { phone: tx.phone, depositAmount: actualReceivedAmount, bonusAmount: bonus });
                        }

                        // 🔴 አዲሱ ማስተካከያ: ሲስተሙ ሲያረጋግጥ በቴሌግራም ብሩ እንደገባ እና ቦነስ ካለ ይነግረዋል
                        if (user.telegramId) {
                            let msg = `✅ <b>ገቢዎ ተረጋግጧል! (Deposit Approved)</b>\n\n💰 <b>ገቢ ያደረጉት:</b> ${actualReceivedAmount} ETB`;
                            if (bonus > 0) {
                                msg += `\n🎁 <b>ያገኙት ቦነስ:</b> ${bonus} ETB`;
                                msg += `\n💵 <b>አጠቃላይ የገባው:</b> ${actualReceivedAmount + bonus} ETB`;
                            }
                            msg += `\n\n🎯 <b>አሁን ያለው ሂሳብዎ:</b> ${user.playBalance.toFixed(2)} ETB\nመልካም እድል!`;
                            bot.sendMessage(user.telegramId, msg, {parse_mode: 'HTML'}).catch(e=>{});
                        }
                    }
                }
            } catch (innerErr) {}
        }
    } catch (err) {}
}

setInterval(autoApprovePendingDeposits, 20000);

// 🔥 ያለ POST በሊንክ (GET) ብቻም የሚሰራ የአንድሮይድ Webhook
// 🔥 በሊንክ ብቻ (GET Request) እንዲሰራ የተደረገ የ SMS Webhook
app.all('/api/webhook/android-sms-Tside04', async (req, res) => {
    try {
        // ከሊንኩ ላይ (URL) ሚስጥራዊ ኮዱን እና ቴክስቱን ያነባል
        const secret = req.query.secret || req.body.secret;
        if(secret !== "YOUR_SMS_WEBHOOK_SECRET") return res.status(401).json({ error: "Unauthorized" });
        
        const message = req.query.message || req.query.text || req.body.message || req.body.text;
        
        if (!message) return res.json({ success: false, msg: "Empty message" });
        
        // 🔥 የ SMS ማጣሪያ: "transfer" ወይም "debited" የሚል ካለበት አይቀበለውም
        let isReceivingMsg = /received|credited|gebi|into your account|deposit/i.test(message);
        let isSendingMsg = /transfer|transferred|debited|out of your account/i.test(message);
        
        if(!isReceivingMsg || isSendingMsg) return res.json({ success: false, msg: "Not a receiving message" });
        
        let txRef = getTxRef(message);
        let amount = getBankAmount(message);
        
        if(amount > 0 && txRef) {
            const exists = await BankSMS.findOne({ txRef: txRef });
            if (!exists) {
                await BankSMS.create({ rawText: message, txRef: txRef, amount: amount });
                await autoApprovePendingDeposits(); 
            }
            res.json({ success: true, amount, txRef });
        } else { 
            res.json({ success: false, msg: "Invalid TxRef or Amount" }); 
        }
    } catch (e) { 
        res.status(500).json({ error: "Server Error" }); 
    }
});

// 🔥 SECURITY FIX: የውሸት አካውንት እና ቦቶችን (Bots) መከላከያ


// 🔥 CLOUD PROXY FIX: የሀከሩን የውሸት IP አጋልጦ ትክክለኛውን እንዲያገኝ ያደርጋል
app.set('trust proxy', 1);

// 🔥 ANTI-DOS RATE LIMITER (Spam መከላከያ)
const ddosLimiterMap = new Map();
const strictRateLimiter = (req, res, next) => {
    const ip = req.ip; // ትክክለኛው IP (Spoof ማድረግ አይቻልም)
    const userAgent = req.headers['user-agent'] || "";

    // 1. ያለ ብራውዘር (በ Curl/Script/Postman) የሚመጡ ጥቃቶችን ወዲያው ያግዳል
    if (!userAgent || userAgent.toLowerCase().includes('curl') || userAgent.toLowerCase().includes('python')) {
        return res.status(403).json({ success: false, message: "Security Blocked!" });
    }

    const now = Date.now();
    const windowMs = 60 * 1000; // 1 ደቂቃ
    const maxRequests = 5; // በአንድ ደቂቃ 5 ሪኩዌስት ብቻ!

    if (!ddosLimiterMap.has(ip)) {
        ddosLimiterMap.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }

    const limitData = ddosLimiterMap.get(ip);
    if (now > limitData.resetTime) {
        limitData.count = 1;
        limitData.resetTime = now + windowMs;
        return next();
    }

    limitData.count++;
    if (limitData.count > maxRequests) {
        console.log(`🚨 DOS ATTACK BLOCKED! IP: ${ip}`);
        return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });
    }
    next();
};

// የውሸት አካውንት መከላከያ
const ipCreationCounts = new Map();
// ይሄን ኮድ app.post('/api/register', ...) ከሚለው በላይ አስገብተው
setInterval(() => {
    const now = Date.now();
    for (let [ip, limitData] of ddosLimiterMap.entries()) {
        if (now > limitData.resetTime) {
            ddosLimiterMap.delete(ip); // ሚሞሪ እንዳይሞላ ያጸዳል
        }
    }
}, 10 * 60 * 1000);

// 🚀 ከላይ የሰራነውን ማጣሪያ (strictRateLimiter) መመዝገቢያው ላይ እናስገባዋለን
app.post('/api/register', strictRateLimiter, async (req, res) => {
    try {
        let phone = String(req.body.phone).trim();
        let name = String(req.body.name).trim();
        let password = String(req.body.password).trim();
        let refCode = String(req.body.refCode || "").trim();

        if (!/^(09|07)\d{8}$/.test(phone)) {
            return res.json({ success: false, message: "❌ እባክዎ ትክክለኛ የኢትዮጵያ ስልክ ቁጥር ያስገቡ! (09... ወይም 07...)" });
        }
        if (name.toLowerCase().startsWith('user') && /\d+$/.test(name)) {
            return res.json({ success: false, message: "❌ ይህን ስም መጠቀም አይቻልም! እባክዎ ትክክለኛ ስምዎን ያስገቡ።" });
        }

        if (await User.findOne({ phone })) return res.json({ success: false, message: "ይህ ስልክ ቁጥር ተመዝግቧል!" });

        let cleanRefCode = refCode;
        let isPromoLink = false;

        if (cleanRefCode.startsWith('promo_')) {
            cleanRefCode = cleanRefCode.replace('promo_', '');
            isPromoLink = true;
        }

        const invite = await claimInviteLink(cleanRefCode, phone, isPromoLink);
        if (!invite.ok) {
            return res.json({ success: false, message: invite.message || 'Daily referral invite limit reached for this link' });
        }

        let myRefCode = generateRefCode();
        try {
            await new User({ phone, name, password, refCode: myRefCode, referredBy: invite.actualRef, referredViaPromo: invite.isPromoLink, playBalance: GLOBAL_SETTINGS.registerBonus }).save();
        } catch (saveErr) {
            if (invite.referrerId) await rollbackReferrerReward(invite.referrerId, invite.bonusApplied);
            throw saveErr;
        }
        if (invite.bonusApplied && invite.actualRef) io.emit('balance_updated', invite.actualRef);

        res.json({ success: true });
    } catch (e) {
        console.log("❌ Register error:", e.message);
        res.status(500).json({ success: false, message: "❌ ስርዓቱ መለያውን ማስቀመጥ አልቻለም። እባክዎ ትንሽ ቆይተው እንደገና ይሞክሩ።" });
    }
});

// 🔥 SECURITY FIX: ፓስወርድ ወደ ውጪ እንዳይላክ መዝጊያ
app.post('/api/login', async (req, res) => {
    let phone = String(req.body.phone);
    let password = String(req.body.password);
    
    let user = await User.findOne({ phone: phone, password: password });
    if(user && user.status === 'banned') return res.json({ success: false, message: "❌ አካውንትዎ ታግዷል!" });
    if(user && !user.refCode) { user.refCode = generateRefCode(); await user.save(); } 
    
    if (user) {
        // ተጫዋቹ ገብቶ ሲሳካለት ሰዓቱን ይመዘግባል
        User.updateOne({ phone: user.phone }, { $set: { lastActive: new Date() } }).exec();
        let safeUser = user.toObject();
        delete safeUser.password; // ፓስወርዱን አጥፍቶ ይልካል
        res.json({ success: true, user: safeUser });
    } else {
        res.json({ success: false, message: "ስልክ ቁጥር ወይም ፓስወርድ ተሳስቷል!" });
    }
});

function telegramProfilePatch(source) {
    const from = source || {};
    const telegramUsername = from.username ? String(from.username).replace(/^@+/, '').trim() : '';
    const firstName = String(from.first_name || from.firstName || '').trim();
    const set = {};
    if (telegramUsername) set.telegramUsername = telegramUsername;
    if (firstName) set.firstName = firstName;
    return set;
}

function rememberTelegramIdentity(source) {
    try {
        const from = source || {};
        if (from.id == null || from.id === '') return;
        const set = telegramProfilePatch(from);
        const keys = Object.keys(set);
        if (!keys.length) return;
        const ors = keys.map((key) => ({ [key]: { $ne: set[key] } }));
        User.updateOne({ telegramId: String(from.id), $or: ors }, { $set: set }).exec();
    } catch (e) {}
}

app.post('/api/telegram-login', async (req, res) => {
    let user = await User.findOne({ telegramId: String(req.body.telegramId) });
    if (user) {
        const profile = telegramProfilePatch({
            username: req.body.username,
            first_name: req.body.firstName || req.body.first_name
        });
        if (profile.telegramUsername) user.telegramUsername = profile.telegramUsername;
        if (profile.firstName) user.firstName = profile.firstName;
    }
    if(user && user.status === 'banned') {
        if (user.isModified()) {
            User.updateOne({ _id: user._id }, { $set: telegramProfilePatch({ username: user.telegramUsername, first_name: user.firstName }) }).exec();
        }
        return res.json({ success: false, message: "❌ የታገደ አካውንት!" });
    }
    if(user && !user.refCode) { user.refCode = generateRefCode(); await user.save(); }
    else if (user && user.isModified()) {
        await User.updateOne({ _id: user._id }, { $set: telegramProfilePatch({ username: user.telegramUsername, first_name: user.firstName }) });
    }
    if(user) res.json({ success: true, user });
    else res.json({ success: false, message: "Share contact in bot first." });
});

app.post('/api/user/change-password', async (req, res) => {
    const phone = String(req.body.phone);
    const oldPass = String(req.body.oldPass);
    const newPass = String(req.body.newPass);
    let user = await User.findOne({ phone, password: oldPass });
    if (!user) return res.json({ success: false, message: "❌ የድሮው ፓስወርድ ትክክል አይደለም!" });
    user.password = newPass; await user.save();
    res.json({ success: true, message: "✅ የይለፍ ቃልዎ በተሳካ ሁኔታ ተቀይሯል!" });
});

app.get('/api/getUser/:phone', async (req, res) => {
    // 🔥 ADVANCED HACKER BLOCKER (ያለ አድሚን እና ዌብሳይት ለውጥ የሚሰራ)
    const referer = req.headers.referer || req.headers.origin || "";
    const userAgent = (req.headers['user-agent'] || "").toLowerCase();
    const fetchSite = req.headers['sec-fetch-site']; // ትክክለኛ ብራውዘር መሆኑን የሚያሳውቅ

    const isFromOurSite = referer.includes("amar-bingo.onrender.com") || referer.includes("amarbingo.onrender.com") || referer.includes("localhost");

    // 1. ሀከሮች የሚጠቀሙትን ሶፍትዌር (Postman, Python, Curl) እና ባዶ ሪኩዌስት ያግዳል
    const isHackerTool = !userAgent || userAgent.includes("postman") || userAgent.includes("python") || userAgent.includes("curl") || userAgent.includes("axios");

    // 2. ጥያቄው የመጣው ከትክክለኛ ብራውዘር ውጪ ከሆነ (Script ከሆነ) ያግዳል
    const isFakeBrowser = fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site';

    if (!isFromOurSite || isHackerTool || isFakeBrowser) {
        console.log(`🚨 HACKER BLOCKED! Phone target: ${req.params.phone}, UA: ${userAgent}`);
        return res.status(403).json({ success: false, message: "❌ Access Denied! የተከለከለ (Security Block)" });
        // ተጫዋቹ ጌሙን ሲከፍት የገባበትን ሰዓት ያድሳል
User.updateOne({ phone: req.params.phone }, { $set: { lastActive: new Date() } }).exec();
    }

    // ከላይ ያሉትን ማጣሪያዎች ካለፈ ብቻ ዳታውን ይሰጣል (አድሚንህ እና ዌብሳይትህ በተለመደው መንገድ ይሰራሉ)
    const user = await User.findOne({ phone: String(req.params.phone) }).select('-password -telegramId -unplayedRealDeposit');
    res.json(user ? { success: true, user } : { success: false, message: "User not found" });
});

const txLocks = new Set();

app.post('/api/request-tx', async (req, res) => {
    try {
        const phone = String(req.body.phone);
        const pass = String(req.body.pass || req.body.password || ""); 
        const type = String(req.body.type);
        const amount = Number(req.body.amount);
        const method = String(req.body.method);
        const sms = String(req.body.sms);
        const destinationPhone = String(req.body.destinationPhone);
        
        const lockKey = `${phone}_${type}`;
        if (txLocks.has(lockKey)) {
            return res.json({ success: false, message: "⚠️ እባክዎ ትንሽ ይጠብቁ... (Please wait)" });
        }
        txLocks.add(lockKey);
        setTimeout(() => txLocks.delete(lockKey), 5000); 

        let user = await User.findOne({ phone: phone }); 
        if(!user) { txLocks.delete(lockKey); return res.json({success: false, message: "User not found!"}); }

        let tenSecondsAgo = new Date(Date.now() - 15000);
        let dupCheck = await Transaction.findOne({ 
            phone: phone, type: type, amount: amount, date: { $gte: tenSecondsAgo } 
        });
        if(dupCheck) {
            txLocks.delete(lockKey);
            return res.json({ success: false, message: "⚠️ ይህ ጥያቄ በቅርቡ ተልኳል (Duplicate request)!" });
        }

        if(type === 'withdraw') {
            if(amount < GLOBAL_SETTINGS.minWithdrawLimit) { txLocks.delete(lockKey); return res.json({success: false, message: `❌ ማውጣት የሚችሉት ቢያንስ ${GLOBAL_SETTINGS.minWithdrawLimit} ብር ነው!`}); }
            if(user.mainBalance < amount) { txLocks.delete(lockKey); return res.json({success: false, message: "በቂ ብር የለም!"}); }
            
            user.mainBalance -= amount; await user.save();
            await new Transaction({ phone, type, amount, method, smsText: `Transfer to: ${destinationPhone || phone}` }).save();
        } else {
            let txRef = getTxRef(sms);
            if (!txRef) { txLocks.delete(lockKey); return res.json({ success: false, message: "❌ ትክክለኛ የባንክ ማረጋገጫ (TxRef) አልተገኘም!" }); }
            if (await isSmsAlreadyUsed(sms)) {
                txLocks.delete(lockKey); return res.json({ success: false, message: "❌ ይህ SMS ቀድሞ ጥቅም ላይ ውሏል!" });
            }
            
            // ጥያቄውን ሴቭ ያደርጋል
            let newTx = await new Transaction({ phone, type, amount, method, smsText: sms, txRef: txRef }).save();
            
            // የባንክ SMS ቀድሞ መጥቶ እንደሆነ ቼክ ያደርጋል
            await autoApprovePendingDeposits();
            
            // 🔴 አዲሱ ማስተካከያ: አሁንም Pending ከሆነ ለተጠቃሚው ሜሴጅ ይልካል
            let checkTx = await Transaction.findById(newTx._id);
            if (checkTx && checkTx.status === 'Pending') {
                if (user.telegramId) {
                    let pendMsg = `⏳ <b>የገቢ ጥያቄዎ በመታየት ላይ ነው!</b>\n\n🧾 <b>ማረጋገጫ (TxRef):</b> ${txRef}\n\nባንኩ ሜሴጅ (SMS) እንደላከልን በሰከንዶች ውስጥ በራሱ አረጋግጦ ሂሳብዎ ላይ ይሞላል። እባክዎ ትንሽ ይጠብቁ...`;
                    bot.sendMessage(user.telegramId, pendMsg, {parse_mode: 'HTML'}).catch(e=>{});
                }
            }
        }
        
        res.json({ success: true, message: "✅ ጥያቄዎ ደርሶናል!" });
    } catch(e) { 
        res.status(500).json({ success: false }); 
    }
});

app.post('/api/promoter/withdraw', async (req, res) => {
    try {
        const phone = String(req.body.phone);
        const pass = String(req.body.pass);
        let user = await User.findOne({ phone, password: pass });
        if (!user || !user.isPromoter) return res.json({ success: false, message: "Unauthorized" });

        let reqAmt = Number(req.body.amount);
        if (isNaN(reqAmt) || reqAmt < 500) return res.json({ success: false, message: "❌ ቢያንስ 500 ብር መሆን አለበት!" });
        if (user.promoterUnpaidBalance < reqAmt) return res.json({ success: false, message: "❌ ያልተከፈለ ቀሪ ሂሳብዎ በቂ አይደለም!" });

        user.promoterUnpaidBalance -= reqAmt;
        await user.save();

        await new Transaction({ phone: user.phone, type: 'withdraw', amount: reqAmt, method: "Promoter Comm", smsText: `Transfer to: ${req.body.account}` }).save();

        res.json({ success: true, message: `✅ የወጪ ጥያቄዎ ለአድሚን ተልኳል!\nበቅርቡ ${reqAmt} ETB ወደ ${req.body.account} ይላካል።` });
    } catch (e) { res.json({ success: false, message: "ስህተት አጋጥሟል" }); }
});

app.get('/api/user/transactions/:phone', async (req, res) => { 
    // ሪኩዌስቱ የመጣው ከራሱ ከዌብሳይትህ (Frontend) መሆኑን ማረጋገጥ
    const referer = req.headers.referer || req.headers.origin || "";
    const isFromOurSite = referer.includes("amar-bingo.onrender.com") || referer.includes("amarbingo.onrender.com") || referer.includes("localhost");
    
    if (!isFromOurSite) {
        // ሀከሩ በ Postman ወይም በሶፍትዌር ዳታ ለመስረቅ ከሞከረ ባዶውን ይመልስለታል
        return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // Players only see wins, deposits, and withdrawals — never bet slips or platform fees.
    const txs = await Transaction.find({ 
        phone: String(req.params.phone),
        type: { $in: ['deposit', 'withdraw', 'win', 'TOURNAMENT_PRIZE'] },
        method: { $ne: 'Promoter Comm' }
    }).select('type amount bonusGiven method status date').sort({ date: -1 }).limit(30); // SMS text እና TxRef ተደብቋል; bet/platform_fee stay admin-only
    
    res.json({ success: true, txs }); 
});

app.get('/api/user/my-active-tickets/:phone', (req, res) => {
    let p = activePlayers[String(req.params.phone)];
    const liveRound = gameState === 'WAITING' || gameState === 'PLAYING';
    const tickets = liveRound ? gameEngine.ticketsForActiveRound(p ? p.ticketsData : [], gameId) : [];
    res.json({ success: true, ticketsData: tickets, calledNumbers: liveRound ? [...calledNumbers] : [], gameState, gameId, currentRoundId: gameId, globalTakenTickets: liveRound ? [...globalTakenTickets] : [] });
});

function seasonSettingsSnapshot() {
    return {
        tournamentSeasonId: GLOBAL_SETTINGS.tournamentSeasonId || '',
        tournamentStartedAt: GLOBAL_SETTINGS.tournamentStartedAt || null,
        tournamentEndsAt: GLOBAL_SETTINGS.tournamentEndsAt || null,
        tournamentStatus: GLOBAL_SETTINGS.tournamentStatus || 'idle'
    };
}

async function ensureSeasonFrozen(now) {
    const state = gameEngine.seasonState(now == null ? Date.now() : now, seasonSettingsSnapshot());
    if (state.elapsed && GLOBAL_SETTINGS.tournamentStatus === 'active') {
        GLOBAL_SETTINGS.tournamentStatus = 'frozen';
        await SystemSettings.updateOne({}, { $set: { tournamentStatus: 'frozen' } });
        invalidateWeeklyLeaderboard();
    }
    return gameEngine.seasonState(now == null ? Date.now() : now, seasonSettingsSnapshot());
}

async function buildWeeklyLeaderboardPayload(now, limit) {
    const state = await ensureSeasonFrozen(now);
    const cap = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 10);
    let rows = [];
    if (state.seasonId) {
        rows = await User.find({ seasonId: state.seasonId, seasonCardsPlayed: { $gt: 0 } })
            .select('name phone seasonCardsPlayed')
            .sort({ seasonCardsPlayed: -1, phone: 1 })
            .limit(cap)
            .lean();
    }
    return {
        success: true,
        leaderboard: gameEngine.shapeCardsLeaderboard(rows).slice(0, cap),
        metric: 'cards',
        metricLabel: 'Cards Played',
        cycle: 'tournament',
        season: {
            seasonId: state.seasonId,
            status: state.status,
            active: state.active,
            frozen: state.frozen,
            startedAt: state.startedAt,
            endsAt: state.endsAt,
            remainingMs: state.remainingMs
        },
        weekKey: state.seasonId || '',
        weekLabel: gameEngine.formatSeasonLabel(state),
        resetsAt: state.endsAt,
        weekStart: state.startedAt,
        resetAt: GLOBAL_SETTINGS.weeklyLeaderboardResetAt || null
    };
}

async function resolvePersonalStanding(phone, seasonId) {
    const key = String(phone || '').trim();
    if (!key) return null;
    let user = null;
    try {
        user = await User.findOne({ phone: key }).select('name phone seasonCardsPlayed seasonId').lean();
    } catch (e) {
        user = null;
    }
    const row = user || { phone: key, name: '', seasonCardsPlayed: 0, seasonId: '' };
    const cards = Math.max(0, Number(row.seasonCardsPlayed) || 0);
    const counted = !!(seasonId && String(row.seasonId || '') === String(seasonId) && cards > 0);
    const ahead = counted
        ? await User.countDocuments(gameEngine.cardStandingAheadFilter(seasonId, cards, key))
        : 0;
    return gameEngine.shapePersonalStanding(row, ahead, seasonId);
}

app.get('/api/leaderboard', async (req, res) => { 
    try {
        const now = Date.now();
        let payload;
        if (weeklyLeaderboardCache.payload && (now - weeklyLeaderboardCache.at) < 15000) {
            payload = weeklyLeaderboardCache.payload;
        } else {
            payload = await buildWeeklyLeaderboardPayload(now, 10, false);
            weeklyLeaderboardCache = { at: now, payload };
        }
        const phone = String(req.query.phone || '').trim();
        if (!phone) return res.json(payload);
        const seasonId = payload && payload.season ? payload.season.seasonId : '';
        const me = await resolvePersonalStanding(phone, seasonId);
        res.json(Object.assign({}, payload, { me }));
    } catch(e) { res.json({ success: false }); }
});

app.get('/api/user/game-history/:phone', async (req, res) => {
    try {
        const phone = String(req.params.phone || '');
        if (!phone) return res.json({ success: false, rounds: [] });
        const limit = gameEngine.parseHistoryLimit(req.query.limit);
        const filter = gameEngine.playerHistoryFilter(phone, req.query.before);
        const games = await GameHistory.find(filter)
            .select(gameEngine.playerHistoryProjection(phone))
            .sort({ date: -1 })
            .limit(limit)
            .lean();
        res.json({
            success: true,
            rounds: gameEngine.shapeHistoryRounds(games, phone),
            limit
        });
    } catch (e) {
        res.json({ success: false, rounds: [] });
    }
});

const promoLocks = new Set();

app.post('/api/claim-promo-code', async (req, res) => {
    try {
        const phone = String(req.body.phone);
        const pass = String(req.body.pass);
        const code = String(req.body.code || "");
        
        if (promoLocks.has(phone)) return res.json({ success: false, message: "⚠️ እባክዎ ይጠብቁ..." });
        promoLocks.add(phone);

        if (!code) { promoLocks.delete(phone); return res.json({ success: false, message: "እባክዎ ኮድ ያስገቡ!" }); }
        let user = await User.findOne({ phone, password: pass });
        if(!user) { promoLocks.delete(phone); return res.json({success: false, message: "User not found!"}); }

        let isJoined = await checkTelegramJoin(user.telegramId);
        if(!isJoined) { promoLocks.delete(phone); return res.json({ success: false, message: `❌ ይህንን ቦነስ ለመውሰድ እባክዎ መጀመሪያ የቴሌግራም ቻናላችንን ይቀላቀሉ! ቻናል: ${GLOBAL_SETTINGS.telegramChannel}` }); }
        
        let promo = await PromoCode.findOne({ code: code.toUpperCase() });
        if (!promo) { promoLocks.delete(phone); return res.json({ success: false, message: "ትክክለኛ ያልሆነ ኮድ!" }); }
        
        if (new Date(promo.expiresAt) < new Date()) { promoLocks.delete(phone); return res.json({ success: false, message: "የዚህ ኩፖን ጊዜ አልፏል!" }); }
        if (promo.currentUses >= promo.maxUses) { promoLocks.delete(phone); return res.json({ success: false, message: "ይቅርታ! ይህ ኩፖን በሌሎች ሰዎች ሙሉ በሙሉ ጥቅም ላይ ውሏል።" }); }
        if (promo.usedBy.includes(user.phone)) { promoLocks.delete(phone); return res.json({ success: false, message: "እርስዎ ይህንን ኩፖን ቀድመው ወስደዋል!" }); }
        
        if (promo.requireDeposit) {
            let minDep = promo.minDepositAmount || 0;
            if (promo.requireDepositWithinHours > 0) {
                let cutoff = new Date(Date.now() - (promo.requireDepositWithinHours * 60 * 60 * 1000));
                // የተቆራረጡም ሆነ በአንድ ጊዜ የገቡ ዴፖዚቶችን ፈልጎ ድምሩን ያሰላል
                let recentDeps = await Transaction.find({ phone: user.phone, type: 'deposit', status: 'Approved', date: { $gte: cutoff } });
                let totalRecent = recentDeps.reduce((sum, tx) => sum + tx.amount, 0);
                
                if (totalRecent < minDep) {
                    promoLocks.delete(phone);
                    return res.json({ success: false, message: `ይህንን የፕሮሞ ኮድ ለመጠቀም ባለፉት ${promo.requireDepositWithinHours} ሰዓታት ውስጥ ጠቅላላ ቢያንስ ${minDep} ብር ገቢ አድርገው መሆን አለበት! (ያለዎት: ${totalRecent} ብር)` });
                }
            } else {
                // የትኛውንም ጊዜ የተቆራረጡም ሆነ በአንድ ጊዜ የገቡትን ድምር ያሰላል
                let allDeps = await Transaction.find({ phone: user.phone, type: 'deposit', status: 'Approved' });
                let totalAll = allDeps.reduce((sum, tx) => sum + tx.amount, 0);
                
                if (totalAll < minDep) {
                    promoLocks.delete(phone);
                    return res.json({ success: false, message: `ይህንን የፕሮሞ ኮድ ለመጠቀም ጠቅላላ ቢያንስ ${minDep} ብር ገቢ (Deposit) አድርገው መሆን አለበት! (ያለዎት: ${totalAll} ብር)` });
                }
            }
        }

        promo.usedBy.push(user.phone);
        promo.currentUses += 1;
        await promo.save();
        
        user.playBalance += promo.amount;
        await user.save();
        io.emit('balance_updated', user.phone);
        
        promoLocks.delete(phone);
        res.json({ success: true, message: `እንኳን ደስ አሎት! የ ${promo.amount} ETB ቦነስ አግኝተዋል!`, amount: promo.amount });
    } catch(e) { promoLocks.delete(String(req.body.phone)); res.json({success: false}); }
});

app.post('/api/claim-promo-web', async (req, res) => {
    try {
        let phone = String(req.body.phone);
        if (promoLocks.has(phone)) return res.json({ success: false, message: "⚠️ እባክዎ ይጠብቁ..." });
        promoLocks.add(phone);

        let user = await User.findOne({ phone: phone });
        if(!user) { promoLocks.delete(phone); return res.json({success: false, message: "User not found!"}); }

        let isJoined = await checkTelegramJoin(user.telegramId);
        if(!isJoined) { promoLocks.delete(phone); return res.json({ success: false, message: `❌ ይህንን ቦነስ ለመውሰድ እባክዎ መጀመሪያ የቴሌግራም ቻናላችንን ይቀላቀሉ! ቻናል: ${GLOBAL_SETTINGS.telegramChannel}` }); }
        
        let activeBonus = await ActiveBonus.findOne({ isActive: true, expiresAt: { $gt: new Date() } });
        if (!activeBonus) { promoLocks.delete(phone); return res.json({ success: false, message: "❌ ፕሮሞው አልቋል ወይም ጊዜው አልፏል!" }); }
        if (activeBonus.currentClaims >= activeBonus.maxUsers) { promoLocks.delete(phone); return res.json({ success: false, message: "❌ ይቅርታ! የሰው ኮታ ሞልቷል።" }); }
        if (activeBonus.claimedBy.includes(user.phone)) { promoLocks.delete(phone); return res.json({ success: false, message: "❌ እርስዎ ይህንን ቦነስ ቀድመው ወስደዋል!" }); }
        
        if (activeBonus.depositorsOnly) {
            let minDep = activeBonus.minDepositAmount || 0;
            if (activeBonus.requireDepositWithinHours > 0) {
                let cutoff = new Date(Date.now() - (activeBonus.requireDepositWithinHours * 60 * 60 * 1000));
                let recentDep = await Transaction.findOne({
                    phone: user.phone,
                    type: 'deposit',
                    status: 'Approved',
                    date: { $gte: cutoff },
                    amount: { $gte: minDep }
                });
                if (!recentDep) {
                    promoLocks.delete(phone);
                    return res.json({ success: false, message: `ይህንን ቦነስ ለማግኘት ባለፉት ${activeBonus.requireDepositWithinHours} ሰዓታት ውስጥ ቢያንስ ${minDep} ብር ገቢ አድርገው መሆን አለበት!` });
                }
            } else {
                let validDep = await Transaction.findOne({ phone: user.phone, type: 'deposit', status: 'Approved', amount: { $gte: minDep } });
                if (!validDep) {
                    promoLocks.delete(phone);
                    return res.json({ success: false, message: `ይህንን ቦነስ ለማግኘት ቢያንስ ${minDep} ብር ገቢ (Deposit) አድርገው መሆን አለበት!` });
                }
            }
        }

        activeBonus.claimedBy.push(user.phone);
        activeBonus.currentClaims += 1;
        await activeBonus.save();
        
        user.playBalance += activeBonus.amount;
        await user.save();
        io.emit('balance_updated', user.phone);
        
        promoLocks.delete(phone);
        res.json({ success: true, amount: activeBonus.amount });
    } catch(e) { promoLocks.delete(String(req.body.phone)); res.json({success: false}); }
});

const auth = (req, res, next) => { 
    const pass = String(req.body.adminPass || ""); 
    if(pass !== GLOBAL_SETTINGS.adminPass) return res.status(401).json({error:"Unauthorized"}); 
    next(); 
};

const financeAuth = (req, res, next) => { 
    const pass = String(req.body.adminPass || req.body.financePass || ""); 
    if(pass !== GLOBAL_SETTINGS.financePass && pass !== GLOBAL_SETTINGS.adminPass) {
        return res.status(401).json({error:"Unauthorized"}); 
    }
    next(); 
};

app.post('/api/admin/wipe-fake-balances', auth, async (req, res) => {
    try {
        let result = await User.updateMany(
            { totalDeposited: 0, $or: [{ totalInvites: { $gt: 5 } }, { playBalance: { $gt: 50 } }] },
            { $set: { playBalance: 0, totalInvites: 0, inviteBonusEarned: 0, compensatedInvites: 0 } }
        );
        res.json({ success: true, message: `✅ በተሳካ ሁኔታ ${result.modifiedCount} የውሸት አካውንቶች እና የሰረቁት ቦነስ ዜሮ ገብቷል!` });
    } catch (e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

// 🔥 SECURITY FIX: የውሸት (Bot) ሪፈራሎችን ማጥፊያ እና ብር ማስመለሻ
app.post('/api/admin/delete-fake-referrals', auth, async (req, res) => {
    try {
        // 1. ምንም ብር ሳያስገቡ ብዙ ሰው የጋበዙትን (ሌቦቹን) እንፈልጋለን
        let scammers = await User.find({ totalDeposited: 0, totalInvites: { $gt: 5 } });

        let totalFakesDeleted = 0;
        let totalBonusRecovered = 0;

        for (let scammer of scammers) {
            // 2. ሌባው የጋበዛቸውን እና "ምንም ብር ያላስገቡትን የውሸት አካውንቶች" እንፈልጋለን
            let fakeAccounts = await User.find({ referredBy: scammer.phone, totalDeposited: 0 });

            for (let fake of fakeAccounts) {
                // 3. የውሸት አካውንቱን ከዳታቤዝ እናጠፋዋለን
                await User.findByIdAndDelete(fake._id);
                totalFakesDeleted++;

                // 4. ሌባው ከዚህ አካውንት የሰረቀውን 10 ብር ከሂሳቡ ላይ እንቀንሳለን
                scammer.playBalance -= GLOBAL_SETTINGS.inviteBonus;
                scammer.inviteBonusEarned -= GLOBAL_SETTINGS.inviteBonus;
                scammer.totalInvites -= 1;

                if (scammer.playBalance < 0) scammer.playBalance = 0;
                if (scammer.inviteBonusEarned < 0) scammer.inviteBonusEarned = 0;
                if (scammer.totalInvites < 0) scammer.totalInvites = 0;
                totalBonusRecovered += GLOBAL_SETTINGS.inviteBonus;
            }
            await scammer.save();
        }

        res.json({ 
            success: true, 
            message: `✅ የፅዳት ስራው ተጠናቋል!\n\n🗑️ የጠፉ የውሸት አካውንቶች: ${totalFakesDeleted}\n💰 የተመለሰ የተሰረቀ ቦነስ: ${totalBonusRecovered} ETB` 
        });
    } catch (e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

app.post('/api/admin/manual-receipt-deposit', auth, async (req, res) => {
    try {
        const { phone, amount, txRef, bank } = req.body;
        let user = await User.findOne({ phone: String(phone) });
        if (!user) return res.json({ success: false, message: "❌ ተጠቃሚው አልተገኘም!" });

        if (!txRef || !amount) return res.json({ success: false, message: "❌ እባክዎ ደረሰኝ እና የብር መጠን ያስገቡ!" });
        
        let isUsed = await isSmsAlreadyUsed(txRef);
        if (isUsed) return res.json({ success: false, message: "❌ ይቅርታ! ይህ ደረሰኝ (TxRef) ቀድሞ ጥቅም ላይ ውሏል!" });

        let actualAmount = Number(amount);
        let bonus = applyConfiguredDepositBonus(actualAmount, user).bonus;

        await new Transaction({
            phone: user.phone,
            type: 'deposit',
            amount: actualAmount,
            method: bank || 'Manual Admin',
            status: 'Approved',
            txRef: txRef,
            smsText: `Admin Manual Deposit - TxRef: ${txRef}`
        }).save();

        user.playBalance += (actualAmount + bonus);
        user.totalDeposited += actualAmount;
        user.unplayedRealDeposit += actualAmount;
        creditUserDailyDeposit(user, actualAmount); 

        commitDepositVaultSplit(actualAmount);

        if(user.referredBy && user.referredViaPromo) {
            let promoter = await User.findOne({ phone: user.referredBy, isPromoter: true });
            if(promoter) {
                let commission = actualAmount * (promoter.promoterPercent / 100);
                promoter.promoterUnpaidBalance += commission; 
                promoter.promoterEarned += commission;
                await promoter.save();
                user.promoterCommissionGenerated += commission;
                io.emit('balance_updated', promoter.phone);
                
                if(promoter.telegramId) {
                    let msg = `🎉 <b>የኮሚሽን ገቢ!</b>\n\nበእርስዎ የጋባዥ ሊንክ የመጣው <b>${user.name}</b> አሁን ገቢ አድርጓል።\n\n💰 <b>የእርስዎ ኮሚሽን:</b> +${commission} ETB\n💸 <b>ያልተከፈለ አጠቃላይ ኮሚሽን:</b> ${promoter.promoterUnpaidBalance} ETB`;
                    bot.sendMessage(promoter.telegramId, msg, {parse_mode: 'HTML'}).catch(e=>{});
                }
            }
        }

        if (!user.hasMadeFirstDeposit) user.hasMadeFirstDeposit = true;
        await user.save();

        io.emit('balance_updated', user.phone);
        if (bonus > 0) io.emit('deposit_bonus_alert', { phone: user.phone, depositAmount: actualAmount, bonusAmount: bonus });

        res.json({ success: true, message: `✅ በተሳካ ሁኔታ የ ${actualAmount} ETB ዴፖዚት ለ ${user.name} ገቢ ተደርጓል!` });
    } catch (e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

app.post('/api/admin/inject-jackpot-bonus', auth, (req, res) => {
    let amount = Number(req.body.amount);
    if(amount && amount > 0) {
        jackpotBoostAmount += amount; 
        totalPrizePool += amount;     
        
        io.emit('game_status', { 
            state: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState, timer: gameClock, totalPrizePool, jackpotBoost: jackpotBoostAmount,
            totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, vaultTransferEnabled: GLOBAL_SETTINGS.vaultTransferEnabled !== false, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, 
            maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit, cardGridSeed: roundCardGridSeed 
        });
        
        res.json({ success: true, message: `✅ በተሳካ ሁኔታ ${amount} ETB ደራሽ ላይ ተጨምሯል!` });
    } else {
        res.json({ success: false, message: "❌ ትክክለኛ የብር መጠን ያስገቡ!" });
    }
});

app.post('/api/admin/bot-add-custom', auth, async (req, res) => {
    try {
        let amount = parseInt(req.body.amount);
        if(!amount || amount <= 0) return res.json({success:false, message:"Invalid amount"});
        
        const existing = await BotUser.find({}, 'name').lean();
        const reserved = existing.map((bot) => bot.name);
        const names = gameEngine.generateUniqueBotNames(amount, reserved, gameEngine.MALE_ETH_BOT_NAMES);
        for (let i = 0; i < names.length; i++) {
            let rndPhone = "09" + Math.floor(10000000 + Math.random() * 90000000);
            await new BotUser({ name: names[i], phone: rndPhone, isActive: true, cardsCount: 1 }).save();
        }
        res.json({ success: true, message: `Successfully added ${names.length} new bots.` });
    } catch(e) { res.json({ success: false, message: "Error adding bots" }); }
});

app.post('/api/admin/bots-rename-all', auth, async (req, res) => {
    try {
        let limit = parseInt(req.body.limit, 10) || 0;
        const filter = gameEngine.botListFilter(req.body.search);
        let query = BotUser.find(filter).select('name phone isActive').sort({ _id: -1 });
        if (limit > 0) query = query.limit(limit);
        const loaded = await query.exec();
        const targets = gameEngine.selectBotsForRename(loaded);
        if (!targets.length) {
            return res.json({ success: true, message: 'No bots to rename. Real player accounts were left unchanged.' });
        }

        const renamingIds = targets.map((bot) => bot._id);
        const others = await BotUser.find({ _id: { $nin: renamingIds } }, 'name').lean();
        const reserved = [];
        for (let i = 0; i < others.length; i++) reserved.push(others[i].name);
        const idleBefore = new Date(Date.now() - gameEngine.INACTIVE_PLAYER_IDLE_MS);
        const inactiveUsers = await User.find(
            {
                status: { $nin: ['banned', 'Banned', 'BANNED', 'deleted', 'Deleted', 'DELETED', 'disabled', 'Disabled', 'DISABLED'] },
                $or: [
                    { status: { $in: ['inactive', 'Inactive', 'INACTIVE', 'idle', 'Idle', 'IDLE'] } },
                    { status: { $in: ['active', 'Active', 'ACTIVE'] }, lastActive: { $lt: idleBefore } },
                    { status: { $exists: false }, lastActive: { $lt: idleBefore } }
                ]
            },
            { name: 1, status: 1, lastActive: 1, _id: 0 }
        ).lean();
        const pool = gameEngine.collectInactiveUserNames(inactiveUsers);
        if (!pool.length) {
            return res.json({ success: true, message: 'No inactive user names available. Active users were not used, and no bots were renamed.' });
        }
        const planned = gameEngine.planUniqueInactiveRenames(targets, {
            reserved: reserved,
            pool: pool
        });
        const updates = planned.updates || [];
        const styledNames = gameEngine.applyBotUsernameStyles(updates, {
            styleAt: req.body.styleAt === true,
            styleCaps: req.body.styleCaps === true,
            styleHyphen: req.body.styleHyphen === true,
            reserved: reserved
        });
        const ops = [];
        const writtenKeys = new Set();
        for (let i = 0; i < reserved.length; i++) {
            const key = gameEngine.botNameKey(reserved[i]);
            if (key) writtenKeys.add(key);
        }
        for (let i = 0; i < updates.length; i++) {
            const key = gameEngine.botNameKey(updates[i].name);
            if (!key || writtenKeys.has(key)) continue;
            writtenKeys.add(key);
            ops.push({
                updateOne: {
                    filter: { _id: updates[i]._id },
                    update: { $set: { name: updates[i].name } }
                }
            });
        }
        let renamed = 0;
        if (ops.length) {
            const written = await BotUser.bulkWrite(ops, { ordered: false });
            renamed = written && (written.modifiedCount || written.nModified) || 0;
        }
        const skipped = planned.skipped || 0;
        if (!renamed) {
            return res.json({ success: true, message: skipped
                ? 'No bot names were changed. There are not enough unused inactive user names for a unique name per bot, and player accounts were not changed.'
                : 'No bot names were changed. Each bot already has a unique inactive user name, and player accounts were not changed.' });
        }
        const short = skipped ? ' ' + skipped + ' bots were left unchanged because no unused inactive name remained.' : '';
        const styleNote = styledNames.styled ? ' ' + styledNames.styled + ' of them use the selected username style.' : '';
        res.json({ success: true, message: `Renamed ${renamed} bots. Each name is a different inactive user name, and no name is shared with another bot.${styleNote}${short} Player accounts were not changed.` });
    } catch(e) { 
        res.json({ success: false }); 
    }
});

// 👇 አዲሱ ነጠላ ቦት ማጥፊያ ኮድ (ከ bots-rename-all በታች አስገባው) 👇

app.post('/api/admin/delete-bot', auth, async (req, res) => {
    try {
        await BotUser.findByIdAndDelete(req.body.id);
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

// 👆 እስከዚህ 👆

const botRoutes = require('./bots/bot.routes');
app.use('/api/admin', botRoutes(SystemSettings, loadSettings, auth));

app.post('/api/admin/finance-raw-data', financeAuth, async (req, res) => {
    try {
        // 🔥 .lean() ሚሞሪ (RAM) እንዳይሞላ እና ሰርቨር እንዳይዘጋ በጣም ይረዳል!
        let txs = await Transaction.find({ status: { $in: ['Approved', 'Pending'] } }).sort({date: -1}).limit(500).lean();
        let games = await GameHistory.find().sort({date: -1}).limit(100).lean();
        let bonuses = await ActiveBonus.find().sort({date: -1}).limit(50).lean();
        let users = await User.find({}, 'mainBalance playBalance').lean(); 
        res.json({ success: true, txs, games, bonuses, users, settings: GLOBAL_SETTINGS });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/finance-stats', financeAuth, async (req, res) => {
    try {
        const { period, customDate, rangeStart, rangeEnd } = req.body;
        let dateQuery = {};
        let now = new Date();

        if (period === 'daily') {
            let start = new Date(); start.setHours(0, 0, 0, 0); dateQuery = { $gte: start };
        } else if (period === 'weekly') {
            let start = new Date(); start.setDate(now.getDate() - 7); start.setHours(0, 0, 0, 0); dateQuery = { $gte: start };
        } else if (period === 'monthly') {
            let start = new Date(now.getFullYear(), now.getMonth(), 1); dateQuery = { $gte: start };
        } else if (period === 'custom' && customDate) {
            let start = new Date(customDate); let end = new Date(customDate); end.setHours(23, 59, 59, 999); dateQuery = { $gte: start, $lte: end };
        } else if (period === 'range' && rangeStart && rangeEnd) {
            let start = new Date(rangeStart); let end = new Date(rangeEnd); end.setHours(23, 59, 59, 999); dateQuery = { $gte: start, $lte: end };
        }

        let txQuery = { status: 'Approved' };
        let gameQuery = {};
        let bonusQuery = {};
        
        if (Object.keys(dateQuery).length > 0) {
            txQuery.date = dateQuery; gameQuery.date = dateQuery; bonusQuery.date = dateQuery;
        }

        // 🔥 የዕለቱን የባንክ ዝውውር ማውጫ
        let txAgg = await Transaction.aggregate([
            { $match: txQuery },
            { $group: { 
                _id: { type: "$type", method: "$method" }, 
                totalAmount: { $sum: "$amount" } 
            }}
        ]);

        let tDep = 0, tWit = 0, tPromoterPaid = 0;
        txAgg.forEach(t => {
            if (t._id.type === 'deposit') tDep += t.totalAmount;
            if (t._id.type === 'withdraw' && t._id.method !== 'Promoter Comm') tWit += t.totalAmount;
            if (t._id.type === 'withdraw' && t._id.method === 'Promoter Comm') tPromoterPaid += t.totalAmount;
        });
        let netCash = tDep - (tWit + tPromoterPaid);

        let gameAgg = await GameHistory.aggregate([
            { $match: gameQuery },
            { $group: {
                _id: null,
                totalWinnings: { $sum: "$prize" },
                totalAdminProfit: { $sum: "$adminProfit" }
            }}
        ]);
        
        let tWinnings = gameAgg.length > 0 ? gameAgg[0].totalWinnings : 0;
        let tProf = gameAgg.length > 0 ? gameAgg[0].totalAdminProfit : 0;
        let tTurnover = tWinnings + tProf;

        let bonusAgg = await ActiveBonus.aggregate([
            { $match: bonusQuery },
            { $group: { _id: null, totalBonusPaid: { $sum: { $multiply: ["$amount", "$currentClaims"] } } } }
        ]);
        let totalBonusPaid = bonusAgg.length > 0 ? bonusAgg[0].totalBonusPaid : 0;

        let usersResult = await User.aggregate([
            { 
                $group: { 
                    _id: null, 
                    mainAll: { $sum: "$mainBalance" }, 
                    playAll: { $sum: "$playBalance" },
                    mainAbove100: { $sum: { $cond: [ { $gte: ["$mainBalance", 100] }, "$mainBalance", 0 ] } }
                } 
            }
        ]);
        
        let totalPlayBalance = usersResult.length > 0 ? usersResult[0].playAll : 0;
        let liability = (usersResult.length > 0 ? usersResult[0].mainAll : 0) + totalPlayBalance; 

        // 🔥 THE FIX: ልክ እንደ አድሚኑ የየዕለቱን የዋና ሂሳብ ቀሪ (Live Balance) ማውጫ
        let totalMainBalance = 0;
        if (period === 'all') {
            // 'አጠቃላይ' ሲመረጥ ከ 100 ብር በላይ ያላቸውን ደምሮ ያሳያል
            totalMainBalance = usersResult.length > 0 ? usersResult[0].mainAbove100 : 0; 
        } else {
            // የዛሬ፣ የትናንት ወይም የተወሰነ ቀን ሲመረጥ፣ በዛ ቀን ያሸነፉትን ሰዎች ፈልጎ፣ 
            // መልሰው የተጫወቱበትን ቀንሶ "አሁን እጃቸው ላይ (Wallet ላይ) ያለውን" ትክክለኛ ቀሪ ብር ይደምራል (ልክ እንደ አድሚኑ!)
            let periodWinTxs = await Transaction.find({ type: 'win', date: dateQuery }).select('phone').lean();
            let periodWinnerPhones = [...new Set(periodWinTxs.map(t => t.phone))];
            
            let periodWinners = await User.find({ phone: { $in: periodWinnerPhones } }).select('mainBalance').lean();
            totalMainBalance = periodWinners.reduce((sum, u) => sum + (u.mainBalance || 0), 0);
        }

        let netProfit = dailyHouseProfit - totalBonusPaid - tPromoterPaid; 

        res.json({ success: true, stats: { tDep, tWit, netCash, tTurnover, tWinnings, tProf, totalBonusPaid, tPromoterPaid, liability, totalMainBalance, totalPlayBalance, netProfit } });
    } catch (e) { 
        console.error("Finance Stats Error:", e);
        res.status(500).json({ success: false }); 
    }
});

app.post('/api/admin/users', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = parseInt(req.body.limit) || 30;
        let search = String(req.body.search || '');
        let query = buildAdminUserSearchQuery(search);

        let total = await User.countDocuments(query);
        let users = await User.find(query).sort({ _id: -1 }).skip((page - 1) * limit).limit(limit);

        let phoneList = users.map(u => u.phone);
        let actualInviteCounts = await User.aggregate([
            { $match: { referredBy: { $in: phoneList } } },
            { $group: { _id: "$referredBy", count: { $sum: 1 } } }
        ]);
        let inviteMap = {};
        actualInviteCounts.forEach(i => inviteMap[i._id] = i.count);

        let updatedUsers = [];
        for (let u of users) {
            let userObj = u.toObject();
            let trueCount = inviteMap[userObj.phone] || 0;
            
            userObj.totalInvites = Math.max(userObj.totalInvites || 0, trueCount);
            if (!userObj.isPromoter) {
                userObj.inviteBonusEarned = Math.max(userObj.inviteBonusEarned || 0, trueCount * GLOBAL_SETTINGS.inviteBonus);
            }
            updatedUsers.push(userObj);
            
            if ((u.totalInvites || 0) < trueCount || (!u.isPromoter && (u.inviteBonusEarned || 0) < (trueCount * GLOBAL_SETTINGS.inviteBonus))) {
                User.updateOne({ phone: u.phone }, { $set: { totalInvites: userObj.totalInvites, inviteBonusEarned: userObj.inviteBonusEarned } }).exec();
            }
        }

        res.json({ success: true, users: updatedUsers, total, settings: GLOBAL_SETTINGS });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/transactions', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = parseInt(req.body.limit) || 30;
        let search = String(req.body.search || '').trim();
        let type = String(req.body.type || 'deposit');
        
        let query = { hiddenFromAdmin: { $ne: true } }; 

        if (search) {
            // 🔥 ፍለጋ ካለ Tab ሳይለይ (Deposit/Withdraw ሳይል) በሙሉ ዳታቤዝ ይፈልጋል
            query.$or = [
                { phone: new RegExp(search, 'i') },
                { txRef: new RegExp(search, 'i') },
                { smsText: new RegExp(search, 'i') }
            ];
        } else {
            // ፍለጋ ከሌለ በተለመደው መንገድ በታብ ይለያል
            if (req.body.isPending) {
                query.status = 'Pending';
            } else if (type === 'rejected') { 
                query.status = 'Rejected'; 
            } else if (type === 'win') {
                query.type = 'win';
                query.status = 'Approved';
            } else { 
                query.type = type; 
                query.status = 'Approved'; 
            }
        }
        
        let total = await Transaction.countDocuments(query);
        let txs = await Transaction.find(query).sort({ date: -1 }).skip((page - 1) * limit).limit(limit).lean();
        res.json({
            success: true,
            txs,
            total,
            birrBalance: birrBalance.roundBirr(GLOBAL_SETTINGS.birrBalance),
            birrBalanceVersion: birrBalanceVersion
        });
    } catch(e) { 
        res.json({ success: false }); 
    }
});

app.post('/api/admin/history', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = gameEngine.parseAdminHistoryLimit(req.body.limit);
        let search = String(req.body.search || '');
        
        let query = {};
        
        if (search) {
            query.$or = [
                { winnerPhone: new RegExp(search, 'i') },
                { winnerId: new RegExp(search, 'i') },
                { ticketId: new RegExp(search, 'i') } 
            ];
            if(!isNaN(search)) {
                query.$or.push({ gameId: Number(search) });
                query.$or.push({ roundId: Number(search) });
            }
        }

        let total = search
            ? await GameHistory.countDocuments(query)
            : await GameHistory.estimatedDocumentCount();
        
        let history = await GameHistory.find(query)
                                     .select(gameEngine.adminHistoryListProjection())
                                     .sort({ date: -1 })
                                     .skip((page - 1) * limit)
                                     .limit(limit)
                                     .lean();
                                     
        res.json({ success: true, history, total, limit });
    } catch(e) { 
        res.json({ success: false }); 
    }
});

async function attachStoredCardSnapshots(game) {
    if (!game) return game;
    const gid = Number(game.gameId != null ? game.gameId : game.roundId);
    let entries = [];
    if (Number.isFinite(gid)) {
        try {
            entries = await RoundEntry.find({ gameId: gid, status: { $ne: 'cancelled' } }).lean();
        } catch (e) {}
    }
    return gameEngine.applyCardSnapshots(game, entries);
}

app.post('/api/admin/history-detail', auth, async (req, res) => {
    try {
        const id = String(req.body.id || '');
        if (!id) return res.json({ success: false });
        const game = await GameHistory.findById(id).lean();
        if (game) await attachStoredCardSnapshots(game);
        res.json({ success: !!game, game });
    } catch (e) {
        res.json({ success: false });
    }
});

app.get('/api/v1/admin/games/:id', async (req, res) => {
    const pass = String((req.query && req.query.adminPass) || (req.body && req.body.adminPass) || req.get('x-admin-pass') || '');
    if (pass !== GLOBAL_SETTINGS.adminPass) return res.status(401).json({ error: 'Unauthorized' });
    try {
        const key = String(req.params.id || '');
        let game = null;
        if (mongoose.Types.ObjectId.isValid(key) && key.length === 24) {
            game = await GameHistory.findById(key).lean();
        }
        const numeric = Number(key);
        if (!game && Number.isFinite(numeric)) {
            game = await GameHistory.findOne({ $or: [{ gameId: numeric }, { roundId: numeric }] }).sort({ date: -1 }).lean();
        }
        if (!game && Number.isFinite(numeric) && numeric === Number(gameId)) {
            game = {
                gameId,
                roundId: gameId,
                calledNumbers: calledNumbers.slice(),
                ticketPrice: GLOBAL_SETTINGS.ticketPrice, vaultTransferEnabled: GLOBAL_SETTINGS.vaultTransferEnabled !== false,
                playersData: playersDataWithAssignedGrids(activePlayers),
                live: true
            };
        }
        if (!game) return res.status(404).json({ success: false });
        if (game && game.live) {
            game.calledNumbers = calledNumbers.slice();
            game.playersData = adminLiveView.playersForAdmin(Object.values(activePlayers), calledNumbers, (ticket) => assignedCardGrid(ticket));
        } else {
            await attachStoredCardSnapshots(game);
        }
        res.json({ success: true, game });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/search-bets', auth, async (req, res) => {
    try {
        let search = String(req.body.search || '').trim();
        const pageSize = Math.min(30, Math.max(1, parseInt(req.body.pageSize, 10) || 15));
        let page = Math.max(1, parseInt(req.body.page, 10) || 1);
        if (!search) return res.json({ success: true, games: [], total: 0, page: 1, pageSize, totalPages: 1 });

        const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let query = { $or: [
            { "playersData.phone": new RegExp(safeSearch, 'i') }
        ] };
        if (!isNaN(search)) {
            query.$or.push({ "playersData.ticketsData.id": Number(search) });
            query.$or.push({ gameId: Number(search) });
        }

        const total = await GameHistory.countDocuments(query);
        const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
        if (page > totalPages) page = totalPages;
        let games = await GameHistory.find(query)
            .sort({ date: -1 })
            .skip((page - 1) * pageSize)
            .limit(pageSize)
            .lean();
        for (let i = 0; i < games.length; i++) {
            gameEngine.keepPlayedSearchGrids(games[i]);
            adminLiveView.decoratePlayedGame(games[i]);
        }
        const live = adminLiveView.findLiveSearchMatch(Object.values(activePlayers), search, {
            calledNumbers,
            gameId,
            gameState: GLOBAL_SETTINGS.isGamePaused ? 'MAINTENANCE' : gameState,
            ticketPrice: GLOBAL_SETTINGS.ticketPrice, vaultTransferEnabled: GLOBAL_SETTINGS.vaultTransferEnabled !== false,
            gridOf: (ticket) => assignedCardGrid(ticket)
        });
        res.json({ success: true, games, total, page, pageSize, totalPages, live });
    } catch (e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/user-details', auth, async (req, res) => {
    try {
        let phone = String(req.body.phone);
        let txs = await Transaction.find({ phone: phone, hiddenFromAdmin: { $ne: true } }).sort({ date: -1 }).limit(100);
        
        let allTxs = await Transaction.find({ phone: phone, status: 'Approved' }).select('type amount bonusGiven').lean();
        let aggDep = 0, aggWit = 0, aggBonus = 0, aggWin = 0;
        allTxs.forEach(t => {
            if(t.type === 'deposit') { aggDep += t.amount; aggBonus += (t.bonusGiven || 0); }
            if(t.type === 'withdraw') { aggWit += t.amount; }
            if(t.type === 'win') { aggWin += t.amount; }
        });

        const historyGames = await GameHistory.find({
            $or: [{ participantPhones: phone }, { 'playersData.phone': phone }]
        }).select('gameId date ticketId winnerPhone winnerPhoneList winnerPayout prize playersData.phone playersData.ticketsData.id playersData.tickets').sort({ date: -1 }).limit(40).lean();

        const completedBets = historyGames.map((g) => {
            const player = (g.playersData || []).find((p) => String(p.phone) === phone) || {};
            const cardIds = (player.ticketsData || []).map((t) => Number(t.id)).filter(Boolean);
            const winnerList = gameEngine.winnerListFromGame(g);
            const won = winnerList.some((w) => w === phone || w.indexOf(phone) !== -1);
            const winnerCount = gameEngine.historyWinnerCount(g, won);
            return {
                gameId: g.gameId,
                date: g.date,
                cardIds,
                ticketCount: cardIds.length || player.tickets || 0,
                won,
                winnerCount,
                payout: won ? gameEngine.historySplitPayout(g, winnerCount) : 0,
                status: 'completed'
            };
        });

        const livePlayer = activePlayers[phone];
        const liveRound = adminLiveView.liveRoundForPhone(livePlayer, {
            gameId,
            gameState: GLOBAL_SETTINGS.isGamePaused ? 'MAINTENANCE' : gameState,
            calledNumbers,
            gridOf: (ticket) => assignedCardGrid(ticket)
        });
        const activeBets = [];
        if (livePlayer && Array.isArray(livePlayer.ticketsData) && livePlayer.ticketsData.length) {
            activeBets.push({
                gameId,
                date: new Date(),
                cardIds: (liveRound ? liveRound.cards : livePlayer.ticketsData).map((t) => Number(t.id)).filter(Boolean),
                ticketCount: livePlayer.tickets || livePlayer.ticketsData.length,
                won: false,
                payout: 0,
                status: gameState === 'PLAYING' ? 'locked' : 'active',
                live: true,
                cards: liveRound ? liveRound.cards : [],
                calledNumbers: liveRound ? liveRound.calledNumbers : []
            });
        }

        res.json({ success: true, txs, aggDep, aggWit, aggBonus, aggWin, bets: { active: activeBets, completed: completedBets }, liveRound });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/live-players-list', auth, (req, res) => {
    try {
        const players = adminLiveView.playersForAdmin(Object.values(activePlayers), calledNumbers, (ticket) => assignedCardGrid(ticket));
        res.json({
            success: true,
            players,
            calledNumbers: calledNumbers.slice(),
            gameId,
            gameState: GLOBAL_SETTINGS.isGamePaused ? 'MAINTENANCE' : gameState
        });
    } catch (e) {
        res.json({ success: false, message: "Error fetching live players" });
    }
});

app.post('/api/admin/audience', auth, async (req, res) => {
    try {
        const filter = req.body.filter === 'activity' ? 'activity' : 'target';
        const pageSize = Math.min(30, Math.max(1, parseInt(req.body.pageSize, 10) || 15));
        const search = String(req.body.search || '').trim();
        const now = Date.now();
        const eligCtx = { now, activeCooldowns, timeBans };
        const gameLabel = GLOBAL_SETTINGS.isGamePaused ? 'MAINTENANCE' : gameState;

        if (filter === 'target') {
            const docs = await User.find({ totalDeposited: { $gt: 0 }, status: { $ne: 'banned' } })
                .select('phone name firstName totalDeposited totalWithdrawn depositTodayEtb dailyRealBets dailyWins eatDayKey won roundsTodayWithoutWin winsToday')
                .lean();
            const grouped = adminLiveView.partitionTargetUsers(docs, eligCtx);
            const group = req.body.group === 'users40' ? 'users40' : 'target60';
            const pageResult = adminLiveView.paginateRows(adminLiveView.filterBySearch(grouped[group], search), req.body.page, pageSize);
            return res.json({
                success: true,
                filter,
                group,
                counts: { target60: grouped.target60.length, users40: grouped.users40.length },
                ...pageResult
            });
        }

        const activeRows = adminLiveView.activePlayerRows(Object.values(activePlayers), {
            now,
            activeCooldowns,
            timeBans,
            gameId,
            gameState: gameLabel,
            calledNumbers,
            gridOf: (ticket) => assignedCardGrid(ticket)
        });
        const phones = Object.keys(activeCooldowns).concat(Object.keys(timeBans));
        const unique = Array.from(new Set(phones));
        const profiles = unique.length
            ? await User.find({ phone: { $in: unique } }).select('phone name firstName telegramUsername telegramId').lean()
            : [];
        const usersByPhone = {};
        profiles.forEach((user) => { usersByPhone[String(user.phone)] = user; });
        const penalties = cooldownManager.listPenalties({
            now,
            roundMs: penaltyRoundMs(),
            page: 1,
            pageSize: 5000,
            activeCooldowns,
            timeBans,
            meta: penaltyMeta,
            usersByPhone
        });
        const cooldownRows = adminLiveView.attachCooldownSeats(penalties.users, activeRows);
        const group = req.body.group === 'cooldown' ? 'cooldown' : 'active';
        const source = group === 'cooldown' ? cooldownRows : activeRows;
        const pageResult = adminLiveView.paginateRows(adminLiveView.filterBySearch(source, search), req.body.page, pageSize);
        res.json({
            success: true,
            filter,
            group,
            counts: { active: activeRows.length, cooldown: cooldownRows.length },
            gameId,
            gameState: gameLabel,
            calledNumbers: calledNumbers.slice(),
            ...pageResult
        });
    } catch (e) {
        res.json({ success: false, users: [], total: 0, counts: {} });
    }
});

// 🔥 FAST CACHE: አድሚን ዳሽቦርዱ ሰርቨር እንዳያጨናንቅ ለ 10 ሰከንድ ዳታውን ይይዘዋል
let cachedLiveStats = null;
let lastStatsFetchTime = 0;

app.post('/api/admin/live-stats', auth, async (req, res) => {
    try {
        let nowTime = Date.now();
        // ዳታውን ለ 10 ሰከንድ ይይዘዋል (ሰርቨሩን ከድካም ያድነዋል)
        if (cachedLiveStats && (nowTime - lastStatsFetchTime < 10000)) {
            cachedLiveStats.livePlayers = Object.keys(activePlayers).length;
            cachedLiveStats.gameState = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
            cachedLiveStats.gameId = gameId;
            cachedLiveStats.currentJackpot = totalPrizePool;
            cachedLiveStats.settings = GLOBAL_SETTINGS;
            return res.json(cachedLiveStats);
        }

        let now = new Date();
        let dayAgo = new Date(now - 24*60*60*1000);
        let weekAgo = new Date(now - 7*24*60*60*1000);
        let monthAgo = new Date(now - 30*24*60*60*1000);
        let startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // 🔥 ሁሉንም ዳታ በአንዴ ማምጣት (Parallel Fetching) - ጊዜውን ከ 961ms ወደ 50ms ያወርደዋል!
        const [
            totalUsers, dailyActive, weeklyActive, monthlyActive, 
            todaysWinTxs, txStats, bonusStats, bonusAgg
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({lastActive: {$gte: dayAgo}}),
            User.countDocuments({lastActive: {$gte: weekAgo}}),
            User.countDocuments({lastActive: {$gte: monthAgo}}),
            Transaction.find({ type: 'win', date: { $gte: startOfDay } }).select('phone').lean(),
            Transaction.aggregate([
                { $match: { date: { $gte: startOfDay }, status: 'Approved' } },
                { $group: { _id: "$type", total: { $sum: "$amount" } } }
            ]),
            ActiveBonus.aggregate([
                { $match: { date: { $gte: startOfDay } } },
                { $group: { _id: null, totalBonus: { $sum: { $multiply: ["$amount", "$currentClaims"] } } } }
            ]),
            User.aggregate([{ $group: { _id: null, totalUnplayed: { $sum: "$playBalance" } } }])
        ]);

        let todayWinnerPhones = [...new Set(todaysWinTxs.map(t => t.phone))];
        let todaysWinners = await User.find({ phone: { $in: todayWinnerPhones } }).select('mainBalance').lean();
        let dailyActiveMainBal = todaysWinners.reduce((sum, u) => sum + (u.mainBalance || 0), 0);

        let dailyDeposit = 0;
        let dailyWithdraw = 0;
        txStats.forEach(t => {
            if (t._id === 'deposit') dailyDeposit = t.total;
            if (t._id === 'withdraw') dailyWithdraw = t.total;
        });

        let dailyBonus = bonusStats.length > 0 ? bonusStats[0].totalBonus : 0;
        let totalUnplayedBonus = bonusAgg.length > 0 ? bonusAgg[0].totalUnplayed : 0;

        let realMoney = 0;
        let botMoney = 0;
        let realCount = 0;
        let botCount = 0;

        Object.values(activePlayers).forEach(p => {
            if (p.isBot) {
                botMoney += (p.tickets * GLOBAL_SETTINGS.ticketPrice);
                botCount++;
            } else {
                realMoney += (p.tickets * GLOBAL_SETTINGS.ticketPrice);
                realCount++;
            }
        });

        let eatTime = new Date(Date.now() + (3 * 60 * 60 * 1000));
        let cHour = eatTime.getUTCHours();
        let cMin = eatTime.getUTCMinutes();
        let timeStr = `${cHour.toString().padStart(2, '0')}:${cMin.toString().padStart(2, '0')} (EAT)`;
        
        let activeSchName = "None";
        let schMin = 0, schMax = 0;
        
        const scheduleDesc = gameEngine.describeScheduleStatus(GLOBAL_SETTINGS, Date.now());
        if (scheduleDesc.active) {
            activeSchName = scheduleDesc.active.n;
            schMin = scheduleDesc.active.d.min;
            schMax = scheduleDesc.active.d.max;
        }

        const finalData = { 
            totalUsers, 
            livePlayers: Object.keys(activePlayers).length, 
            realPlayersCount: realCount,
            botPlayersCount: botCount,
            activeBotPhones: Object.values(activePlayers).filter(p => p.isBot).map(p => p.phone), 
            gameState: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState, 
            gameId, 
            totalProfit: dailyHouseProfit, 
            currentJackpot: totalPrizePool, 
            realMoney: realMoney,
            botMoney: botMoney,
            settings: GLOBAL_SETTINGS, 
            dailyDeposit, 
            dailyWithdraw, 
            dailyBonus,
            totalUnplayedBonus,
            dailyActiveMainBal, 
            scheduleStatus: {
                active: GLOBAL_SETTINGS.isBotScheduleActive,
                time: timeStr,
                name: activeSchName,
                min: schMin,
                max: schMax,
                serverTime: gameEngine.formatServerClock(),
                eatTime: gameEngine.formatEatClock(),
                ramping: !!botRampController.getStatus().ramping,
                injected: botRampController.getLastCount(),
                mode: botRampController.getMode(),
                source: botRampController.getStatus().source,
                slots: scheduleDesc.slots
            }
        };

        cachedLiveStats = finalData;
        lastStatsFetchTime = nowTime;

        res.json(finalData);
    } catch (e) {
        console.error("Live Stats Error:", e);
        res.status(500).json({ success: false });
    }
});
        

app.post('/api/admin/bot-master-update-v2', auth, async (req, res) => {
    try {
        let s = await SystemSettings.findOne();
        
        let d1 = req.body.botDist1 !== undefined ? req.body.botDist1 : 5;
        let d2 = req.body.botDist2 !== undefined ? req.body.botDist2 : 4;
        let d3 = req.body.botDist3 !== undefined ? req.body.botDist3 : 3;
        let d4 = req.body.botDist4 !== undefined ? req.body.botDist4 : 3;
        
        if (d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0) {
            d1 = 5; d2 = 4; d3 = 3; d4 = 3;
        }

        s.isBotSystemActive = !!req.body.isBotSystemActive;
        s.botWinnerForce = req.body.botWinnerForce;
        s.mixBotCount = req.body.mixBotCount !== undefined ? req.body.mixBotCount : 1;
        s.botDist1 = d1; 
        s.botDist2 = d2; 
        s.botDist3 = d3; 
        s.botDist4 = d4;
        
        s.isBotScheduleActive = !!req.body.isBotScheduleActive;
        if(req.body.botRampMinutes !== undefined) s.botRampMinutes = gameEngine.normalizeBotRampMinutes(req.body.botRampMinutes);
        [1, 2, 3, 4, 5, 6, 7].forEach((i) => {
            const key = 'botSchedule' + i;
            if (req.body[key]) {
                s[key] = req.body[key];
                s.markModified(key);
            }
        });

        await s.save(); 
        await loadSettings();
        const applied = botRampController.syncControlMode({
            settings: GLOBAL_SETTINGS,
            now: Date.now()
        });

        res.json({
            success: true,
            control: {
                mode: applied.mode || botRampController.getMode(),
                injected: applied.count != null ? applied.count : botRampController.getLastCount(),
                ramping: !!applied.ramping,
                source: applied.source || botRampController.getMode()
            }
        });
    } catch(e) { res.json({success: false}); }
});

app.post('/api/admin/referrals', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = parseInt(req.body.limit) || 30;
        let search = String(req.body.search || '');

        let query = { $or: [{ totalInvites: { $gt: 0 } }, { inviteBonusEarned: { $gt: 0 } }] };

        if (search) {
            query.phone = new RegExp(search, 'i');
        }

        let total = await User.countDocuments(query);
        let referrers = await User.find(query)
            .sort({ totalInvites: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        let mappedData = referrers.map(r => {
            let actualInvites = r.totalInvites || 0;
            let bonusAmount = GLOBAL_SETTINGS.inviteBonus || 10; 
            let expectedEarned = actualInvites * bonusAmount;
            let alreadyEarned = r.inviteBonusEarned || 0;

            return {
                _id: r.phone,
                count: actualInvites,
                earned: Math.max(expectedEarned, alreadyEarned)
            };
        });

        res.json({ success: true, referrals: mappedData, total });
    } catch(e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/referral-details', auth, async (req, res) => {
    try {
        let users = await User.find({ referredBy: String(req.body.phone) }).select('name phone _id').sort({ _id: -1 });
        let mappedUsers = users.map(u => ({
            name: u.name,
            phone: u.phone,
            date: u._id.getTimestamp()
        }));
        res.json({ success: true, users: mappedUsers });
    } catch(e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/fix-missing-invites', auth, async (req, res) => {
    try {
        let users = await User.find({ referredBy: { $ne: "" } });
        let inviteCounts = {};
        
        users.forEach(u => {
            inviteCounts[u.referredBy] = (inviteCounts[u.referredBy] || 0) + 1;
        });

        let fixedCount = 0;
        let totalPaid = 0;

        for (let phone in inviteCounts) {
            let actualInvites = inviteCounts[phone];
            let referrer = await User.findOne({ phone: phone, isPromoter: false }); 
            
            if (referrer) {
                let paidSoFar = referrer.compensatedInvites || 0;
                
                if (actualInvites > paidSoFar) {
                    let unpaidCount = actualInvites - paidSoFar;
                    let bonusAmount = unpaidCount * GLOBAL_SETTINGS.inviteBonus;
                    
                    referrer.playBalance += bonusAmount;
                    referrer.compensatedInvites = actualInvites; 
                    referrer.totalInvites = actualInvites;
                    referrer.inviteBonusEarned = (referrer.inviteBonusEarned || 0) + bonusAmount;
                    await referrer.save();
                    
                    fixedCount++;
                    totalPaid += bonusAmount;
                    io.emit('balance_updated', referrer.phone);
                }
            }
        }
        res.json({ success: true, message: `✅ በተሳካ ሁኔታ ተስተካክሏል!\n\nለ ${fixedCount} ሰዎች አጠቃላይ ${totalPaid} ETB ቦነስ ተከፍሏል።` });
    } catch(e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

app.post('/api/admin/list-promo-codes', auth, async (req, res) => {
    try {
        let codes = await PromoCode.find().sort({ _id: -1 });
        res.json({ success: true, codes });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/create-promo-code', auth, async (req, res) => {
    try {
        let exists = await PromoCode.findOne({ code: String(req.body.code) });
        if(exists) return res.json({ success: false, message: "Code already exists!" });
        await new PromoCode({ 
            code: String(req.body.code), 
            amount: Number(req.body.amount), 
            maxUses: Number(req.body.maxUses),
            requireDeposit: !!req.body.requireDeposit,
            minDepositAmount: Number(req.body.minDepositAmount) || 0,
            requireDepositWithinHours: Number(req.body.requireDepositWithinHours) || 0
        }).save();
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/delete-promo-code', auth, async (req, res) => {
    try { await PromoCode.findByIdAndDelete(req.body.id); res.json({ success: true }); } 
    catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/delete-users', auth, async (req, res) => {
    try { await User.deleteMany({ phone: { $in: req.body.phones } }); res.json({ success: true }); } 
    catch(e) { res.json({ success: false }); }
});
app.post('/api/admin/delete-history', auth, async (req, res) => {
    try { await GameHistory.deleteMany({ _id: { $in: req.body.ids } }); res.json({ success: true }); } 
    catch(e) { res.json({ success: false }); }
});
app.post('/api/admin/delete-transactions', auth, async (req, res) => {
    try { 
        await Transaction.updateMany({ _id: { $in: req.body.ids } }, { hiddenFromAdmin: true }); 
        res.json({ success: true }); 
    } 
    catch(e) { res.json({ success: false }); }
});
app.post('/api/admin/delete-game-player', auth, async (req, res) => {
    try {
        let h = await GameHistory.findById(req.body.id);
        if(h) {
            h.playersData = h.playersData.filter(p => p.phone !== req.body.phone);
            await h.save();
            res.json({ success: true });
        } else { res.json({ success: false }); }
    } catch(e) { res.json({ success: false }); }
});
app.post('/api/admin/delete-old-history', auth, async (req, res) => {
    try {
        let cutoff = new Date(Date.now() - (6 * 60 * 60 * 1000));
        await GameHistory.deleteMany({ date: { $lt: cutoff } });
        res.json({ success: true });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/promoters-data', financeAuth, async (req, res) => {
    try {
        const page = parseInt(req.body.page) || 1;
        const limit = Math.min(Math.max(parseInt(req.body.limit) || 20, 1), 50);
        const search = String(req.body.search || '').trim();
        const now = Date.now();
        const cacheKey = page + ':' + limit + ':' + search;
        if (promoterStatsCache.payload && promoterStatsCache.key === cacheKey && (now - promoterStatsCache.at) < 12000) {
            return res.json(promoterStatsCache.payload);
        }

        const query = { isPromoter: true };
        if (search) {
            query.$or = [
                { phone: new RegExp(search, 'i') },
                { name: new RegExp(search, 'i') }
            ];
        }

        const [total, promoters] = await Promise.all([
            User.countDocuments(query),
            User.find(query)
                .select('name phone promoterPercent promoterEarned promoterUnpaidBalance')
                .sort({ promoterEarned: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean()
        ]);

        const phones = promoters.map((p) => p.phone);
        const refAgg = phones.length ? await User.aggregate([
            { $match: { referredBy: { $in: phones }, referredViaPromo: true } },
            { $group: {
                _id: '$referredBy',
                usersBrought: { $sum: 1 },
                activeDepositors: { $sum: { $cond: [{ $gt: ['$totalDeposited', 0] }, 1, 0] } },
                totalDeposits: { $sum: '$totalDeposited' }
            } }
        ]) : [];
        const refMap = {};
        refAgg.forEach((row) => { refMap[row._id] = row; });

        const data = promoters.map((p) => {
            const stats = refMap[p.phone] || {};
            return {
                name: p.name,
                phone: p.phone,
                percent: p.promoterPercent,
                earned: p.promoterEarned,
                unpaidBalance: p.promoterUnpaidBalance,
                usersBrought: stats.usersBrought || 0,
                activeDepositors: stats.activeDepositors || 0,
                totalDeposits: stats.totalDeposits || 0
            };
        });

        const payload = { success: true, promoters: data, total, page, limit };
        promoterStatsCache = { at: now, key: cacheKey, payload };
        res.json(payload);
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/set-promoter', auth, async (req, res) => {
    try {
        const { phone, isPromoter, percent } = req.body;
        let user = await User.findOne({ phone: String(phone) });
        if (user) {
            user.isPromoter = isPromoter;
            if (percent !== undefined) user.promoterPercent = percent;
            await user.save();
            res.json({ success: true });
        } else {
            res.json({ success: false, message: "User not found" });
        }
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/promoter-details', auth, async (req, res) => {
    try {
        let p = await User.findOne({ phone: String(req.body.phone), isPromoter: true });
        if(!p) return res.json({ success: false });

        let refUsers = await User.find({ referredBy: p.phone, referredViaPromo: true })
            .select('name phone totalDeposited promoterCommissionGenerated')
            .lean();
        let details = refUsers.map((u) => ({
            name: u.name,
            phone: u.phone,
            totalDeposit: u.totalDeposited || 0,
            commission: u.promoterCommissionGenerated || 0
        }));
        res.json({ success: true, promoter: p, details });
    } catch (e) { res.json({ success: false }); }
});

app.post('/api/admin/pay-promoter', auth, async (req, res) => {
    try {
        let p = await User.findOne({ phone: String(req.body.phone), isPromoter: true });
        if(p) {
            let deductAmt = Number(req.body.amount);
            p.promoterUnpaidBalance -= deductAmt;
            if(p.promoterUnpaidBalance < 0) p.promoterUnpaidBalance = 0;
            await p.save();
            
            await new Transaction({ 
                phone: p.phone, 
                type: 'withdraw', 
                amount: deductAmt, 
                method: "Promoter Comm", 
                smsText: "Manual Admin Payment",
                status: "Approved"
            }).save();

            const paid = birrBalance.withdrawalDeduction({ type: 'withdraw', amount: deductAmt }, 'Pending');
            const floatNow = paid > 0 ? await changeBirrBalance(-paid) : { balance: birrBalance.roundBirr(GLOBAL_SETTINGS.birrBalance), version: birrBalanceVersion };
            res.json({ success: true, message: `✅ ለ ${p.name} በተሳካ ሁኔታ ${deductAmt} ETB ተቀንሷል።`, birrBalance: floatNow.balance, birrBalanceVersion: floatNow.version });
        } else res.json({ success: false, message: "Promoter not found" });
    } catch(e) { res.json({ success: false }); }
});

app.post('/api/admin/action-tx', auth, async (req, res) => {
    const tx = await Transaction.findById(req.body.txId); const user = await User.findOne({phone: tx.phone});
    const previousStatus = tx.status;
    if (req.body.action === 'Approve') { 
        tx.status = 'Approved'; 
        if(tx.type === 'deposit') {
            let actualAmount = tx.amount;
            let bonus = applyConfiguredDepositBonus(actualAmount, user).bonus;
            
            let totalCredit = actualAmount + bonus;
            tx.bonusGiven = bonus;
            user.playBalance += totalCredit;
            user.totalDeposited += actualAmount;
            user.unplayedRealDeposit += actualAmount;
            creditUserDailyDeposit(user, actualAmount); 

            commitDepositVaultSplit(actualAmount);

            if(user.referredBy && user.referredViaPromo) {
                let promoter = await User.findOne({ phone: user.referredBy, isPromoter: true });
                if(promoter) {
                    let commission = actualAmount * (promoter.promoterPercent / 100);
                    promoter.promoterUnpaidBalance += commission; 
                    promoter.promoterEarned += commission;
                    await promoter.save();
                    user.promoterCommissionGenerated += commission;
                    io.emit('balance_updated', promoter.phone);
                    
                    if(promoter.telegramId) {
                        let msg = `🎉 <b>የኮሚሽን ገቢ!</b>\n\nበእርስዎ የጋባዥ ሊንክ የመጣው <b>${user.name}</b> አሁን ገቢ አድርጓል።\n\n💰 <b>የእርስዎ ኮሚሽን:</b> +${commission} ETB\n💸 <b>ያልተከፈለ አጠቃላይ ኮሚሽን:</b> ${promoter.promoterUnpaidBalance} ETB`;
                        bot.sendMessage(promoter.telegramId, msg, {parse_mode: 'HTML'}).catch(e=>{});
                    }
                }
            }
            if (!user.hasMadeFirstDeposit) user.hasMadeFirstDeposit = true;
            user.totalWithdrawn = user.totalWithdrawn || 0;
            
            if (bonus > 0) {
                io.emit('deposit_bonus_alert', { phone: tx.phone, depositAmount: actualAmount, bonusAmount: bonus });
            }

        } else if (tx.type === 'withdraw') {
            invalidateWeeklyLeaderboard();
            let set = GLOBAL_SETTINGS;
            user.totalWithdrawn = (user.totalWithdrawn || 0) + tx.amount;
            
            if(set.isWitBonusActive && tx.amount >= set.witBonusMinAmount) {
                let giveBonus = true;
                if (set.witBonusTimeRestricted) {
                    let currentHour = new Date().getHours();
                    if (currentHour < set.witHappyHourStart || currentHour > set.witHappyHourEnd) { giveBonus = false; }
                }
                if(giveBonus) {
                    let wBonus = tx.amount * (set.witBonusPercent / 100);
                    user.playBalance += wBonus; 
                }
            }
        }
    } else { 
        tx.status = 'Rejected'; 
        if(tx.type === 'withdraw' && tx.method === 'Promoter Comm') {
            user.promoterUnpaidBalance += tx.amount;
        } else if(tx.type === 'withdraw') {
            user.mainBalance += tx.amount; 
        }
    }
    await tx.save(); await user.save(); io.emit('balance_updated', tx.phone);
    let floatNow = { balance: birrBalance.roundBirr(GLOBAL_SETTINGS.birrBalance), version: birrBalanceVersion };
    if (req.body.action === 'Approve') {
        const deduct = birrBalance.withdrawalDeduction(tx, previousStatus);
        if (deduct > 0) {
            const claimed = await Transaction.findOneAndUpdate(
                { _id: tx._id, birrFloatDeducted: { $ne: true } },
                { $set: { birrFloatDeducted: true } }
            );
            if (claimed) {
                try {
                    floatNow = await changeBirrBalance(-deduct);
                } catch (err) {
                    await Transaction.updateOne({ _id: tx._id }, { $set: { birrFloatDeducted: false } });
                    throw err;
                }
            }
        }
    }
    res.json({ success: true, birrBalance: floatNow.balance, birrBalanceVersion: floatNow.version });
});

app.post('/api/admin/sms-comparison', auth, async (req, res) => {
    try {
        let page = parseInt(req.body.page) || 1;
        let limit = 20; 
        let skip = (page - 1) * limit;

        let total = await BankSMS.countDocuments();
        let smsList = await BankSMS.find().sort({ dateReceived: -1 }).skip(skip).limit(limit);

        let comparisonData = [];
        for (let sms of smsList) {
            let tx = await Transaction.findOne({ txRef: sms.txRef });
            comparisonData.push({
                smsDate: sms.dateReceived,
                iphoneSms: sms.rawText, 
                txRef: sms.txRef,
                extraction: sms.amount,
                systemData: tx ? {
                    txId: tx._id,
                    phone: tx.phone,
                    amount: tx.amount,
                    status: tx.status, 
                    userSms: tx.smsText, 
                    date: tx.date
                } : null
            });
        }
        res.json({ success: true, data: comparisonData, total, page, totalPages: Math.ceil(total / limit) });
    } catch (e) { res.json({ success: false, message: "Error loading data" }); }
});

app.post('/api/admin/update-settings', auth, async (req, res) => {
    let birrSet = null;
    if (req.body.addBirrAmount !== undefined) {
        const decision = birrBalance.balanceAfterAdd(GLOBAL_SETTINGS.birrBalance, req.body.addBirrAmount);
        if (!decision.ok) return res.status(400).json({ success: false, message: decision.message });
        birrSet = decision.balance;
    }
    let s = await SystemSettings.findOne();
    if(req.body.newPass) s.adminPass = req.body.newPass;
    if(req.body.newFinancePass) s.financePass = req.body.newFinancePass;
    
    if(req.body.vaultTwoBalance !== undefined) s.vaultTwoBalance = req.body.vaultTwoBalance;
    if(req.body.vaultTwoPercent !== undefined) s.vaultTwoPercent = req.body.vaultTwoPercent;
    if(req.body.vaultThreeBalance !== undefined) s.vaultThreeBalance = req.body.vaultThreeBalance;
    if(req.body.vaultThreePercent !== undefined) s.vaultThreePercent = req.body.vaultThreePercent;
    if(req.body.vaultTransferEnabled !== undefined) s.vaultTransferEnabled = !!req.body.vaultTransferEnabled;
    if(req.body.clearVaultTransferred === true) s.vaultTransferredAmount = 0;
    if(req.body.clearVaultBlocked === true) s.vaultBlockedAmount = 0;

    if(req.body.decoyChancePercent !== undefined) s.decoyChancePercent = req.body.decoyChancePercent;
    if(req.body.soloBotWinPercent !== undefined) s.soloBotWinPercent = gameEngine.clampSoloBotPercent(req.body.soloBotWinPercent);
    if(req.body.virtualPrizePool !== undefined) s.virtualPrizePool = req.body.virtualPrizePool;
    if(req.body.bonusWinPercent !== undefined) s.bonusWinPercent = req.body.bonusWinPercent;

    if(req.body.ticketPrice !== undefined) s.ticketPrice = req.body.ticketPrice;
    if(req.body.gameTimer !== undefined) s.gameTimer = req.body.gameTimer;
    if(req.body.pauseGame !== undefined) s.isGamePaused = req.body.pauseGame;
    
    if(req.body.depBonusMinAmount !== undefined) s.depBonusMinAmount = req.body.depBonusMinAmount;
    if(req.body.depBonusPercent !== undefined) s.depBonusPercent = req.body.depBonusPercent;
    
    if(req.body.depBonusTier2Min !== undefined) s.depBonusTier2Min = req.body.depBonusTier2Min;
    if(req.body.depBonusTier2Percent !== undefined) s.depBonusTier2Percent = req.body.depBonusTier2Percent;

    if(req.body.depBonusTier3Min !== undefined) s.depBonusTier3Min = req.body.depBonusTier3Min;
    if(req.body.depBonusTier3Percent !== undefined) s.depBonusTier3Percent = req.body.depBonusTier3Percent;
    
    if(req.body.depBonusTimeRestricted !== undefined) s.depBonusTimeRestricted = req.body.depBonusTimeRestricted;
    if(req.body.happyHourStart !== undefined) s.happyHourStart = req.body.happyHourStart;
    if(req.body.happyHourEnd !== undefined) s.happyHourEnd = req.body.happyHourEnd;
    if(req.body.depBonusSchedulerActive !== undefined) s.depBonusSchedulerActive = !!req.body.depBonusSchedulerActive;
    if(req.body.depBonusSchedulerMinAmount !== undefined) s.depBonusSchedulerMinAmount = Number(req.body.depBonusSchedulerMinAmount) || 0;
    if(req.body.depBonusSchedulerPercent !== undefined) s.depBonusSchedulerPercent = Number(req.body.depBonusSchedulerPercent) || 0;
    if(req.body.depBonusSchedulerStart !== undefined) s.depBonusSchedulerStart = String(req.body.depBonusSchedulerStart || '14:00');
    if(req.body.depBonusSchedulerEnd !== undefined) s.depBonusSchedulerEnd = String(req.body.depBonusSchedulerEnd || '16:00');
    
    if(req.body.depBannerTextAm !== undefined) s.depBannerTextAm = req.body.depBannerTextAm;
    if(req.body.depBannerTextEn !== undefined) s.depBannerTextEn = req.body.depBannerTextEn;
    
    if(req.body.witBonusMinAmount !== undefined) s.witBonusMinAmount = req.body.witBonusMinAmount;
    if(req.body.witBonusPercent !== undefined) s.witBonusPercent = req.body.witBonusPercent;
    if(req.body.isWitBonusActive !== undefined) s.isWitBonusActive = req.body.isWitBonusActive;
    if(req.body.witBonusTimeRestricted !== undefined) s.witBonusTimeRestricted = req.body.witBonusTimeRestricted;
    if(req.body.witHappyHourStart !== undefined) s.witHappyHourStart = req.body.witHappyHourStart;
    if(req.body.witHappyHourEnd !== undefined) s.witHappyHourEnd = req.body.witHappyHourEnd;
    if(req.body.witBannerTextAm !== undefined) s.witBannerTextAm = req.body.witBannerTextAm;
    if(req.body.witBannerTextEn !== undefined) s.witBannerTextEn = req.body.witBannerTextEn;

    if(req.body.registerBonus !== undefined) s.registerBonus = req.body.registerBonus;
    if(req.body.inviteBonus !== undefined) s.inviteBonus = req.body.inviteBonus;
    if(req.body.adminProfitPercent !== undefined) s.adminProfitPercent = req.body.adminProfitPercent; 
    if(req.body.maxTicketsPerUser !== undefined) s.maxTicketsPerUser = req.body.maxTicketsPerUser; 
    
    if(req.body.minWithdrawLimit !== undefined) s.minWithdrawLimit = req.body.minWithdrawLimit;
    
    if(req.body.winPopupTimer !== undefined) s.winPopupTimer = req.body.winPopupTimer;
    
    if(req.body.telegramChannel !== undefined) s.telegramChannel = req.body.telegramChannel;

    if(req.body.jackpotBoostAmount !== undefined) {
        s.jackpotBoostAmount = req.body.jackpotBoostAmount;
        jackpotBoostAmount = req.body.jackpotBoostAmount;
    }

    // ከብሬኬቱ ውጭ ራሳቸውን ችለው እንዲህ ይቀመጡ
    if(req.body.telebirrAccountName !== undefined) s.telebirrAccountName = req.body.telebirrAccountName;
    if(req.body.telebirrAccountNumber !== undefined) s.telebirrAccountNumber = req.body.telebirrAccountNumber;
    if(req.body.cbeAccountName !== undefined) s.cbeAccountName = req.body.cbeAccountName;
    if(req.body.cbeAccountNumber !== undefined) s.cbeAccountNumber = req.body.cbeAccountNumber;

    if (birrSet !== null && s && typeof s.unmarkModified === 'function') s.unmarkModified('birrBalance');
    await s.save();
    let floatNow = { balance: birrBalance.roundBirr(GLOBAL_SETTINGS.birrBalance), version: birrBalanceVersion };
    if (birrSet !== null) floatNow = await setBirrBalance(birrSet);
    await loadSettings();
    res.json({ success: true, birrBalance: birrBalance.roundBirr(GLOBAL_SETTINGS.birrBalance), birrBalanceVersion: floatNow.version });
});

app.post('/api/admin/shuffle-cards', auth, async (req, res) => {
    try {
        const sequential = gameEngine.defaultCardOrder(gameEngine.TOTAL_CARDS);
        let seed = gameEngine.nextCardGridSeed(Math.random);
        if (seed === Number(GLOBAL_SETTINGS.cardGridSeed || 0)) {
            seed = gameEngine.nextCardGridSeed(Math.random);
        }
        await SystemSettings.updateOne({}, { $set: { cardBoardOrder: sequential, cardGridSeed: seed } });
        GLOBAL_SETTINGS.cardBoardOrder = sequential;
        GLOBAL_SETTINGS.cardGridSeed = seed;
        if (gameState === 'WAITING') {
            Object.values(activePlayers || {}).forEach((p) => {
                (p.ticketsData || []).forEach((t) => {
                    if (!t || !t.id) return;
                    const frozen = roundCards.getGrid(gameId, t.id);
                    if (frozen) t.grid = frozen;
                });
            });
        }
        io.emit('card_board_order', sequential);
        io.emit('card_grid_seed', roundCardGridSeed);
        const preview = gameEngine.previewShuffledGrids(seed, [1, 2, 3]);
        res.json({ success: true, seed, order: sequential, preview });
    } catch (e) {
        res.json({ success: false, message: 'Could not shuffle cards.' });
    }
});

app.post('/api/admin/schedule-status', auth, (req, res) => {
    const now = Date.now();
    const desc = gameEngine.describeScheduleStatus(GLOBAL_SETTINGS, now);
    res.json({
        success: true,
        serverTime: gameEngine.formatServerClock(now),
        eatTime: gameEngine.formatEatClock(now),
        eatDateTime: gameEngine.formatEatDateTime(now),
        injected: botRampController.getLastCount(),
        mode: botRampController.getMode(),
        control: botRampController.getStatus(),
        status: desc,
        settings: {
            isBotScheduleActive: GLOBAL_SETTINGS.isBotScheduleActive,
            botRampMinutes: GLOBAL_SETTINGS.botRampMinutes,
            botSchedule1: GLOBAL_SETTINGS.botSchedule1,
            botSchedule2: GLOBAL_SETTINGS.botSchedule2,
            botSchedule3: GLOBAL_SETTINGS.botSchedule3,
            botSchedule4: GLOBAL_SETTINGS.botSchedule4,
            botSchedule5: GLOBAL_SETTINGS.botSchedule5,
            botSchedule6: GLOBAL_SETTINGS.botSchedule6,
            botSchedule7: GLOBAL_SETTINGS.botSchedule7
        }
    });
});

app.post('/api/admin/scheduled-posts', auth, async (req, res) => {
    try {
        const posts = await ScheduledPost.find().sort({ scheduledAt: 1 }).limit(80).lean();
        res.json({ success: true, posts: posts.map(gameEngine.shapeScheduledPost) });
    } catch (e) {
        res.json({ success: false, posts: [] });
    }
});

app.post('/api/admin/schedule-post', auth, async (req, res) => {
    try {
        const built = gameEngine.buildScheduledPost(req.body.text, req.body.eatDate, req.body.eatTime);
        if (!built.ok) return res.json({ success: false, message: built.message });
        const saved = await new ScheduledPost(built.doc).save();
        res.json({ success: true, post: gameEngine.shapeScheduledPost(saved) });
    } catch (e) {
        res.json({ success: false, message: 'Could not save scheduled post.' });
    }
});

app.post('/api/admin/delete-scheduled-post', auth, async (req, res) => {
    try {
        await ScheduledPost.deleteOne({ _id: req.body.id, status: { $ne: 'sent' } });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false });
    }
});

async function dispatchScheduledAnnouncement(post) {
    const payload = { text: post.text, date: new Date() };
    io.emit('announcement', payload);
    const users = await User.find({ telegramId: { $ne: '' } }).select('telegramId').lean();
    for (const u of users) {
        try {
            await bot.sendMessage(u.telegramId, post.text, { parse_mode: 'HTML' });
        } catch (e) {}
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}

async function publishDueScheduledPosts() {
    try {
        const due = await ScheduledPost.find(gameEngine.postsDue()).sort({ scheduledAt: 1 }).limit(5);
        for (const post of due) {
            post.status = 'sending';
            await post.save();
            try {
                await dispatchScheduledAnnouncement(post);
                post.status = 'sent';
                post.sentAt = new Date();
                await post.save();
            } catch (err) {
                post.status = 'queued';
                await post.save();
            }
        }
    } catch (e) {}
}

setInterval(publishDueScheduledPosts, 8000);

app.post('/api/admin/daily-active-balances', auth, async (req, res) => {
    try {
        let startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        let todaysWinTxs = await Transaction.find({ type: 'win', date: { $gte: startOfDay } }).select('phone');
        let todayWinnerPhones = [...new Set(todaysWinTxs.map(t => t.phone))];

        let activeUsers = await User.find({ phone: { $in: todayWinnerPhones }, mainBalance: { $gt: 0 } }, 'name phone mainBalance playBalance').sort({ mainBalance: -1 });
        let totalRiskAmount = activeUsers.reduce((sum, u) => sum + (u.mainBalance || 0), 0);

        res.json({ success: true, users: activeUsers, totalRiskAmount });
    } catch(e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/deposits-24h', auth, async (req, res) => {
    try {
        const since = new Date(Date.now() - (24 * 60 * 60 * 1000));
        const rows = await Transaction.aggregate([
            { $match: { type: 'deposit', status: 'Approved', date: { $gte: since }, hiddenFromAdmin: { $ne: true } } },
            { $group: { _id: '$phone', depositCount: { $sum: 1 }, totalAmount: { $sum: '$amount' } } },
            { $sort: { depositCount: -1, totalAmount: -1, _id: 1 } }
        ]);
        const phones = rows.map((row) => (row && row._id != null ? String(row._id) : '')).filter(Boolean);
        const users = phones.length
            ? await User.find({ phone: { $in: phones } }).select('phone name').lean()
            : [];
        const byPhone = {};
        users.forEach((user) => { byPhone[String(user.phone)] = user; });
        const list = [];
        rows.forEach((row) => {
            const phone = row && row._id != null ? String(row._id) : '';
            if (!phone) return;
            const user = byPhone[phone];
            list.push({
                phone,
                name: user && user.name ? user.name : '',
                depositCount: Number(row.depositCount) || 0,
                totalAmount: Number(row.totalAmount) || 0
            });
        });
        res.json({ success: true, totalUsers: list.length, users: list });
    } catch (e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/trigger-cashback', auth, async (req, res) => {
    try {
        const minL = GLOBAL_SETTINGS.cashbackMinLoss || 200;
        const cAmt = GLOBAL_SETTINGS.cashbackAmount || 10;
        
        let users = await User.find();
        let count = 0;

        for(let u of users) {
            let totalLoss = (u.played * GLOBAL_SETTINGS.ticketPrice) - u.won;
            if(totalLoss >= minL) {
                u.playBalance += cAmt;
                u.played = 0; 
                u.won = 0;    
                await u.save();
                io.emit('balance_updated', u.phone);
                count++;
            }
        }
        if(count === 0) return res.json({ success: false, message: `No users have lost >= ${minL} ETB.` });
        res.json({ success: true, message: `✅ Successfully gave ${cAmt} ETB cashback to ${count} users!` });
    } catch(e) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/edit-user', auth, async (req, res) => {
    try {
        const oldPhone = String(req.body.oldPhone);
        const newPhone = String(req.body.newPhone);
        const name = String(req.body.name);
        const userPass = String(req.body.userPass || "");
        
        let updateData = { 
            phone: newPhone, 
            name: name,
            mainBalance: Number(req.body.mainBalance), 
            playBalance: Number(req.body.playBalance), 
            won: Number(req.body.won) 
        };
        if (req.body.weeklyRankOverride !== undefined && req.body.weeklyRankOverride !== '') {
            updateData.weeklyRankOverride = Number(req.body.weeklyRankOverride);
            invalidateWeeklyLeaderboard();
        }
        
        if (userPass.trim() !== "") { 
            updateData.password = userPass.trim(); 
        }
        
        let updatedUser = await User.findOneAndUpdate(
            { phone: oldPhone }, 
            { $set: updateData }, 
            { new: true } 
        );
        
        if(updatedUser) {
            if (activePlayers[oldPhone]) {
                if (oldPhone !== newPhone) {
                    activePlayers[newPhone] = activePlayers[oldPhone];
                    delete activePlayers[oldPhone];
                    activePlayers[newPhone].phone = newPhone;
                }
                activePlayers[newPhone].name = name;
                (activePlayers[newPhone].ticketsData || []).forEach((ticket) => {
                    cardBoard.markTaken(ticket && ticket.id, newPhone);
                });
            }
            res.json({ success: true });
        } else {
            res.json({ success: false, message: "User not found" });
        }
    } catch(e) { 
        res.json({ success: false, message: "Error saving data." }); 
    }
});

app.post('/api/admin/leaderboard', auth, async (req, res) => {
    try {
        const payload = await buildWeeklyLeaderboardPayload(Date.now(), parseInt(req.body.limit, 10) || 50, true);
        res.json(payload);
    } catch (e) {
        res.json({ success: false });
    }
});

app.post('/api/admin/reset-leaderboard', auth, async (req, res) => {
    try {
        const now = new Date();
        await SystemSettings.updateOne({}, { $set: { weeklyLeaderboardResetAt: now } });
        await User.updateMany({}, { $set: { won: 0, seasonCardsPlayed: 0, seasonId: '' }, $unset: { weeklyRankOverride: 1 } });
        GLOBAL_SETTINGS.weeklyLeaderboardResetAt = now;
        invalidateWeeklyLeaderboard();
        res.json({ success: true, resetAt: now, message: 'Season leaderboard and card counters cleared.' });
    } catch (e) {
        res.json({ success: false, message: 'Could not reset ranks.' });
    }
});

app.post('/api/admin/start-season', auth, async (req, res) => {
    try {
        const now = new Date();
        const ends = new Date(now.getTime() + gameEngine.seasonDurationMs());
        const seasonId = 'S' + now.getTime();
        const patch = {
            tournamentSeasonId: seasonId,
            tournamentStartedAt: now,
            tournamentEndsAt: ends,
            tournamentStatus: 'active',
            weeklyLeaderboardResetAt: now
        };
        await SystemSettings.updateOne({}, { $set: patch });
        Object.assign(GLOBAL_SETTINGS, patch);
        await User.updateMany({}, { $set: { seasonCardsPlayed: 0, seasonId: '' } });
        invalidateWeeklyLeaderboard();
        const payload = await buildWeeklyLeaderboardPayload(now.getTime(), 10);
        res.json({ success: true, message: 'Season started. It runs for exactly 7 days from this timestamp.', season: payload.season });
    } catch (e) {
        res.json({ success: false, message: 'Could not start season.' });
    }
});

app.post('/api/admin/end-season', auth, async (req, res) => {
    try {
        await SystemSettings.updateOne({}, { $set: { tournamentStatus: 'frozen' } });
        GLOBAL_SETTINGS.tournamentStatus = 'frozen';
        invalidateWeeklyLeaderboard();
        const payload = await buildWeeklyLeaderboardPayload(Date.now(), 10);
        res.json({ success: true, message: 'Season frozen. Card totals will not increase until a new season starts.', season: payload.season });
    } catch (e) {
        res.json({ success: false, message: 'Could not end season.' });
    }
});

app.post('/api/admin/disburse-prizes', auth, async (req, res) => {
    try {
        const payload = await buildWeeklyLeaderboardPayload(Date.now(), 10);
        const top = payload.leaderboard || [];
        const byPhone = {};
        top.forEach((row) => { byPhone[String(row.phone)] = row; });
        const prizes = Array.isArray(req.body.prizes) ? req.body.prizes : [];
        const paid = [];
        for (const prize of prizes) {
            const phone = String(prize && prize.phone || '');
            const amount = Number(prize && prize.amount);
            if (!phone || !byPhone[phone]) continue;
            if (!Number.isFinite(amount) || amount <= 0) continue;
            const user = await User.findOne({ phone });
            if (!user) continue;
            user.mainBalance = (Number(user.mainBalance) || 0) + amount;
            await user.save();
            await new Transaction({
                phone,
                type: 'TOURNAMENT_PRIZE',
                amount,
                method: 'Tournament',
                status: 'Approved',
                description: 'Tournament Season Top 10 Prize',
                smsText: 'Tournament Season Top 10 Prize'
            }).save();
            io.emit('balance_updated', phone);
            paid.push({ phone, amount, rank: byPhone[phone].rank });
        }
        res.json({ success: true, paid, message: paid.length ? `Credited ${paid.length} prize(s) to main wallets.` : 'No prize amounts to disburse.' });
    } catch (e) {
        res.json({ success: false, message: 'Could not disburse prizes.' });
    }
});

app.post('/api/admin/set-user-rank', auth, async (req, res) => {
    try {
        const phone = String(req.body.phone || '');
        if (!phone) return res.json({ success: false, message: 'Phone required.' });
        const points = Number(req.body.points);
        if (!Number.isFinite(points) || points < 0) return res.json({ success: false, message: 'Invalid points.' });
        const user = await User.findOneAndUpdate(
            { phone },
            { $set: { weeklyRankOverride: points, won: points } },
            { new: true }
        );
        if (!user) return res.json({ success: false, message: 'User not found.' });
        invalidateWeeklyLeaderboard();
        res.json({ success: true, phone: user.phone, weeklyRankOverride: points, won: points });
    } catch (e) {
        res.json({ success: false, message: 'Could not update rank.' });
    }
});

app.post('/api/admin/clear-pending-deposits', auth, async (req, res) => {
    try {
        const pending = await Transaction.find({
            type: 'deposit',
            status: 'Pending',
            hiddenFromAdmin: { $ne: true }
        });
        const refs = pending.map((tx) => tx.txRef).filter(Boolean);
        const bankRows = refs.length
            ? await BankSMS.find({ txRef: { $in: refs } }).select('txRef').lean()
            : [];
        const bankSet = new Set(bankRows.map((row) => String(row.txRef || '').toUpperCase().trim()));
        let cleared = 0;
        let preserved = 0;
        const clearedPhones = [];
        for (const tx of pending) {
            if (gameEngine.shouldPreservePendingDeposit(tx, bankSet)) {
                preserved += 1;
                continue;
            }
            await Transaction.deleteOne({ _id: tx._id });
            cleared += 1;
            if (tx.phone) {
                clearedPhones.push(tx.phone);
                io.emit('balance_updated', tx.phone);
            }
        }
        res.json({
            success: true,
            cleared,
            preserved,
            clearedPhones,
            message: `Cleared ${cleared} invalid slip(s). Kept ${preserved} receipt(s) for manual review.`
        });
    } catch (e) {
        res.json({ success: false, message: 'Could not clear pending deposits.' });
    }
});

app.post('/api/admin/ban-user', auth, async (req, res) => { await User.findOneAndUpdate({ phone: String(req.body.phone) }, { status: 'banned' }); res.json({ success: true }); });
app.post('/api/admin/banned-users', auth, async (req, res) => {
    try {
        const users = await User.find({ status: 'banned' })
            .sort({ _id: -1 })
            .select('name phone telegramUsername telegramId status')
            .lean();
        res.json({ success: true, users });
    } catch (e) {
        res.json({ success: false, users: [] });
    }
});
app.post('/api/admin/unban-user', auth, async (req, res) => {
    try {
        const phone = String(req.body.phone || '').trim();
        if (!phone) return res.json({ success: false, message: 'Phone required' });
        const user = await User.findOneAndUpdate(
            { phone },
            { $set: { status: 'active' } },
            { new: true }
        );
        if (!user) return res.json({ success: false, message: 'User not found' });
        releaseBannedBotState(user);
        io.emit('balance_updated', phone);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: 'Unban failed' });
    }
});

function penaltyRoundMs() {
    const seconds = Number(GLOBAL_SETTINGS.gameTimer) || 40;
    return Math.max(1000, seconds * 1000);
}

app.post('/api/admin/cooldown-users', auth, async (req, res) => {
    try {
        const now = Date.now();
        const phones = Object.keys(activeCooldowns).concat(Object.keys(timeBans));
        const unique = Array.from(new Set(phones));
        const profiles = unique.length
            ? await User.find({ phone: { $in: unique } }).select('phone name firstName telegramUsername telegramId').lean()
            : [];
        const usersByPhone = {};
        profiles.forEach((user) => { usersByPhone[String(user.phone)] = user; });
        const page = cooldownManager.listPenalties({
            now,
            roundMs: penaltyRoundMs(),
            page: req.body.page,
            pageSize: req.body.pageSize || 8,
            phone: req.body.phone || req.body.search || '',
            activeCooldowns,
            timeBans,
            meta: penaltyMeta,
            usersByPhone
        });
        res.json({ success: true, roundSeconds: Math.round(penaltyRoundMs() / 1000), ...page });
    } catch (e) {
        res.json({ success: false, message: 'Could not load cooldown users.', users: [], total: 0 });
    }
});

app.post('/api/admin/cooldown-action', auth, async (req, res) => {
    try {
        const phone = String(req.body.phone || '').trim();
        const action = String(req.body.action || '');
        const now = Date.now();
        const state = { activeCooldowns, timeBans, meta: penaltyMeta };
        let result;
        if (action === 'remove') {
            result = cooldownManager.removePenalty(state, phone, now);
        } else if (action === 'decrease' || action === 'increase') {
            const parsed = cooldownManager.parseDurationMs(req.body.duration || req.body.preset);
            if (parsed == null) {
                return res.json({ success: false, message: 'Enter a duration such as 10m, 1h, or 90s.' });
            }
            const delta = action === 'decrease' ? -parsed : parsed;
            result = cooldownManager.applyPenaltyDelta(state, phone, delta, now, penaltyRoundMs());
        } else {
            return res.json({ success: false, message: 'Unknown cooldown action.' });
        }
        await savePenalty(phone);
        let user = null;
        if (result.ok && !result.cleared) {
            const fresh = cooldownManager.listPenalties({
                now: Date.now(),
                roundMs: penaltyRoundMs(),
                page: 1,
                pageSize: 5000,
                activeCooldowns,
                timeBans,
                meta: penaltyMeta,
                usersByPhone: {}
            });
            user = fresh.users.filter((row) => row.phone === phone)[0] || null;
            if (user) {
                const profile = await User.findOne({ phone }).select('name firstName telegramUsername telegramId').lean();
                if (profile) {
                    user.name = profile.name || '';
                    user.firstName = profile.firstName || '';
                    user.username = profile.telegramUsername || '';
                    user.userId = profile.telegramId || '';
                }
            }
        }
        res.json({ success: !!result.ok, cleared: !!result.cleared, message: result.message, user });
    } catch (e) {
        res.json({ success: false, message: 'Could not update that cooldown.' });
    }
});

async function forgetPhoneList(Model, arrayField, countField, phone) {
    const docs = await Model.find({ [arrayField]: phone });
    for (const doc of docs) {
        const before = Array.isArray(doc[arrayField]) ? doc[arrayField].length : 0;
        doc[arrayField] = (doc[arrayField] || []).filter((item) => String(item) !== phone);
        const removed = before - doc[arrayField].length;
        if (countField && removed > 0) {
            doc[countField] = Math.max(0, (Number(doc[countField]) || 0) - removed);
        }
        await doc.save();
    }
}

async function unseatDeletedUser(phone) {
    delete activeCooldowns[phone];
    delete winHistory[phone];
    delete timeBans[phone];
    delete penaltyMeta[phone];
    savePenalty(phone).catch(() => {});
    if (typeof buyingLocks !== 'undefined' && buyingLocks) delete buyingLocks[phone];

    const player = activePlayers[phone];
    committedRoundEntriesCache = (committedRoundEntriesCache || []).filter((entry) => {
        if (String(entry && entry.phone) !== phone) return true;
        const id = Number(entry && (entry.ticketId != null ? entry.ticketId : entry.id));
        committedEntryKeys.delete((Number(entry.gameId || entry.roundId || gameId)) + ':' + id);
        return false;
    });
    try {
        if (typeof RoundEntry !== 'undefined' && RoundEntry && RoundEntry.deleteMany) {
            await RoundEntry.deleteMany({ phone });
        }
    } catch (e) {}

    if (!player) return;

    const tickets = Array.isArray(player.ticketsData) ? player.ticketsData : [];
    const ids = tickets.map((ticket) => ticket && ticket.id).filter((id) => id != null);
    if (gameState === 'PLAYING') {
        totalTickets = Math.max(0, totalTickets - (Number(player.tickets) || tickets.length || 0));
    } else {
        let vaultMain = 0;
        tickets.forEach((ticket) => {
            const refund = gameEngine.refundCancelledCard(ticket);
            totalTickets = Math.max(0, totalTickets - 1);
            totalCollectedMoney = Math.max(0, Number((totalCollectedMoney - refund.refundTotal).toFixed(2)));
            totalPrizePool = Math.max(0, Number((totalPrizePool - refund.poolReversal).toFixed(2)));
            vaultMain += refund.refundMain;
        });
        if (vaultMain > 0) {
            const v3Cut = vaultMain * ((GLOBAL_SETTINGS.vaultThreePercent || 10) / 100);
            const v1Cut = vaultMain - v3Cut;
            GLOBAL_SETTINGS.virtualPrizePool = Math.max(0, (GLOBAL_SETTINGS.virtualPrizePool || 0) - v1Cut);
            GLOBAL_SETTINGS.vaultThreeBalance = Math.max(0, (GLOBAL_SETTINGS.vaultThreeBalance || 0) - v3Cut);
            await SystemSettings.updateOne({}, {
                $set: {
                    virtualPrizePool: GLOBAL_SETTINGS.virtualPrizePool,
                    vaultThreeBalance: GLOBAL_SETTINGS.vaultThreeBalance
                }
            });
        }
        if (ids.length) {
            roundCards.release(gameId, ids, phone);
            ticketLocks.release(ids, phone);
            releaseTicketsInMemory(ids);
            dropCommittedCacheTickets(ids);
        }
    }
    delete activePlayers[phone];
    io.emit('update_taken_tickets', getPublicTakenTickets());
    io.emit('balance_updated', phone);
}

async function releaseDeletedUserInviteSlot(user) {
    const referrerPhone = String(user && user.referredBy || '').trim();
    if (!referrerPhone) return;
    const referrer = await User.findOne({ phone: referrerPhone }).select('_id');
    if (!referrer) return;
    await User.updateOne(
        { _id: referrer._id, totalInvites: { $gt: 0 } },
        { $inc: { totalInvites: -1 } }
    );
    if (user.referredViaPromo) return;
    const created = user._id && typeof user._id.getTimestamp === 'function' ? user._id.getTimestamp() : null;
    if (!created) return;
    if (gameEngine.eatDayKey(created) !== gameEngine.eatDayKey(new Date())) return;
    await releaseReferralSignup(referrer._id, created);
}

async function purgeUserAccount(phone) {
    const target = normalizePhone(phone);
    if (!target) return { success: false, message: 'Phone required.' };
    const user = await User.findOne({ phone: target });
    if (!user) return { success: false, message: 'User not found.' };

    const telegramId = String(user.telegramId || '').trim();
    await unseatDeletedUser(target);
    await Transaction.deleteMany({ phone: target });
    const supportQuery = [{ phone: target }];
    if (telegramId) supportQuery.push({ telegramId });
    await SupportMessage.deleteMany({ $or: supportQuery });
    await SystemLog.deleteMany({ phone: target });
    await forgetPhoneList(ActiveBonus, 'claimedBy', 'currentClaims', target);
    await forgetPhoneList(PromoCode, 'usedBy', 'currentUses', target);

    const games = await GameHistory.find(gameHistoryQuery(target));
    for (const game of games) {
        const result = stripUserFromGame(game.toObject(), target);
        if (!result.changed) continue;
        if (result.remove) {
            await GameHistory.deleteOne({ _id: game._id });
        } else {
            Object.assign(game, result.patch);
            await game.save();
        }
    }

    if (telegramId && botState[telegramId]) delete botState[telegramId];
    if (botState[target]) delete botState[target];
    await releaseDeletedUserInviteSlot(user);
    await User.deleteOne({ _id: user._id });
    return { success: true, phone: target };
}

app.post('/api/admin/delete-user', auth, async (req, res) => {
    try {
        const result = await purgeUserAccount(req.body.phone);
        res.json(result.success ? { success: true } : { success: false, message: result.message || 'Could not delete user.' });
    } catch (e) {
        res.json({ success: false, message: 'Could not delete user.' });
    }
});

app.post('/api/admin/factory-reset', auth, async (req, res) => {
    await User.deleteMany({}); await Transaction.deleteMany({}); await GameHistory.deleteMany({}); await BankSMS.deleteMany({}); await ActiveBonus.deleteMany({}); 
    res.json({ success: true, message: "✅ ሲስተሙ ሙሉ በሙሉ ፀድቷል! ሁሉም ዳታ ጠፍቷል እንደ አዲስ ይጀምራል።" });
});

app.post('/api/admin/send-single-bonus', auth, async (req, res) => {
    let user = await User.findOne({ phone: String(req.body.phone) });
    if(user) { 
        user.playBalance += Number(req.body.amount); 
        await user.save(); 
        io.emit('balance_updated', user.phone); 
        res.json({ success: true, message: `✅ Bonus of ${req.body.amount} ETB successfully sent to ${req.body.phone}!` });
    } else {
        res.json({ success: false, message: `❌ User with phone ${req.body.phone} not found! Check the number.` });
    }
});

app.post('/api/admin/send-single-bonus', auth, async (req, res) => {
    let user = await User.findOne({ phone: String(req.body.phone) });
    if(user) { 
        user.playBalance += Number(req.body.amount); 
        await user.save(); 
        io.emit('balance_updated', user.phone); 
        res.json({ success: true, message: `✅ Bonus of ${req.body.amount} ETB successfully sent to ${req.body.phone}!` });
    } else {
        res.json({ success: false, message: `❌ User with phone ${req.body.phone} not found! Check the number.` });
    }
});

app.post('/api/admin/send-bulk-bonus', auth, async (req, res) => {
    if (req.body.phones === "ALL") { await User.updateMany({}, { $inc: { playBalance: Number(req.body.amount) } }); } 
    else { await User.updateMany({ phone: { $in: req.body.phones } }, { $inc: { playBalance: Number(req.body.amount) } }); }
    res.json({ success: true, message: `✅ Bulk Bonus of ${req.body.amount} ETB successfully sent!` });
});

app.post('/api/admin/claim-bonus-list', auth, async (req, res) => {
    try {
        let activeBonus = await ActiveBonus.findOne({ isActive: true });
        if(!activeBonus) return res.json({ success: false, message: "No active promo." });
        res.json({ success: true, claimedBy: activeBonus.claimedBy, max: activeBonus.maxUsers });
    } catch(e) { res.status(500).json({ success: false }); }
});

// 🔥 አዲሱ እና ፈጣኑ የቦነስ መፍጠሪያ እና ብሮድካስት (Background Sender)
let isBroadcasting = false;
let lastBroadcasts = [];
let latestClaimAnnouncement = null;
let claimDeleteInProgress = false;

function claimSendStopped(batch) {
    return !batch || batch.status === 'deleted' || batch.status === 'idle' || batch.status === 'deleting';
}

async function startClaimAnnouncementBatch() {
    const createdAt = new Date();
    const batch = claimBroadcast.createMemoryBatch('mem-' + createdAt.getTime(), createdAt.getTime());
    try {
        await ClaimBroadcast.updateMany({ kind: 'claim', isLatest: true }, { $set: { isLatest: false } });
        const doc = await ClaimBroadcast.create({ kind: 'claim', createdAt, isLatest: true, status: 'sending' });
        batch.id = String(doc._id);
        const previous = await ClaimBroadcast.find({ _id: { $ne: doc._id }, kind: 'claim' }).select('_id').lean();
        const staleIds = previous.map((row) => String(row._id));
        if (staleIds.length) await ClaimBroadcastMessage.deleteMany({ batchId: { $in: staleIds } });
    } catch (e) {
        console.log('Claim announcement tracked in memory:', e && e.message);
    }
    latestClaimAnnouncement = batch;
    return batch;
}

async function trackClaimDelivery(batch, chatId, messageId) {
    const stored = claimBroadcast.rememberMessage(batch, chatId, messageId);
    if (!stored || !claimBroadcast.isDbBatchId(batch && batch.id)) return stored;
    try {
        await ClaimBroadcastMessage.create({
            batchId: String(batch.id),
            chatId: String(chatId),
            messageId: Number(messageId)
        });
    } catch (e) {}
    return stored;
}

async function loadLatestClaimAnnouncement() {
    if (latestClaimAnnouncement && !claimSendStopped(latestClaimAnnouncement)) return latestClaimAnnouncement;
    try {
        const doc = await ClaimBroadcast.findOne({ kind: 'claim', isLatest: true, status: { $ne: 'deleted' } }).sort({ createdAt: -1 }).lean();
        if (!doc) return latestClaimAnnouncement;
        const rows = await ClaimBroadcastMessage.find({ batchId: String(doc._id) }).select('chatId messageId').lean();
        const batch = claimBroadcast.createMemoryBatch(String(doc._id), new Date(doc.createdAt).getTime());
        batch.status = doc.status || 'complete';
        rows.forEach((row) => claimBroadcast.rememberMessage(batch, row.chatId, row.messageId));
        latestClaimAnnouncement = batch;
        return batch;
    } catch (e) {
        return latestClaimAnnouncement;
    }
}

async function deleteStrayClaimMessage(chatId, messageId) {
    if (messageId == null) return;
    await claimBroadcast.deleteTrackedMessages(
        [{ chatId, messageId }],
        (targetChatId, targetMessageId) => bot.deleteMessage(targetChatId, targetMessageId),
        (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        { gapMs: 0 }
    );
}

async function deleteLatestClaimAnnouncement() {
    if (claimDeleteInProgress) {
        return { success: false, deleted: 0, failed: 0, message: 'A claim announcement delete is already running.' };
    }
    claimDeleteInProgress = true;
    try {
        const batch = await loadLatestClaimAnnouncement();
        if (!batch || claimSendStopped(batch)) {
            return { success: false, deleted: 0, failed: 0, message: claimBroadcast.summarizeDeleteResult(null, { empty: true }) };
        }
        if (!batch.messages || batch.messages.length === 0) {
            batch.status = 'deleting';
            if (claimBroadcast.isDbBatchId(batch.id)) {
                try {
                    await ClaimBroadcast.updateOne({ _id: batch.id }, { $set: { status: 'deleted', isLatest: false, deletedAt: new Date() } });
                } catch (e) {}
            }
            return { success: false, deleted: 0, failed: 0, message: 'No claim announcement messages were saved yet. Further sends were stopped.' };
        }
        const batchId = batch.id;
        batch.status = 'deleting';
        const snapshot = batch.messages.slice();
        const result = await claimBroadcast.deleteTrackedMessages(
            snapshot,
            (chatId, messageId) => bot.deleteMessage(chatId, messageId),
            (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        );
        const kept = result.kept || [];
        batch.messages = kept.slice();
        batch.status = kept.length ? 'complete' : 'idle';
        if (!kept.length) {
            latestClaimAnnouncement = claimBroadcast.createMemoryBatch(null, Date.now());
            latestClaimAnnouncement.status = 'idle';
        }
        if (claimBroadcast.isDbBatchId(batchId)) {
            try {
                if (!kept.length) {
                    await ClaimBroadcastMessage.deleteMany({ batchId: String(batchId) });
                    await ClaimBroadcast.updateOne({ _id: batchId }, { $set: { status: 'deleted', isLatest: false, deletedAt: new Date() } });
                } else {
                    await ClaimBroadcastMessage.deleteMany({
                        batchId: String(batchId),
                        messageId: { $nin: kept.map((row) => row.messageId) }
                    });
                    await ClaimBroadcast.updateOne({ _id: batchId }, { $set: { status: 'complete', isLatest: true } });
                }
            } catch (e) {}
        }
        return {
            success: true,
            deleted: result.deleted,
            failed: result.failed,
            blocked: result.blocked,
            missing: result.missing,
            retryable: result.retryable,
            message: claimBroadcast.summarizeDeleteResult(result)
        };
    } finally {
        claimDeleteInProgress = false;
    }
} 

app.post('/api/admin/create-claim-bonus', auth, async (req, res) => {
    if (isBroadcasting) return res.json({ success: false, message: "⚠️ አሁን ሌላ መልዕክት በመላክ ላይ ነው። እባክዎ ትንሽ ይጠብቁ!" });
    isBroadcasting = true;
    
    try {
        const { maxUsers, amount, minutes, message, photoUrl, depositorsOnly, minDepositAmount, requireDepositWithinHours, platform } = req.body;
        let expires = new Date(Date.now() + (minutes * 60000));
        await ActiveBonus.updateMany({}, { isActive: false });
        
        await new ActiveBonus({ 
            amount, maxUsers, expiresAt: expires, isActive: true, 
            depositorsOnly: depositorsOnly,
            minDepositAmount: minDepositAmount || 0,
            requireDepositWithinHours: requireDepositWithinHours || 0
        }).save();
        
        if (platform === 'web' || platform === 'both') {
            io.emit('new_promo_alert', { amount: amount, msg: message });
        }

        if ((platform === 'tg' || platform === 'both') && message) {
            let query = { telegramId: { $ne: "" } };
            // 🔥 .select() እና .lean() ተጠቅመን RAM እንዳይሞላ አድርገነዋል
            const users = await User.find(query).select('telegramId phone').lean();
            
            res.json({ success: true, message: `✅ ቦነሱ ተፈጥሯል! ለ ${users.length} ሰዎች በቴሌግራም ከበስተጀርባ (Background) መላክ ጀምሯል...` });

            (async () => {
                const batch = await startClaimAnnouncementBatch();
                const opts = { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: `🎁 Claim ${amount} ETB Bonus`, callback_data: 'claim_promo' }]] } };
                
                let photoBuffer = null;
                if (photoUrl && photoUrl.startsWith('data:image')) {
                    let base64Data = photoUrl.replace(/^data:image\/\w+;base64,/, ""); 
                    photoBuffer = Buffer.from(base64Data, 'base64');
                }

                for (let u of users) {
                    if (claimSendStopped(latestClaimAnnouncement)) break;
                    if(depositorsOnly) {
                        if (requireDepositWithinHours > 0) {
                            let cutoff = new Date(Date.now() - (requireDepositWithinHours * 60 * 60 * 1000));
                            let recentDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (minDepositAmount || 0) }, date: { $gte: cutoff } }).lean();
                            if (!recentDep) continue;
                        } else {
                            let validDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (minDepositAmount || 0) } }).lean();
                            if (!validDep) continue;
                        }
                    }

                    try {
                        let sentMsg;
                        if (photoBuffer) {
                            sentMsg = await bot.sendPhoto(u.telegramId, photoBuffer, { caption: message, ...opts });
                        } else if (photoUrl && photoUrl.startsWith('http')) { 
                            sentMsg = await bot.sendPhoto(u.telegramId, photoUrl, { caption: message, ...opts });
                        } else { 
                            sentMsg = await bot.sendMessage(u.telegramId, message, opts); 
                        }
                        if (sentMsg && sentMsg.message_id) {
                            if (claimSendStopped(latestClaimAnnouncement)) {
                                await deleteStrayClaimMessage(u.telegramId, sentMsg.message_id);
                            } else {
                                await trackClaimDelivery(batch, u.telegramId, sentMsg.message_id);
                            }
                        }
                    } catch(e) {} 
                    
                    await new Promise(resolve => setTimeout(resolve, 40));
                }
                if (batch.status === 'sending') {
                    batch.status = 'complete';
                    if (claimBroadcast.isDbBatchId(batch.id)) {
                        ClaimBroadcast.updateOne({ _id: batch.id }, { $set: { status: 'complete' } }).catch(() => {});
                    }
                }
                isBroadcasting = false; 
            })();
        } else {
            res.json({ success: true, message: `✅ ቦነሱ በተሳካ ሁኔታ ዌብሳይት ላይ ብቻ ተለቋል!` });
            isBroadcasting = false;
        }
    } catch (e) {
        isBroadcasting = false;
        if (!res.headersSent) res.status(500).json({ success: false, message: "Error processing promo." });
    }
});

app.post('/api/admin/broadcast-telegram', auth, async (req, res) => {
    if (isBroadcasting) return res.json({ success: false, message: "⚠️ አሁን ሌላ መልዕክት በመላክ ላይ ነው። እባክዎ ይጠብቁ!" });
    isBroadcasting = true;
    try {
        const { message, photoUrl, depositorsOnly, minDepositAmount, requireDepositWithinHours } = req.body;
        if (!message) {
            isBroadcasting = false;
            return res.json({ success: false, message: "No message entered." });
        }
        
        let query = { telegramId: { $ne: "" } };
        // 🔥 .select() እና .lean() ተጠቅመን ሰርቨሩ እንዳይዘጋ አድርገነዋል
        const users = await User.find(query).select('telegramId phone').lean();
        lastBroadcasts = []; 
        
        res.json({ success: true, message: `✅ መልዕክቱ መላክ ጀምሯል። ለ ${users.length} ሰዎች ከበስተጀርባ (Background) ይላካል።` });

        (async () => {
            let photoBuffer = null;
            if (photoUrl && photoUrl.startsWith('data:image')) {
                let base64Data = photoUrl.replace(/^data:image\/\w+;base64,/, ""); 
                photoBuffer = Buffer.from(base64Data, 'base64');
            }

            for (let u of users) {
                if(depositorsOnly) {
                    if (requireDepositWithinHours > 0) {
                        let cutoff = new Date(Date.now() - (requireDepositWithinHours * 60 * 60 * 1000));
                        let recentDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (minDepositAmount || 0) }, date: { $gte: cutoff } }).lean();
                        if (!recentDep) continue;
                    } else {
                        let validDep = await Transaction.findOne({ phone: u.phone, type: 'deposit', status: 'Approved', amount: { $gte: (minDepositAmount || 0) } }).lean();
                        if (!validDep) continue;
                    }
                }

                try {
                    let sentMsg;
                    if (photoBuffer) {
                        sentMsg = await bot.sendPhoto(u.telegramId, photoBuffer, { caption: message, parse_mode: "HTML" });
                    } else if (photoUrl && photoUrl.startsWith('http')) { 
                        sentMsg = await bot.sendPhoto(u.telegramId, photoUrl, { caption: message, parse_mode: "HTML" });
                    } else { 
                        sentMsg = await bot.sendMessage(u.telegramId, message, { parse_mode: "HTML" }); 
                    }
                    lastBroadcasts.push({ chatId: u.telegramId, messageId: sentMsg.message_id }); 
                } catch(e) {} 
                
                await new Promise(resolve => setTimeout(resolve, 40));
            }
            isBroadcasting = false;
        })();
        
    } catch (e) { 
        isBroadcasting = false;
    } 
});

app.post('/api/admin/delete-broadcast', auth, async (req, res) => {
    try {
        if(lastBroadcasts.length === 0) return res.json({ success: false, message: "No recent broadcast found." });
        let count = 0;
        for (let b of lastBroadcasts) { try { await bot.deleteMessage(b.chatId, b.messageId); count++; } catch(e) {} }
        lastBroadcasts = []; res.json({ success: true, message: `🗑️ Deleted ${count} messages.` });
    } catch(e) { res.status(500).json({ success: false, message: "Error deleting broadcast." }); }
});

app.post('/api/admin/delete-claim-announcement', auth, async (req, res) => {
    try {
        const summary = await deleteLatestClaimAnnouncement();
        res.json(summary);
    } catch (e) {
        res.status(500).json({ success: false, deleted: 0, failed: 0, message: 'Error deleting the claim announcement.' });
    }
});

app.post('/api/admin/inject-live-bots', auth, async (req, res) => {
    try {
        if (gameState !== "WAITING") {
            return res.json({ success: false, message: "❌ ጌሙ እየተጫወተ ነው! ቦቶችን ማስገባት የሚቻለው ሰዓት እየቆጠረ (WAITING) ላይ ሲሆን ብቻ ነው።" });
        }

        let amount = parseInt(req.body.amount, 10);
        if (!amount || amount <= 0) return res.json({ success: false, message: "ትክክለኛ ቁጥር ያስገቡ!" });

        let d1 = req.body.dist1 !== undefined ? req.body.dist1 : (GLOBAL_SETTINGS.botDist1 || 5);
        let d2 = req.body.dist2 !== undefined ? req.body.dist2 : (GLOBAL_SETTINGS.botDist2 || 4);
        let d3 = req.body.dist3 !== undefined ? req.body.dist3 : (GLOBAL_SETTINGS.botDist3 || 3);
        let d4 = req.body.dist4 !== undefined ? req.body.dist4 : (GLOBAL_SETTINGS.botDist4 || 3);

        botRosterRequested = true;
        const generation = ++botFillGeneration;
        const added = await enqueueJoinedBots(amount, [d1, d2, d3, d4], generation);
        if (!added) return res.json({ success: false, message: "በዳታቤዝ ውስጥ ምንም ቦት የለም ወይም ካርቴላ አልቀዋል!" });

        if (!GLOBAL_SETTINGS.isBotScheduleActive) {
            botRampController.applyManualOverride(amount);
        }

        res.json({ success: true, message: `✅ ${added} ቦቶች ወረፋ ይዘዋል። ሰዓቱ እያለቀ ሲሄድ ልክ እንደ ሰው ቀስ እያሉ (Randomly) ጌሙን ይቀላቀላሉ!` });

    } catch (e) {
        res.json({ success: false, message: "❌ ስህተት አጋጥሟል!" });
    }
});

// ==========================================
// 🟢 LIVE BINGO GAME ENGINE
// ==========================================
let gameState = "WAITING";
let gameClock = 40; 
let activePlayers = {}; 
let totalPrizePool = 0; 
let jackpotBoostAmount = 0; 
let totalCollectedMoney = 0; 
let totalTickets = 0;
let calledNumbers = []; 
let currentDrawSequence = []; 
let gameId = 0;
let roundSerial = 0;
let issuedRoundFloor = 0;

async function highestPersistedRoundId() {
    let maxId = 0;
    function take(row) {
        if (!row) return;
        maxId = Math.max(maxId, Number(row.gameId) || 0, Number(row.roundId) || 0);
    }
    try {
        take(await GameHistory.findOne().sort({ gameId: -1 }).select('gameId roundId').lean());
        take(await GameHistory.findOne().sort({ roundId: -1 }).select('gameId roundId').lean());
    } catch (e) {}
    try {
        take(await RoundEntry.findOne().sort({ gameId: -1 }).select('gameId roundId').lean());
        take(await RoundEntry.findOne().sort({ roundId: -1 }).select('gameId roundId').lean());
    } catch (e) {}
    return Math.max(maxId, issuedRoundFloor);
}

const liveRoundIds = gameEngine.createRoundIdAllocator({
    highest: function () { return highestPersistedRoundId(); },
    read: async function () {
        const row = await SystemSettings.findOne().sort({ _id: 1 }).select('nextRoundId').lean();
        return Math.max(Number(row && row.nextRoundId) || 0, issuedRoundFloor);
    },
    compareAndSet: async function (observed, next, base) {
        const claim = await SystemSettings.findOneAndUpdate(
            { $or: [{ nextRoundId: { $exists: false } }, { nextRoundId: null }, { nextRoundId: { $lte: base } }] },
            { $set: { nextRoundId: next } },
            { new: true, sort: { _id: 1 } }
        );
        if (claim && Number(claim.nextRoundId) === next) {
            issuedRoundFloor = next;
            return true;
        }
        const any = await SystemSettings.findOne().sort({ _id: 1 }).select('_id nextRoundId').lean();
        if (any) return false;
        try {
            const created = await SystemSettings.create({ nextRoundId: next });
            if (Number(created.nextRoundId) === next) {
                issuedRoundFloor = next;
                return true;
            }
        } catch (e) {}
        return false;
    }
});

function publishNextRound(reason) {
    const serial = ++roundSerial;
    return liveRoundIds.allocate().then((id) => {
        if (serial !== roundSerial) return gameId;
        gameId = id;
        if (reason === 'reset') {
            roundCardGridSeed = Number(GLOBAL_SETTINGS.cardGridSeed) || 0;
            roundGridSeedLocked = true;
            io.emit('update_taken_tickets', globalTakenTickets);
        }
        return id;
    });
}

function ensureNextRound(reason) {
    return publishNextRound(reason).catch((err) => {
        console.error('round id allocation failed', err && err.message);
        return new Promise((resolve) => {
            setTimeout(() => resolve(ensureNextRound(reason)), 1000);
        });
    });
}
let globalTakenTickets = [];
const takenIdSet = new Set();
const cardBoard = gameEngine.createCardBoard(gameEngine.TOTAL_CARDS);
let committedRoundEntriesCache = [];
const committedEntryKeys = new Set();
let takenBroadcastTimer = null;
const ticketLocks = gameEngine.createTicketLockBoard();
const roundCards = gameEngine.createRoundCardLedger(); 

let gameBotsQueue = [];
let botFillGeneration = 0;
let botRosterRequested = false;
let botFillInFlight = false;
let botFillHolds = 0;
let botJoinChain = Promise.resolve();
let botWinTargetTurn = null; 
let mixWinTargetTurn = null; 
let dynamicWinTurn = null; // winning call, rotated through 14–23
let roundForceWinner = null;
let roundSoloRecorded = false;
let roundMixBotCount = null;
let roundTargetPhone = null;
let roundLineIndex = null;
let roundResolutionLocked = false;
let roundLockReason = null;
let roundNetSplitFloor = 0;
let roundAllowBonusWin = null;
let mixDepWinnersHistory = []; 
let activeCooldowns = {}; // 🔥 የጌም ብዛት ቅጣት (30, 20, 10 ጌም)
let winHistory = {}; // 🔥 በ1 ሰዓት ውስጥ ያሸነፉበትን ሰዓት የሚመዘግብ
let timeBans = {}; // 🔥 ለ1 ሰዓት የታገዱ (Time Ban)
let penaltyMeta = {};

async function savePenalty(phone) {
    const key = String(phone || '');
    if (!key) return;
    const games = Number(activeCooldowns[key] || 0);
    const until = Number(timeBans[key] || 0);
    const activeTime = until > Date.now();
    const meta = penaltyMeta[key] || {};
    if (games <= 0 && !activeTime) {
        delete activeCooldowns[key];
        delete timeBans[key];
        delete penaltyMeta[key];
        try { await UserPenalty.deleteOne({ phone: key }); } catch (e) {}
        return;
    }
    const reason = cooldownManager.describePenalty(meta.kind, activeTime, games);
    try {
        await UserPenalty.updateOne(
            { phone: key },
            { $set: { phone: key, gamesRemaining: Math.max(0, games), bannedUntil: activeTime ? until : 0, kind: meta.kind || '', reason, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (e) {}
}

async function hydratePenaltiesFromDb() {
    let rows = [];
    try { rows = await UserPenalty.find({}).lean(); } catch (e) { return; }
    const now = Date.now();
    for (const row of rows) {
        const phone = String(row.phone || '');
        if (!phone) continue;
        const games = Number(row.gamesRemaining) || 0;
        const until = Number(row.bannedUntil) || 0;
        const alreadyLive = activeCooldowns[phone] != null || timeBans[phone] != null || penaltyMeta[phone];
        if (alreadyLive) {
            savePenalty(phone).catch(() => {});
            continue;
        }
        if (games > 0) activeCooldowns[phone] = games;
        if (until > now) timeBans[phone] = until;
        if (row.kind) penaltyMeta[phone] = { kind: row.kind };
        if (games <= 0 && until <= now) UserPenalty.deleteOne({ phone }).catch(() => {});
    }
}

function whenDbReady(fn) {
    if (mongoose.connection.readyState === 1) fn();
    else mongoose.connection.once('open', fn);
}
whenDbReady(() => {
    hydratePenaltiesFromDb().catch(() => {});
    ensureNextRound('boot').catch((err) => console.error('round id bootstrap failed', err && err.message));
});

function serverCheckBingo(grid, called) {
    let calledSet = new Set(called.map(n => Number(n)));
    calledSet.add("FREE");

    let m = [];
    for (let c = 0; c < 5; c++) {
        m[c] = [];
        for (let r = 0; r < 5; r++) {
            let val = grid[c][r];
            m[c][r] = (val === "FREE") ? true : calledSet.has(Number(val));
        }
    }

    for (let c = 0; c < 5; c++) {
        if (m[c][0] && m[c][1] && m[c][2] && m[c][3] && m[c][4]) return true;
    }
    for (let r = 0; r < 5; r++) {
        if (m[0][r] && m[1][r] && m[2][r] && m[3][r] && m[4][r]) return true;
    }
    if (m[0][0] && m[1][1] && m[2][2] && m[3][3] && m[4][4]) return true;
    if (m[0][4] && m[1][3] && m[2][2] && m[3][1] && m[4][0]) return true;
    if (m[0][0] && m[0][4] && m[4][0] && m[4][4]) return true;

    return false;
}

function normalizeIncomingTicketIds(rawIds, ticketsData) {
    const fromPayload = Array.isArray(rawIds) ? rawIds : [];
    const fromTickets = Array.isArray(ticketsData) ? ticketsData.map((t) => t && t.id) : [];
    return gameEngine.normalizeIds(fromPayload.length ? fromPayload : fromTickets);
}

function seatedOwnerOfTicket(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    return cardBoard.ownerOf(n);
}

function rebuildTakenFromSeated() {
    const set = new Set();
    const ownerById = new Map();
    Object.keys(activePlayers).forEach((phone) => {
        const p = activePlayers[phone];
        (p && p.ticketsData || []).forEach((t) => {
            const n = Number(t && t.id);
            if (Number.isInteger(n) && n > 0) {
                set.add(n);
                ownerById.set(n, String(phone));
            }
        });
    });
    (committedRoundEntriesCache || []).forEach((entry) => {
        if (!entry || entry.status === 'cancelled') return;
        if (Number(entry.gameId || entry.roundId) !== Number(gameId)) return;
        const n = Number(entry.ticketId || entry.id);
        if (Number.isInteger(n) && n > 0) {
            set.add(n);
            if (!ownerById.has(n) && entry.phone) ownerById.set(n, String(entry.phone));
        }
    });
    // A card reserved for an in-flight purchase is not seated yet. Keep it
    // so a rebuild cannot hand that id to someone else through the fast index.
    takenIdSet.forEach((id) => {
        if (!set.has(id) && roundCards.isSelected(gameId, id)) set.add(id);
    });
    const dropped = [];
    takenIdSet.forEach((id) => {
        if (!set.has(id)) dropped.push(id);
    });
    for (let i = 0; i < dropped.length; i++) {
        takenIdSet.delete(dropped[i]);
        cardBoard.markFree(dropped[i]);
    }
    set.forEach((id) => {
        takenIdSet.add(id);
        cardBoard.markTaken(id, ownerById.get(id));
    });
    globalTakenTickets = Array.from(set);
    return globalTakenTickets;
}

function broadcastTakenTickets() {
    if (takenBroadcastTimer) return;
    takenBroadcastTimer = setTimeout(() => {
        takenBroadcastTimer = null;
        io.emit('update_taken_tickets', globalTakenTickets);
    }, 50);
}

function isConfirmedTakenByOther(id, phone) {
    const owner = seatedOwnerOfTicket(id);
    return !!(owner && owner !== String(phone || ''));
}

function isTicketTaken(id) {
    const n = Number(id);
    if (takenIdSet.has(n) || cardBoard.isTaken(n)) return true;
    return ticketLocks.isPending(n) && !ticketLocks.isStale(n);
}

function getPublicTakenTickets() {
    return ticketLocks.mergePublicTaken(rebuildTakenFromSeated());
}

function rejectTickets(socket, ids, reason) {
    const ticketIds = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (socket) {
        socket.emit('ticket_rejected', { ticketIds, reason, committed: false, currentRoundId: gameId });
    }
}

function confirmTicketsLocked(socket, phone, ids) {
    if (!socket) return;
    const ack = gameEngine.committedLockAck(activePlayers[phone], ids, gameId);
    if (!ack) return;
    socket.emit('ticket_locked', ack);
}

function hydrateSeatedFromCache() {
    if (Array.isArray(committedRoundEntriesCache) && committedRoundEntriesCache.length) {
        gameEngine.hydratePlayersFromEntries(activePlayers, committedRoundEntriesCache);
    }
}

function seasonIsLive(now) {
    const state = gameEngine.seasonState(now == null ? Date.now() : now, seasonSettingsSnapshot());
    return !!(state && state.active);
}

let seasonBumpCache = { at: 0, state: null };
async function bumpSeasonCards(user, delta) {
    if (!user) return;
    const now = Date.now();
    const preview = gameEngine.seasonState(now, seasonSettingsSnapshot());
    if (!preview.active && !preview.elapsed) return;
    let state = seasonBumpCache.state;
    if (!state || (now - seasonBumpCache.at) > 1500) {
        state = await ensureSeasonFrozen(now);
        seasonBumpCache = { at: now, state };
    }
    if (!state.active || !state.seasonId) return;
    if (user.seasonId !== state.seasonId) {
        user.seasonId = state.seasonId;
        user.seasonCardsPlayed = 0;
    }
    user.seasonCardsPlayed = Math.max(0, (Number(user.seasonCardsPlayed) || 0) + Number(delta || 0));
}

async function recoverOwnCommittedTickets(socket, phone, ids, name) {
    const nums = (ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const wantPhone = String(phone || '');
    if (!nums.length || !wantPhone) return false;

    if (nums.every((id) => seatedOwnerOfTicket(id) === wantPhone) && activePlayers[wantPhone]) {
        ticketLocks.release(nums, wantPhone);
        confirmTicketsLocked(socket, wantPhone, nums);
        return true;
    }

    let entries = [];
    try {
        entries = await RoundEntry.find({ gameId, ticketId: { $in: nums }, status: 'active' }).lean();
    } catch (e) {
        return false;
    }
    if (entries.length !== nums.length) return false;
    if (entries.some((e) => String(e.phone) !== wantPhone)) return false;

    let seatedUser = null;
    try {
        seatedUser = await User.findOne({ phone: wantPhone }).select('totalDeposited totalWithdrawn depositTodayEtb won roundsTodayWithoutWin winsToday dailyRealBets dailyWins eatDayKey').lean();
    } catch (e) {
        seatedUser = null;
    }
    const seatedDeposited = seatedUser ? (Number(seatedUser.totalDeposited) || 0) : 0;
    const seatedWithdrawn = seatedUser ? (Number(seatedUser.totalWithdrawn) || 0) : 0;
    const seatedLoss = gameEngine.rolloverDailyLoss(seatedUser, Date.now());
    gameEngine.hydratePlayersFromEntries(activePlayers, entries, (p, tickets, phoneEntries) => {
        const sample = (phoneEntries && phoneEntries[0]) || {};
        return {
            name: name || sample.name || p,
            phone: p,
            tickets: tickets.length,
            ticketsData: tickets,
            isBot: false,
            hasDeposited: seatedDeposited > 0,
            realBetAmount: seatRealStake(tickets),
            bonusBetAmount: tickets.reduce((sum, t) => sum + (Number(t.paidFromBonus) || 0), 0),
            won: seatedUser ? (Number(seatedUser.won) || 0) : 0,
            depositTodayEtb: seatedUser ? (Number(seatedUser.depositTodayEtb) || 0) : 0,
            totalDeposited: seatedDeposited,
            totalWithdrawn: seatedWithdrawn,
            netContribution: seatedDeposited - seatedWithdrawn,
            roundsTodayWithoutWin: seatedUser ? (Number(seatedUser.roundsTodayWithoutWin) || 0) : 0,
            winsToday: seatedUser ? (Number(seatedUser.winsToday) || 0) : 0,
            dailyRealBets: seatedLoss.dailyRealBets,
            dailyWins: seatedLoss.dailyWins,
            eatDayKey: seatedLoss.eatDayKey
        };
    });
    reserveTicketsInMemory(nums);
    ticketLocks.release(nums, wantPhone);
    confirmTicketsLocked(socket, wantPhone, nums);
    io.emit('update_taken_tickets', getPublicTakenTickets());
    return true;
}

function reserveTicketsInMemory(ids) {
    ids.forEach((id) => {
        const n = Number(id);
        if (!Number.isInteger(n) || n <= 0 || takenIdSet.has(n)) return;
        if (ticketLocks.isPending(n) && !ticketLocks.isStale(n)) return;
        takenIdSet.add(n);
        cardBoard.markTaken(n);
        globalTakenTickets.push(n);
    });
}

function forgetTakenIds(ids) {
    const drop = new Set(gameEngine.normalizeIds(ids));
    if (!drop.size) return;
    drop.forEach((id) => {
        takenIdSet.delete(id);
        cardBoard.markFree(id);
    });
    if (globalTakenTickets.length) {
        globalTakenTickets = globalTakenTickets.filter((id) => !drop.has(Number(id)));
    }
}

function releaseTicketsInMemory(ids) {
    forgetTakenIds(ids);
}

async function clearCancelledRoundEntries(ticketIds, session) {
    const ids = gameEngine.normalizeIds(ticketIds);
    if (!ids.length) return;
    const opts = session ? { session } : {};
    await RoundEntry.deleteMany({ gameId, ticketId: { $in: ids }, status: { $ne: 'active' } }, opts);
}

function dropCommittedCacheTickets(ids) {
    const drop = new Set(gameEngine.normalizeIds(ids));
    if (drop.size) {
        drop.forEach((id) => committedEntryKeys.delete(Number(gameId) + ':' + id));
    }
    committedRoundEntriesCache = gameEngine.dropCommittedEntries(committedRoundEntriesCache, ids);
}

function emitTicketReleased(socket, phone, ticketIds) {
    const nums = gameEngine.normalizeIds(ticketIds);
    const wantPhone = String(phone || '');
    ticketLocks.release(nums, wantPhone);
    releaseTicketsInMemory(nums);
    dropCommittedCacheTickets(nums);
    const currentState = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
    const seated = activePlayers[wantPhone];
    if (socket) {
        socket.emit('sync_data', {
            gameState: currentState,
            globalTakenTickets: getPublicTakenTickets(),
            calledNumbers: calledNumbers,
            myTickets: gameEngine.ticketsForActiveRound(seated ? seated.ticketsData : [], gameId),
            pendingTicketIds: ticketLocks.pendingIdsForPhone(wantPhone),
            gameId,
            currentRoundId: gameId
        });
        nums.forEach((id) => socket.emit('ticket_cancelled_success', id));
    }
    io.emit('update_taken_tickets', getPublicTakenTickets());
}

async function persistRoundEntries(phone, name, ticketsData, isBot, session) {
    if (!Array.isArray(ticketsData) || ticketsData.length === 0) return;
    const docs = ticketsData.map((t) => ({
        gameId,
        roundId: gameId,
        phone: String(phone),
        name: name || '',
        ticketId: Number(t.id),
        grid: t.grid,
        paidFromPlay: t.paidFromPlay || 0,
        paidFromMain: t.paidFromMain || 0,
        paidFromBonus: t.paidFromBonus || 0,
        mainWalletBlocked: !!t.mainWalletBlocked,
        platformFee: t.platformFee || 0,
        netToPool: t.netToPool || 0,
        cardFilter: t.cardFilter || '',
        isBot: !!isBot,
        status: 'active',
        committedAt: new Date()
    }));
    const opts = session ? { session, ordered: true } : { ordered: true };
    try {
        await RoundEntry.insertMany(docs, opts);
    } catch (err) {
        if (!(err && err.code === 11000)) throw err;
        await clearCancelledRoundEntries(docs.map((d) => d.ticketId), session);
        await RoundEntry.insertMany(docs, opts);
    }
}

async function cancelRoundEntry(phone, ticketId, session) {
    const opts = session ? { session } : {};
    await RoundEntry.deleteMany(
        { gameId, phone: String(phone), ticketId: Number(ticketId) },
        opts
    );
}

async function loadCommittedRoundEntries() {
    return RoundEntry.find({ gameId, status: 'active' }).lean();
}

function mergePlayersDataForHistory(memoryPlayers, entries) {
    const merged = gameEngine.snapshotPlayers(memoryPlayers || {});
    gameEngine.hydratePlayersFromEntries(merged, entries || []);
    return Object.values(merged);
}

function getRiggedSequence() {
    return Array.from({length: 75}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
}

function warmRoundLineIndex() {
    try {
        const entries = (committedRoundEntriesCache || []).filter((entry) => {
            if (!entry || entry.status === 'cancelled') return false;
            return Number(entry.gameId || entry.roundId || gameId) === Number(gameId);
        });
        if (entries.length) gameEngine.hydratePlayersFromEntries(activePlayers, entries);
        roundLineIndex = gameEngine.buildRoundLineIndex(activePlayers, {
            gridOf: (ticket) => assignedCardGrid(ticket)
        });
        if (calledNumbers.length) roundLineIndex.syncCalled(calledNumbers);
        gameEngine.primeDrawLookup(roundLineIndex, activePlayers);
    } catch (err) {
        console.error('pre-round line index warmup failed', err);
        roundLineIndex = null;
    }
    return roundLineIndex;
}

// Card numbers are deterministic for (card id, round seed) and then frozen.
function generateFixedCard(ticketId) {
    const id = Number(ticketId);
    const frozen = roundCards.getGrid(gameId, id);
    if (frozen) return frozen;
    const grid = gameEngine.generateFixedCard(id, roundCardGridSeed);
    return roundCards.freezeGrid(gameId, id, grid);
}

function assignedCardGrid(ticket) {
    if (!ticket) return null;
    const frozen = roundCards.getGrid(gameId, ticket.id);
    if (frozen) return frozen;
    return gameEngine.cloneGrid(ticket.grid);
}

function playersDataWithAssignedGrids(players) {
    return Object.values(players || {}).map((player) => {
        const ticketsData = (player && player.ticketsData || []).map((ticket) => {
            return Object.assign({}, ticket, { grid: assignedCardGrid(ticket) });
        });
        return Object.assign({}, player, { ticketsData });
    });
}

function cacheCommittedTickets(phone, name, ticketsData, isBot) {
    const tickets = (ticketsData || []).map((ticket) => {
        return Object.assign({}, ticket, { id: Number(ticket && ticket.id), grid: assignedCardGrid(ticket) || (ticket && ticket.grid) });
    }).filter((ticket) => Number.isInteger(ticket.id) && ticket.id > 0 && Array.isArray(ticket.grid));
    if (!tickets.length) return [];
    const live = activePlayers[String(phone)] || {};
    const fresh = [];
    tickets.forEach((ticket) => {
        const key = Number(gameId) + ':' + Number(ticket.id);
        if (committedEntryKeys.has(key)) return;
        committedEntryKeys.add(key);
        fresh.push({
            gameId: gameId,
            roundId: gameId,
            phone: String(phone),
            name: name || live.name || '',
            ticketId: Number(ticket.id),
            grid: ticket.grid,
            paidFromPlay: ticket.paidFromPlay || 0,
            paidFromMain: ticket.paidFromMain || 0,
            paidFromBonus: ticket.paidFromBonus || 0,
            mainWalletBlocked: !!ticket.mainWalletBlocked,
            platformFee: ticket.platformFee || 0,
            netToPool: ticket.netToPool || 0,
            cardFilter: ticket.cardFilter || '',
            isBot: !!isBot,
            status: 'active',
            hasDeposited: !!live.hasDeposited,
            totalDeposited: live.totalDeposited,
            bonusBetAmount: live.bonusBetAmount,
            realBetAmount: live.realBetAmount
        });
    });
    if (fresh.length) {
        committedRoundEntriesCache = (committedRoundEntriesCache || []).concat(fresh);
    }
    return tickets;
}

let botPersistQueue = [];
let botPersistTimer = null;
let botTouchIds = [];

function queueBotPersist(phone, name, tickets) {
    botPersistQueue.push({ phone: String(phone), name: name || '', tickets: tickets });
    if (botPersistTimer) return;
    botPersistTimer = setTimeout(() => {
        botPersistTimer = null;
        flushBotPersist().catch(() => {});
    }, 60);
}

function queueBotTouch(botId) {
    if (botId) botTouchIds.push(botId);
}

async function flushBotPersist() {
    if (botPersistTimer) {
        clearTimeout(botPersistTimer);
        botPersistTimer = null;
    }
    const batch = botPersistQueue.splice(0, botPersistQueue.length);
    const touches = botTouchIds.splice(0, botTouchIds.length);
    if (batch.length) {
        const docs = [];
        for (let i = 0; i < batch.length; i++) {
            const item = batch[i];
            const tickets = item.tickets || [];
            for (let t = 0; t < tickets.length; t++) {
                const ticket = tickets[t];
                docs.push({
                    gameId,
                    roundId: gameId,
                    phone: item.phone,
                    name: item.name,
                    ticketId: Number(ticket.id),
                    grid: ticket.grid,
                    paidFromPlay: ticket.paidFromPlay || 0,
                    paidFromMain: ticket.paidFromMain || 0,
                    paidFromBonus: ticket.paidFromBonus || 0,
                    mainWalletBlocked: !!ticket.mainWalletBlocked,
                    platformFee: ticket.platformFee || 0,
                    netToPool: ticket.netToPool || 0,
                    cardFilter: ticket.cardFilter || '',
                    isBot: true,
                    status: 'active',
                    committedAt: new Date()
                });
            }
        }
        if (docs.length) {
            try {
                await RoundEntry.insertMany(docs, { ordered: false });
            } catch (err) {
                if (err && (err.code === 11000 || (err.writeErrors && err.writeErrors.length))) {
                    try {
                        await clearCancelledRoundEntries(docs.map((d) => d.ticketId));
                        await RoundEntry.insertMany(docs, { ordered: false });
                    } catch (err2) {}
                }
            }
        }
    }
    if (touches.length && BotUser && BotUser.bulkWrite) {
        const now = new Date();
        const ops = [];
        const seen = new Set();
        for (let i = 0; i < touches.length; i++) {
            const id = String(touches[i]);
            if (seen.has(id)) continue;
            seen.add(id);
            ops.push({ updateOne: { filter: { _id: touches[i] }, update: { $set: { lastPlayed: now } } } });
        }
        if (ops.length) BotUser.bulkWrite(ops, { ordered: false }).catch(() => {});
    }
}

function rememberAssignedCards(phone, name, ticketsData, isBot) {
    const tickets = cacheCommittedTickets(phone, name, ticketsData, isBot);
    if (!tickets.length) return;
    if (isBot) {
        queueBotPersist(phone, name, tickets);
        return;
    }
    persistRoundEntries(phone, name, tickets, false).catch(() => {});
}

function roundCacheEntries(round) {
    const want = Number(round);
    return (committedRoundEntriesCache || []).filter((entry) => {
        if (!entry || entry.status === 'cancelled') return false;
        return Number(entry.gameId || entry.roundId || want) === want;
    });
}

function settlementSeatFromEntry(phone, tickets, phoneEntries) {
    const sample = (phoneEntries && phoneEntries[0]) || {};
    const seat = {
        phone: phone,
        name: sample.name || phone,
        isBot: !!sample.isBot,
        ticketsData: tickets,
        tickets: tickets.length,
        hasDeposited: !!sample.hasDeposited,
        bonusBetAmount: Number(sample.bonusBetAmount) || 0,
        realBetAmount: Number(sample.realBetAmount) || 0
    };
    if (sample.totalDeposited != null && sample.totalDeposited !== '') {
        seat.totalDeposited = Number(sample.totalDeposited) || 0;
    }
    return seat;
}

function captureSettlementRoster(round) {
    const snap = gameEngine.snapshotPlayers(activePlayers);
    gameEngine.hydratePlayersFromEntries(snap, roundCacheEntries(round), settlementSeatFromEntry);
    Object.keys(snap).forEach((phone) => {
        const player = snap[phone];
        (player && player.ticketsData || []).forEach((ticket) => {
            const frozen = roundCards.getGrid(round, ticket && ticket.id);
            if (frozen) ticket.grid = frozen;
        });
    });
    return snap;
}

function rosterForHistory(roster) {
    return Object.values(roster || {}).map((player) => {
        const ticketsData = (player && player.ticketsData || []).map((ticket) => Object.assign({}, ticket));
        return Object.assign({}, player, {
            ticketsData: ticketsData,
            tickets: ticketsData.length || (player && player.tickets) || 0
        });
    });
}

function rememberTakenId(id, owner) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return;
    cardBoard.markTaken(n, owner);
    if (takenIdSet.has(n)) return;
    takenIdSet.add(n);
    globalTakenTickets.push(n);
}

function releaseReserved(phone, ids) {
    const nums = gameEngine.normalizeIds(ids);
    if (!nums.length) return;
    roundCards.release(gameId, nums, phone);
    forgetTakenIds(nums);
}

function cardUnavailable(id, phone) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1 || n > gameEngine.TOTAL_CARDS) return true;
    const want = String(phone || '');
    if (roundCards.isHeldByOther(gameId, n, want)) return true;
    if (roundCards.isSelected(gameId, n) && roundCards.ownerOf(gameId, n) !== want) return true;
    if (cardBoard.ownerOf(n)) return true;
    return takenIdSet.has(n) || cardBoard.isTaken(n);
}

function countFreeCardIds() {
    return cardBoard.freeCount();
}

const scheduledBotPhones = new Set();
function busyBotPhones() {
    const busy = new Set(Object.keys(activePlayers));
    for (let i = 0; i < gameBotsQueue.length; i++) {
        const phone = gameBotsQueue[i] && gameBotsQueue[i].bot && gameBotsQueue[i].bot.phone;
        if (phone) busy.add(String(phone));
    }
    scheduledBotPhones.forEach((phone) => busy.add(phone));
    return busy;
}

async function loadBotJoinBatch(amount, dist) {
    const want = Math.max(0, parseInt(amount, 10) || 0);
    if (!want) return [];
    const busy = busyBotPhones();
    const page = Math.max(want + busy.size + 25, 50);
    const cap = Math.max(want * 8, page);
    const gathered = [];
    let skip = 0;
    while (gathered.length < cap) {
        const batch = await BotUser.find({ isActive: true, name: { $not: /[0-9]$/ } })
            .select('name phone lastPlayed')
            .sort({ lastPlayed: 1, _id: 1 })
            .skip(skip)
            .limit(page);
        if (!batch.length) break;
        for (let i = 0; i < batch.length; i++) gathered.push(batch[i]);
        skip += batch.length;
        if (batch.length < page) break;
        if (gathered.length >= want + busy.size) break;
    }
    return gameEngine.buildBotJoinQueue(gathered, want, dist, countFreeCardIds(), busy);
}

function enqueueJoinedBots(amount, dist, generation) {
    botFillInFlight = true;
    const run = botJoinChain.then(async () => {
        try {
            if (generation !== botFillGeneration || gameState !== "WAITING") return 0;
            const queued = await loadBotJoinBatch(amount, dist);
            if (generation !== botFillGeneration || gameState !== "WAITING") return 0;
            for (let i = 0; i < queued.length; i++) gameBotsQueue.push(queued[i]);
            if (queued.length > 1) gameBotsQueue = gameBotsQueue.sort(() => Math.random() - 0.5);
            armHumanBotPurchases();
            return queued.length;
        } finally {
            if (generation === botFillGeneration) botFillInFlight = false;
        }
    });
    botJoinChain = run.then(() => {}, () => {});
    return run;
}

function refitBotQueue() {
    const fitted = gameEngine.fitBotTicketCounts(gameBotsQueue.map((item) => item.tixCount), countFreeCardIds());
    for (let i = 0; i < fitted.length; i++) gameBotsQueue[i].tixCount = fitted[i];
    return fitted.length;
}

function seatQueuedBots(maxToSeat) {
    const ready = refitBotQueue();
    const n = Math.max(0, Math.min(ready, maxToSeat, gameBotsQueue.length));
    let didInject = false;
    for (let i = 0; i < n; i++) {
        if (gameBotsQueue.length === 0) break;
        let queueItem = gameBotsQueue.shift();
        let botDb = queueItem.bot;
        if (!botDb || !botDb.phone) continue;
        let buyNow = queueItem.tixCount;
        let reservedIds = [];
        for (let t = 0; t < buyNow; t++) {
            let fakeId = getUnusedFakeTicketId(botDb.phone);
            if (fakeId == null) break;
            reservedIds.push(fakeId);
        }
        if (!reservedIds.length) {
            gameBotsQueue.unshift(queueItem);
            break;
        }
        buyNow = reservedIds.length;
        const purchase = gameEngine.bookCardPurchase(buyNow, GLOBAL_SETTINGS.ticketPrice);
        totalPrizePool += purchase.totalNet;
        totalTickets += buyNow;

        let ticketsData = reservedIds.map((fakeId) => ({
            id: fakeId,
            grid: generateFixedCard(fakeId),
            paidFromPlay: purchase.ticketPrice,
            paidFromMain: 0,
            platformFee: purchase.feePerTicket,
            netToPool: purchase.netPerTicket
        }));
        activePlayers[botDb.phone] = { name: botDb.name, phone: botDb.phone, tickets: buyNow, ticketsData: ticketsData, isBot: true, hasDeposited: false };
        rememberAssignedCards(botDb.phone, botDb.name, ticketsData, true);
        botDb.lastPlayed = Date.now();
        if (botDb._id) queueBotTouch(botDb._id);
        didInject = true;
    }
    if(didInject) broadcastTakenTickets();
    return didInject;
}

let botCardPlan = [];
let botPlanGeneration = 0;
let botPlanTimers = [];

function botPurchaseWindowMs() {
    const secondsLeft = Math.max(0, Math.floor(Number(gameClock) || 0));
    if (secondsLeft <= 0) return 0;
    if (secondsLeft === 1) return 700;
    return (secondsLeft - 1) * 1000;
}

function clearBotPurchasePlan() {
    botPlanGeneration++;
    for (let i = 0; i < botPlanTimers.length; i++) clearTimeout(botPlanTimers[i]);
    botPlanTimers = [];
    botCardPlan = [];
    scheduledBotPhones.clear();
}

// One card per call so a bot's 2–4 cards show up as separate clicks.
function seatOneBotCard(item) {
    if (!item || gameState !== 'WAITING') return false;
    const botDb = item.bot;
    if (!botDb || !botDb.phone) return false;
    const already = activePlayers[botDb.phone];
    const have = already && Array.isArray(already.ticketsData) ? already.ticketsData.length : 0;
    const want = Math.max(1, Math.min(4, Math.floor(Number(item.tixCount) || 1)));
    if (have >= want) return false;
    const fakeId = getUnusedFakeTicketId(botDb.phone);
    if (fakeId == null) return false;
    const purchase = gameEngine.bookCardPurchase(1, GLOBAL_SETTINGS.ticketPrice);
    totalPrizePool += purchase.totalNet;
    totalTickets += 1;
    const ticket = {
        id: fakeId,
        grid: generateFixedCard(fakeId),
        paidFromPlay: purchase.ticketPrice,
        paidFromMain: 0,
        platformFee: purchase.feePerTicket,
        netToPool: purchase.netPerTicket
    };
    if (!activePlayers[botDb.phone]) {
        activePlayers[botDb.phone] = {
            name: botDb.name,
            phone: botDb.phone,
            tickets: 0,
            ticketsData: [],
            isBot: true,
            hasDeposited: false
        };
    }
    const player = activePlayers[botDb.phone];
    player.tickets += 1;
    player.ticketsData.push(ticket);
    scheduledBotPhones.delete(String(botDb.phone));
    rememberAssignedCards(botDb.phone, botDb.name, [ticket], true);
    if (player.tickets === 1) {
        botDb.lastPlayed = Date.now();
        if (botDb._id) queueBotTouch(botDb._id);
    }
    broadcastTakenTickets();
    return true;
}

function armHumanBotPurchases() {
    if (gameState !== 'WAITING' || !gameBotsQueue.length) return 0;
    refitBotQueue();
    const queued = gameBotsQueue.splice(0, gameBotsQueue.length);
    const delays = gameEngine.planHumanBotCardDelays(queued.map((item) => item.tixCount), {
        windowMs: botPurchaseWindowMs(),
        rng: Math.random
    });
    const gen = botPlanGeneration;
    for (let i = 0; i < queued.length; i++) {
        const phone = queued[i] && queued[i].bot && queued[i].bot.phone;
        if (phone) scheduledBotPhones.add(String(phone));
    }
    for (let i = 0; i < delays.length; i++) {
        const step = delays[i];
        const rec = { item: queued[step.botIndex], fired: false, gen: gen };
        botCardPlan.push(rec);
        const timer = setTimeout(() => {
            if (rec.fired || rec.gen !== botPlanGeneration || gameState !== 'WAITING') return;
            rec.fired = true;
            seatOneBotCard(rec.item);
        }, step.delayMs);
        botPlanTimers.push(timer);
    }
    return delays.length;
}

function flushUnfiredBotCards() {
    const pending = [];
    for (let i = 0; i < botCardPlan.length; i++) {
        const rec = botCardPlan[i];
        if (rec && !rec.fired && rec.gen === botPlanGeneration) pending.push(rec);
    }
    clearBotPurchasePlan();
    for (let i = 0; i < pending.length; i++) {
        pending[i].fired = true;
        seatOneBotCard(pending[i].item);
    }
    if (gameBotsQueue.length) seatQueuedBots(gameBotsQueue.length);
    flushBotPersist().catch(() => {});
}

// Reserves against the round's selected-card Set. Never returns an id already held.
function getUnusedFakeTicketId(holder) {
    const want = holder || ('card:' + Date.now());
    let guard = gameEngine.TOTAL_CARDS;
    while (guard-- > 0) {
        const id = cardBoard.takeRandomFree();
        if (id == null) return null;
        const claim = roundCards.tryReserve(gameId, id, want);
        if (!claim.ok) {
            rememberTakenId(id, roundCards.ownerOf(gameId, id) || want);
            continue;
        }
        rememberTakenId(id, want);
        return id;
    }
    return null;
}

function claimSyntheticBot(availableBots, seenWinCards, winners) {
    let stealthBot;
    let stealthTix;
    if (availableBots.length > 0) {
        stealthBot = availableBots.pop();
        stealthTix = stealthBot && stealthBot.ticketsData && stealthBot.ticketsData[0];
    } else {
        const fakePhone = '09' + Math.floor(10000000 + Math.random() * 90000000);
        const tixId = getUnusedFakeTicketId(fakePhone);
        if (tixId == null) return false;
        stealthBot = { name: 'User', phone: fakePhone, isBot: true, ticketsData: [{ id: tixId, grid: generateFixedCard(tixId) }] };
        stealthTix = stealthBot.ticketsData[0];
    }
    if (!stealthBot || !stealthTix) return false;
    const cardId = Number(stealthTix.id);
    if (seenWinCards.has(cardId)) return false;
    seenWinCards.add(cardId);
    applyFrozenGrid(stealthTix);
    gameEngine.closeWinningTicket(stealthTix, calledNumbers);
    if (stealthBot.phone && !activePlayers[stealthBot.phone]) activePlayers[stealthBot.phone] = stealthBot;
    winners.push({ player: stealthBot, ticket: stealthTix, syntheticClose: true });
    return true;
}

function closeBotWinnerKartelas(winners) {
    const list = Array.isArray(winners) ? winners.slice() : [];
    for (let i = 0; i < list.length; i++) {
        const w = list[i];
        if (!w || !w.player || !w.player.isBot || !w.ticket) continue;
        try {
            applyFrozenGrid(w.ticket);
            const dealt = assignedCardGrid(w.ticket);
            if (!Array.isArray(dealt)) continue;
            const copy = () => dealt.map((col) => (Array.isArray(col) ? col.slice() : col));
            w.ticket.grid = copy();
            const tickets = w.player.ticketsData || [];
            for (let t = 0; t < tickets.length; t++) {
                const seated = tickets[t];
                if (!seated || Number(seated.id) !== Number(w.ticket.id)) continue;
                seated.grid = copy();
            }
        } catch (e) {}
    }
}

function applyFrozenGrid(ticket) {
    if (!ticket) return null;
    const frozen = roundCards.getGrid(gameId, ticket.id);
    if (frozen) ticket.grid = frozen;
    return ticket.grid;
}

async function persistClosedWinner(winner) {
    try {
        if (!winner || !winner.ticket || winner.ticket.id == null) return;
        const ticket = winner.ticket;
        const player = winner.player || {};
        const seated = gameEngine.cloneGrid(ticket.grid);
        applyFrozenGrid(ticket);
        const played = gameEngine.playedGridForHistory({ grid: seated }, assignedCardGrid(ticket));
        if (played) ticket.grid = played;
        const update = {
            phone: String(player.phone || ''),
            name: player.name || '',
            isBot: !!player.isBot,
            status: ticket.isClosed ? 'won' : (ticket.status || 'active'),
            isClosed: !!ticket.isClosed,
            marks: ticket.marks || ticket.marksObj || null,
            roundId: gameId
        };
        if (played) update.grid = played;
        await RoundEntry.updateOne(
            { gameId, ticketId: Number(ticket.id) },
            { $set: update },
            { upsert: true }
        );
    } catch (e) {}
}

async function lockBotPaymentCardsAfterPayout(list) {
    try {
        closeBotWinnerKartelas(list);
        const bots = (list || []).filter((w) => w && w.player && w.player.isBot && w.ticket);
        for (let i = 0; i < bots.length; i++) {
            try {
                const winner = bots[i];
                applyFrozenGrid(winner.ticket);
                if (!winner.ticket.isClosed) gameEngine.closeWinningTicket(winner.ticket, calledNumbers);
                await persistClosedWinner(winner);
            } catch (err) {
                console.error('bot card lock failed after payout', err && err.message);
            }
        }
    } catch (err) {
        console.error('bot card lock failed after payout', err && err.message);
    }
}

async function declareWinners(winners, winCtx) {
    winCtx = winCtx || {};
    const lockedGameId = gameId;
    const lockedCalled = calledNumbers.slice();
    let lockedRoster = null;
    winners = gameEngine.dedupeWinnersByCard(winners);
    const submittedWinners = winners.slice();
    if (winCtx.eligCtx) {
        winners = gameEngine.dropDeniedBonusWinners(winners, winCtx.eligCtx);
    }
    // A human who already closed a real bingo is the winner. Filters above
    // cannot take that card back.
    winners = gameEngine.restoreLockedHumanWinners(winners, submittedWinners);
    if (!winners.length) return;
    // Lock before any await. The draw tick does not wait on this function.
    gameState = "FINISHED";
    gameClock = GLOBAL_SETTINGS.winPopupTimer || 12;
    (winners || []).forEach((w) => {
        if (w && w.ticket) applyFrozenGrid(w.ticket);
    });
    (winners || []).forEach((w) => {
        if (!w || !w.ticket || (w.player && w.player.isBot)) return;
        if (!w.authenticClose && !w.syntheticClose) return;
        gameEngine.closeWinningTicket(w.ticket, calledNumbers);
    });
    const flagged = (winners || []).filter((w) => w && w.player && !w.player.isBot && (w.authenticClose || w.syntheticClose));
    for (let i = 0; i < flagged.length; i++) {
        await persistClosedWinner(flagged[i]);
    }
    if (!winners.length) return;

    const gridOfLocked = (ticket) => {
        const frozen = roundCards.getGrid(lockedGameId, ticket && ticket.id);
        if (frozen) return frozen;
        return gameEngine.cloneGrid(ticket && ticket.grid);
    };
    async function foldMissedRealWinners() {
        lockedRoster = captureSettlementRoster(lockedGameId);
        const rosterEntries = roundCacheEntries(lockedGameId);
        const next = gameEngine.absorbMissedRealWinners(
            winners,
            lockedRoster,
            rosterEntries,
            lockedCalled,
            gridOfLocked,
            winCtx.eligCtx
        );
        const seen = new Set((winners || []).map((winner) => {
            return String(winner && winner.player && winner.player.phone) + ':' + String(winner && winner.ticket && winner.ticket.id);
        }));
        const added = [];
        for (let i = 0; i < next.length; i++) {
            const winner = next[i];
            const key = String(winner && winner.player && winner.player.phone) + ':' + String(winner && winner.ticket && winner.ticket.id);
            if (seen.has(key)) continue;
            seen.add(key);
            if (winner && winner.ticket) {
                gameEngine.closeWinningTicket(winner.ticket, lockedCalled);
                winner.authenticClose = true;
            }
            added.push(winner);
        }
        winners = next;
        for (let i = 0; i < added.length; i++) {
            await persistClosedWinner(added[i]);
        }
        return added.length;
    }
    await foldMissedRealWinners();
    lockedRoster = captureSettlementRoster(lockedGameId);
    winners = gameEngine.absorbMissedRealWinners(
        winners,
        lockedRoster,
        roundCacheEntries(lockedGameId),
        lockedCalled,
        gridOfLocked,
        winCtx.eligCtx
    );
    if (!winners.length) return;
    winners.forEach((winner) => {
        if (!winner || !winner.ticket || winner.ticket.isClosed) return;
        if (winner.player && winner.player.isBot) return;
        const phone = winner.player && winner.player.phone;
        const live = phone ? activePlayers[String(phone)] : null;
        const liveTicket = live && (live.ticketsData || []).find((ticket) => Number(ticket && ticket.id) === Number(winner.ticket.id));
        if (liveTicket) gameEngine.closeWinningTicket(liveTicket, lockedCalled);
        if (gameEngine.closeWinningTicket(winner.ticket, lockedCalled)) {
            winner.authenticClose = true;
            persistClosedWinner(winner).catch(() => {});
        }
    });
    if (!roundSoloRecorded) {
        roundSoloRecorded = true;
        botWinController.recordCompletedGame(winners);
    }

    let finalTotalPrize = totalPrizePool + jackpotBoostAmount; 
    let splitPrize = Number((finalTotalPrize / winners.length).toFixed(2));
    
    let realMoneyInThisRound = 0;
    Object.values(lockedRoster || activePlayers).forEach(p => {
        if (p.isBot) return;
        const explicit = Number(p.realBetAmount) || 0;
        realMoneyInThisRound += explicit > 0 ? explicit : seatRealStake(p.ticketsData);
    });
    
    let adminProfit = 0; 
    
    let winnerNames = [];
    let winnerPhones = [];
    let ticketIds = [];
    let winnerDetails = []; 
    
    let realMoneyOut = 0;
    let botWinnersPrize = 0;

    for (let w of winners) {
        if (!w.player.isBot) {
            const user = await User.findOne({phone: w.player.phone});
            if(user) { 
                user.mainBalance += splitPrize; 
                user.won += splitPrize;
                await applyRecordedWin(user, splitPrize);
                ensureEatDayCounters(user);
                user.winsToday = (Number(user.winsToday) || 0) + 1;
                user.dailyWins = Number(((Number(user.dailyWins) || 0) + splitPrize).toFixed(2));
                user.roundsTodayWithoutWin = 0;
                await user.save(); 
                io.emit('balance_updated', user.phone); 

                await new Transaction({
                    phone: user.phone,
                    type: 'win',
                    amount: splitPrize,
                    method: `Game #${gameId}`,
                    status: 'Approved',
                    smsText: `Bingo Win - Ticket #${w.ticket.id}`
                }).save();

                if (user.telegramId) {
                    try {
                        let msg = `🎉 <b>እንኳን ደስ አሎት!</b> (Round #${gameId}) ላይ <b>${splitPrize} ETB</b> አሸንፈዋል! ብሩ ዋና ሂሳብዎ (Main Balance) ላይ ገቢ ተደርጓል።`;
                        bot.sendMessage(user.telegramId, msg, { parse_mode: 'HTML' });
                    } catch (e) { }
                }
            }
         realMoneyOut += splitPrize; 
        } else {
            botWinnersPrize += splitPrize;
        }
        winnerNames.push(w.player.name);
        winnerPhones.push(w.player.phone);
        ticketIds.push(w.ticket.id);

        winnerDetails.push({
            name: w.player.name,
            phone: w.player.phone,
            ticket: w.ticket.id,
            prize: splitPrize
        });
    }

    let totalWinners = winners.length;
    let realWinnersCount = winners.filter(w => !w.player.isBot).length;
    let botWinnersCount = winners.filter(w => w.player.isBot).length;
    
    // ማረጋገጫ፡ ያሸነፈው እውነተኛ ሰው ዲፖዚተር መሆኑን ማጣራት
    let isWinnerDepositor = winners.some(w => !w.player.isBot && w.player.hasDeposited);

    if (realMoneyOut > 0) {
        const humanPayout = winners.some((w) => w && w.player && !w.player.isBot);
        const settled = gameEngine.settleWinnerVault({
            virtualPrizePool: GLOBAL_SETTINGS.virtualPrizePool,
            vaultTwoBalance: GLOBAL_SETTINGS.vaultTwoBalance,
            vaultThreeBalance: GLOBAL_SETTINGS.vaultThreeBalance
        }, {
            realMoneyOut,
            isWinnerDepositor,
            realWinnersCount,
            botWinnersCount,
            totalWinners,
            allowNegative: humanPayout || !!winCtx.allowNegativeVault
        });
        GLOBAL_SETTINGS.virtualPrizePool = settled.balances.virtualPrizePool;
        GLOBAL_SETTINGS.vaultTwoBalance = settled.balances.vaultTwoBalance;
        GLOBAL_SETTINGS.vaultThreeBalance = settled.balances.vaultThreeBalance;
        if (settled.charged) {
            const vaultPatch = {};
            vaultPatch[settled.charged] = settled.balances[settled.charged];
            try {
                await SystemSettings.updateOne({}, { $set: vaultPatch });
            } catch (err) {
                console.error('vault update failed after payout', err && err.message);
            }
        }
    }

    // Bot cards lock after the user has already been paid. A failure here
    // must not roll back that credit.
    await lockBotPaymentCardsAfterPayout(winners);

    let uniqueNames = [...new Set(winnerNames)];
    let displayNames = uniqueNames.join(' እና ');

    const historyNow = new Date();
    await GameHistory.create({ 
        gameId, 
        roundId: gameId,
        ticketId: ticketIds.join(', '), 
        winnerName: displayNames, 
        winnerPhone: winnerPhones.join(', '), 
        winnerId: winnerPhones[0] || '',
        winnerPhoneList: winnerPhones.slice(),
        winnerPayout: splitPrize,
        participantPhones: collectParticipantPhones(lockedRoster || activePlayers),
        prize: finalTotalPrize,
        adminProfit, 
        ticketPrice: GLOBAL_SETTINGS.ticketPrice, vaultTransferEnabled: GLOBAL_SETTINGS.vaultTransferEnabled !== false, 
        winningGrid: assignedCardGrid(winners[0].ticket), 
        calledNumbers: lockedCalled.slice(), 
        playersData: rosterForHistory(lockedRoster || activePlayers),
        date: historyNow,
        createdAt: historyNow
    });

    let maskedPhones = winnerPhones.map(p => {
        if(p && p.length >= 10) return p.substring(0, 3) + '****' + p.substring(7);
        return p;
    }).join(', ');

    let safeWinnerDetails = winnerDetails.map(w => ({
        name: w.name,
        phone: w.phone && w.phone.length >= 10 ? w.phone.substring(0, 3) + '****' + w.phone.substring(7) : w.phone,
        ticket: w.ticket,
        prize: w.prize
    }));

    const splitWin = winners.length > 1;
    io.emit('game_winner', { 
        winnerName: displayNames, 
        ticketId: ticketIds.join(', '), 
        prize: splitPrize, 
        totalPrize: finalTotalPrize, 
        phone: maskedPhones, 
        ticketGrid: gameEngine.splitWinnerBroadcastGrid(winners[0], splitWin, assignedCardGrid(winners[0].ticket)), 
        cards: (winners || []).map((w) => {
            const botOnSplit = splitWin && !!(w.player && w.player.isBot);
            return {
                id: w.ticket && w.ticket.id,
                phone: w.player && w.player.phone,
                name: w.player && w.player.name,
                isBot: !!(w.player && w.player.isBot),
                closed: botOnSplit,
                grid: gameEngine.splitWinnerBroadcastGrid(w, splitWin, assignedCardGrid(w.ticket))
            };
        }),
        calledNumbers: [...calledNumbers],
        isShared: splitWin,
        winnerCount: winners.length,
        winnerDetails: safeWinnerDetails
    });
    // ... ከላይ ያሉት የ winners ኖቲፊኬሽን ኮዶች እንዳለ ሆነው ...

   // 🔥 አዲሱ የቅጣት ዙር መቆጣጠሪያ (ከቦት ጋር መካፈልን ያካተተ)
    let realWinnersInThisGame = winners.filter(w => !w.player.isBot);
    let totalWinnersCount = winners.length; // የሰው እና የቦት አጠቃላይ ድምር
    let now = Date.now();
    let currentWinnersPhones = winners.map(w => w.player.phone);
    
    for (let rw of realWinnersInThisGame) {
        let pPhone = rw.player.phone;
        
        // 1. የካርቴላ ቅጣት (Cooldown) - እንደ አሸናፊዎቹ ብዛት
        let newPenalty = 0;
        if (totalWinnersCount === 1) {
            newPenalty = 41; // 👈 1 ሰው ብቻውን (ሰው ብቻ) ከበላ (40 ጌም እንዲታገድ)
        } else if (totalWinnersCount === 2) {
            newPenalty = 29; // 👈 2 ሆነው ከተካፈሉ (ግማሽ ድርሻ) (28 ጌም እንዲታገድ)
        } else if (totalWinnersCount >= 3) {
            newPenalty = 21; // 👈 ከ 3 በላይ ተካፍሎ ከበላ (20 ጌም እንዲታገድ)
        }

        // ማረጋገጫ፡ ቅጣቱን ሳይጨርስ በድጋሚ ካሸነፈ (ለምሳሌ በድንገት)፣ የነበረበት ቅጣት እንዳይሰረዝ
        const appliedGames = Math.max(Number(activeCooldowns[pPhone] || 0), newPenalty);
        if (appliedGames > 0) activeCooldowns[pPhone] = appliedGames;
        const nextKind = cooldownManager.penaltyKindForWinners(totalWinnersCount);
        if (!penaltyMeta[pPhone]) penaltyMeta[pPhone] = { kind: nextKind };
        else penaltyMeta[pPhone].kind = cooldownManager.stricterKind(penaltyMeta[pPhone].kind, nextKind);

        // 2. በ 1 ሰዓት ውስጥ 3 ጊዜ ያሸነፈን ለ 1 ሰዓት ማገድ (Time Ban)
        if (!winHistory[pPhone]) winHistory[pPhone] = [];
        winHistory[pPhone].push(now);
        
        winHistory[pPhone] = winHistory[pPhone].filter(ts => (now - ts) <= 3600000);
        
        if (winHistory[pPhone].length >= 3) {
            timeBans[pPhone] = now + 3600000; // ለ 1 ሰዓት (60 ደቂቃ) ይታገዳል!
            winHistory[pPhone] = []; 
        }
        savePenalty(pPhone).catch(() => {});
    }

    // 3. የተጫወቱ ግን ያላሸነፉ ሰዎችን ተከታታይ ቆጣሪ ዜሮ ማስገባት (Reset losers)
    const settledRoster = lockedRoster || activePlayers;
    for (let phone in settledRoster) {
        if (!settledRoster[phone].isBot && !currentWinnersPhones.includes(phone)) {
            if(winHistory[phone]) winHistory[phone] = []; 
        }
    }
} // <--- ይህ የ declareWinners ፈንክሽን መዝጊያ ቅንፍ ነው

function resetToWaiting() {
    const now = Date.now();
    for (let phone in activeCooldowns) {
        if (activePlayers[phone]) { 
            if (activeCooldowns[phone] > 0) activeCooldowns[phone]--; 
            if (activeCooldowns[phone] <= 0) delete activeCooldowns[phone];
            savePenalty(phone).catch(() => {});
        }
    }

    for (let phone in timeBans) {
        if (now > timeBans[phone]) {
            delete timeBans[phone];
            savePenalty(phone).catch(() => {});
        }
    }

    clearBotPurchasePlan();
    if (takenBroadcastTimer) {
        clearTimeout(takenBroadcastTimer);
        takenBroadcastTimer = null;
    }
    gameState = "WAITING"; 
    gameClock = GLOBAL_SETTINGS.gameTimer; 
    activePlayers = {};
    committedRoundEntriesCache = [];
    committedEntryKeys.clear();
    totalPrizePool = 0; 
    totalCollectedMoney = 0; 
    totalTickets = 0; 
    jackpotBoostAmount = 0; 

    calledNumbers = []; 
    currentDrawSequence = [];
    const closingRoundId = gameId;
    roundCards.clearRound(closingRoundId);
    gameId = 0;
    ensureNextRound('reset').catch((err) => console.error('round id allocation failed', err && err.message)); 
    roundGridSeedLocked = false;
    roundCardGridSeed = Number(GLOBAL_SETTINGS.cardGridSeed) || 0;
    roundGridSeedLocked = true;
    globalTakenTickets = [];
    takenIdSet.clear();
    cardBoard.reset();
    gameBotsQueue = [];
    botFillGeneration++;
    botRosterRequested = false;
    botFillInFlight = false;
    botFillHolds = 0;
    botWinTargetTurn = null;
    mixWinTargetTurn = null; 
    dynamicWinTurn = null;
    roundForceWinner = null;
    roundSoloRecorded = false;
    roundMixBotCount = null;
    roundTargetPhone = null;
    roundLineIndex = null;
    roundResolutionLocked = false;
    roundLockReason = null;
    roundNetSplitFloor = 0;
    roundAllowBonusWin = null;
    io.emit('update_taken_tickets', globalTakenTickets); 
    
    SystemSettings.findOneAndUpdate({}, { jackpotBoostAmount: 0 }).exec();
}

function lockRoundAllowBonusWin() {
    if (roundAllowBonusWin === true || roundAllowBonusWin === false) return roundAllowBonusWin;
    const bonusWinPercent = Number(GLOBAL_SETTINGS.bonusWinPercent);
    roundAllowBonusWin = bonusWinPercent > 0 && (Math.random() * 100) < bonusWinPercent;
    return roundAllowBonusWin;
}

function seatRealStake(tickets) {
    return (tickets || []).reduce((sum, ticket) => {
        const main = Number(ticket && ticket.paidFromMain) || 0;
        const play = Number(ticket && ticket.paidFromPlay) || 0;
        const bonus = Number(ticket && ticket.paidFromBonus) || 0;
        return sum + main + Math.max(0, play - bonus);
    }, 0);
}

function seatedBotShareCount() {
    let mixCount = GLOBAL_SETTINGS.mixBotCount === 0 ? 0 : (GLOBAL_SETTINGS.mixBotCount || 1);
    if (roundNetSplitFloor > mixCount) mixCount = roundNetSplitFloor;
    return mixCount;
}

let lastTickTime = Date.now();
setInterval(() => {
    // ⏱ የሰከንድ መቆራረጥ ቼክ ማድረጊያ (Render ላይ ያሳያል)
    let currentTick = Date.now();
    let tickDiff = currentTick - lastTickTime;
    if (tickDiff > 1500) { // ከ 1.5 ሰከንድ በላይ ከዘገየ
        console.log(`⚠️ [WARNING] የጌሙ ሰከንድ ተቆራርጧል (Event Loop Lag): ${tickDiff}ms ፈጅቷል!`);
    }
    lastTickTime = currentTick;

    if(GLOBAL_SETTINGS.isGamePaused) { 
        io.emit('game_status', { 
            state: "MAINTENANCE", timer: 0, totalPrizePool: 0, jackpotBoost: jackpotBoostAmount,
            totalTickets: 0, ticketPrice: GLOBAL_SETTINGS.ticketPrice, vaultTransferEnabled: GLOBAL_SETTINGS.vaultTransferEnabled !== false, calledNumbers: [], playersCount: Object.keys(activePlayers).length, gameId, 
            maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit, cardGridSeed: roundCardGridSeed 
        }); 
        return; 
    }
    
    if (gameState === "WAITING") {
        gameClock--;
        
        if (GLOBAL_SETTINGS.isBotSystemActive && !botRosterRequested && gameBotsQueue.length === 0 && gameClock > 0) {
            botRosterRequested = true;
            const generation = ++botFillGeneration;
            const ramp = botRampController.nextCount({ settings: GLOBAL_SETTINGS, now: Date.now() });
            enqueueJoinedBots(ramp.count, [
                GLOBAL_SETTINGS.botDist1,
                GLOBAL_SETTINGS.botDist2,
                GLOBAL_SETTINGS.botDist3,
                GLOBAL_SETTINGS.botDist4
            ], generation).catch(() => {});
        }

        if (gameBotsQueue.length > 0 && gameClock > 0 && gameState === "WAITING") {
            armHumanBotPurchases();
        }

        if (gameClock <= 0 && botFillInFlight && gameBotsQueue.length === 0 && botFillHolds < 5) {
            botFillHolds++;
            gameClock = 1;
        }

        io.emit('game_status', { 
            state: gameState, timer: gameClock, totalPrizePool, jackpotBoost: jackpotBoostAmount,
            totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, vaultTransferEnabled: GLOBAL_SETTINGS.vaultTransferEnabled !== false, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, 
            maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit, cardGridSeed: roundCardGridSeed,
            takenCount: globalTakenTickets.length,
            bankInfo: {
                tbName: GLOBAL_SETTINGS.telebirrAccountName,
                tbNum: GLOBAL_SETTINGS.telebirrAccountNumber,
                cbeName: GLOBAL_SETTINGS.cbeAccountName,
                cbeNum: GLOBAL_SETTINGS.cbeAccountNumber
            }
        });
        
        if (gameClock <= 0) {
            if(Object.keys(activePlayers).length > 1) {
                flushUnfiredBotCards();
                botFillHolds = 0; 
                gameState = "PLAYING"; gameClock = 4; 
                currentDrawSequence = getRiggedSequence(); 
                
                // Winning call rotates through 14–23 so back-to-back rounds do not land together.
                dynamicWinTurn = gameEngine.pullFinishCall();
                botWinTargetTurn = dynamicWinTurn;
                mixWinTargetTurn = dynamicWinTurn;
                roundForceWinner = null;
                roundSoloRecorded = false;
                roundMixBotCount = null;
                roundTargetPhone = null;
                roundResolutionLocked = false;
                roundLockReason = null;
                roundNetSplitFloor = 0;
                roundAllowBonusWin = null;
                lockRoundAllowBonusWin();
                warmRoundLineIndex();

                io.emit('game_status', { 
                    state: gameState, timer: gameClock, totalPrizePool, jackpotBoost: jackpotBoostAmount,
                    totalTickets, ticketPrice: GLOBAL_SETTINGS.ticketPrice, vaultTransferEnabled: GLOBAL_SETTINGS.vaultTransferEnabled !== false, calledNumbers, playersCount: Object.keys(activePlayers).length, gameId, 
                    maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit, cardGridSeed: roundCardGridSeed, 
                });
            } else { 
                gameClock = GLOBAL_SETTINGS.gameTimer;
                botFillHolds = 0;
            }
        }
    } else if (gameState === "PLAYING") {
        gameClock--;
        if (gameClock <= 0) {
            gameClock = 4;
            if (roundResolutionLocked) return;
            // A seat that committed after the index was built is still in this round.
            gameEngine.hydratePlayersFromEntries(activePlayers, committedRoundEntriesCache);
            const seatedCards = gameEngine.listParticipatingCards(activePlayers).length;
            if (!roundLineIndex || roundLineIndex.cardCount !== seatedCards) warmRoundLineIndex();
            if (currentDrawSequence.length === 0) { resetToWaiting(); return; } 

            let currentTurn = calledNumbers.length + 1;

            if (!dynamicWinTurn || dynamicWinTurn < gameEngine.FINISH_CALL_MIN || dynamicWinTurn > gameEngine.HARD_CAP_CALLS) {
                dynamicWinTurn = gameEngine.pullFinishCall();
                botWinTargetTurn = dynamicWinTurn;
                mixWinTargetTurn = dynamicWinTurn;
            }

            let realPlayers = Object.values(activePlayers).filter(p => !p.isBot);
            let botPlayers = Object.values(activePlayers).filter(p => p.isBot);

            const depositTodayByPhone = {};
            const totalDepositedByPhone = {};
            const totalWithdrawnByPhone = {};
            const netContributionByPhone = {};
            const dailyRealBetsByPhone = {};
            const dailyWinsByPhone = {};
            const playersByPhone = {};
            realPlayers.forEach((p) => {
                playersByPhone[p.phone] = p;
                const deposited = Number(p.totalDeposited) || 0;
                const withdrawn = Number(p.totalWithdrawn) || 0;
                depositTodayByPhone[p.phone] = Number(p.depositTodayEtb) || 0;
                totalDepositedByPhone[p.phone] = deposited;
                totalWithdrawnByPhone[p.phone] = withdrawn;
                const netContribution = deposited - withdrawn;
                netContributionByPhone[p.phone] = netContribution;
                p.netContribution = netContribution;
                const seatedLoss = gameEngine.rolloverDailyLoss(p, Date.now());
                p.dailyRealBets = seatedLoss.dailyRealBets;
                p.dailyWins = seatedLoss.dailyWins;
                p.eatDayKey = seatedLoss.eatDayKey;
                dailyRealBetsByPhone[p.phone] = seatedLoss.dailyRealBets;
                dailyWinsByPhone[p.phone] = seatedLoss.dailyWins;
            });
            const allowBonusWin = lockRoundAllowBonusWin();
            const eligCtx = {
                allowBonusWin,
                activeCooldowns,
                timeBans,
                now: Date.now(),
                depositTodayEtb: depositTodayByPhone,
                totalDeposited: totalDepositedByPhone,
                totalWithdrawn: totalWithdrawnByPhone,
                netContribution: netContributionByPhone,
                dailyRealBets: dailyRealBetsByPhone,
                dailyWins: dailyWinsByPhone
            };
            realPlayers.forEach((p) => gameEngine.attachEligibility(p, eligCtx));
            const eligSets = gameEngine.buildEligibilitySets(realPlayers, eligCtx);
            let blockedPhones = eligSets.blockedPhones;
            let depositorPhones = eligSets.depositorPhones;
            let eligibleBonusPhones = eligSets.eligibleBonusPhones;
            let eligibleRealPhones = eligSets.eligibleRealPhones;

            let winForBlocked = [];
            let winForEligibleReal = [];
            let winForDepositor = [];
            let winForBots = [];

            if (!roundLineIndex) warmRoundLineIndex();
            if (roundLineIndex) roundLineIndex.syncCalled(calledNumbers);
            const indexedDraw = !!roundLineIndex;
            const roundEntriesForTick = (committedRoundEntriesCache || []).filter((e) => {
                if (!e || e.status === 'cancelled') return false;
                return Number(e.gameId || e.roundId || gameId) === Number(gameId);
            });
            const sameBallGrid = (ticket) => assignedCardGrid(ticket);
            // A correct human close already on the called list stops the next ball.
            // Bonus and cooldown filters do not un-lock that card.
            const priorWinners = gameEngine.collectSameBallWinners(activePlayers, roundEntriesForTick, calledNumbers, sameBallGrid);
            const priorAllowed = gameEngine.dropDeniedBonusWinners(priorWinners, eligCtx);
            const alreadyWon = priorAllowed.length > 0 || priorWinners.some((w) => gameEngine.isLockedHumanWinner(w));

            if (indexedDraw && !alreadyWon) {
                const classified = roundLineIndex.classifyPools(currentDrawSequence, {
                    blockedPhones: blockedPhones,
                    eligibleRealPhones: eligibleRealPhones,
                    depositorPhones: depositorPhones
                });
                winForBots = classified.winForBots;
                winForBlocked = classified.winForBlocked;
                winForEligibleReal = classified.winForEligibleReal;
                winForDepositor = classified.winForDepositor;
            } else if (!alreadyWon) {
                for(let testNum of currentDrawSequence) {
                     let tempCalled = [...calledNumbers, testNum];
                     for(let p of Object.values(activePlayers)) {
                         let hasBingo = false;
                         for(let t of p.ticketsData) {
                             if(serverCheckBingo(t.grid, tempCalled)) { hasBingo = true; break; }
                         }

                         if (hasBingo) {
                             if (p.isBot && !winForBots.includes(testNum)) winForBots.push(testNum);
                             if (blockedPhones.includes(p.phone) && !winForBlocked.includes(testNum)) winForBlocked.push(testNum);
                             if (eligibleRealPhones.includes(p.phone) && !winForEligibleReal.includes(testNum)) winForEligibleReal.push(testNum);
                             if (depositorPhones.includes(p.phone) && !winForDepositor.includes(testNum)) winForDepositor.push(testNum);
                         }
                     }
                }
            }

            const restrictedHits = alreadyWon
                ? { blocked: [], fourCorner: [] }
                : gameEngine.collectRestrictedCompletingNumbers(
                    activePlayers,
                    calledNumbers,
                    currentDrawSequence,
                    eligCtx,
                    indexedDraw ? roundLineIndex : null
                );
            restrictedHits.blocked.forEach((n) => {
                if (!winForBlocked.includes(n)) winForBlocked.push(n);
            });

            // Blocked four-corners stay out of the pool. A full 5-line stays
            // callable. The round crowns only when an allowed card finishes.
            let safePool = currentDrawSequence.filter(n => !restrictedHits.fourCorner.includes(n));

            let numToCall = null;
            let ballAlreadyCalled = false;
            let roundWinPlan = null;
            // Every seated and committed card, not only the first index hit.
            // Only an allowed bingo stops the next ball.
            let confirmedComplete = alreadyWon;
            if (confirmedComplete) {
                ballAlreadyCalled = true;
                numToCall = calledNumbers.length ? calledNumbers[calledNumbers.length - 1] : null;
                roundLockReason = gameEngine.USER_5_MATCH_LOCK;
            }

            const roundAlreadyPlanned = !!roundForceWinner;
            const quotaPlan = gameEngine.planRoundWinner({
                lockedForce: roundForceWinner,
                configuredForce: GLOBAL_SETTINGS.botWinnerForce,
                mixBotCount: roundAlreadyPlanned ? roundMixBotCount : GLOBAL_SETTINGS.mixBotCount,
                virtualPrizePool: GLOBAL_SETTINGS.virtualPrizePool || 0,
                vaultTwoBalance: GLOBAL_SETTINGS.vaultTwoBalance || 0,
                vaultThreeBalance: GLOBAL_SETTINGS.vaultThreeBalance || 0,
                finalTotalPrize: totalPrizePool + jackpotBoostAmount,
                decoyChance: (GLOBAL_SETTINGS.decoyChancePercent !== undefined ? GLOBAL_SETTINGS.decoyChancePercent : 15) / 100,
                depositorCount: depositorPhones.length,
                eligibleBonusCount: eligibleBonusPhones.length,
                eligibleRealCount: eligibleRealPhones.length,
                botCount: botPlayers.length,
                humanLocked: !!confirmedComplete,
                soloBotWinPercent: GLOBAL_SETTINGS.soloBotWinPercent,
                rng: Math.random
            }, botWinController);
            let forceWinner = quotaPlan.forceWinner;
            if (!roundAlreadyPlanned) {
                roundForceWinner = forceWinner;
                roundMixBotCount = quotaPlan.mixBotCount;
                GLOBAL_SETTINGS.mixBotCount = quotaPlan.mixBotCount;
            } else if (roundMixBotCount != null && (forceWinner === 'mix' || forceWinner === 'mix_dep')) {
                GLOBAL_SETTINGS.mixBotCount = roundMixBotCount;
            }

            if (!ballAlreadyCalled) {
                let mixCount = seatedBotShareCount();
                const targetPhones = ((forceWinner === 'mix_dep')
                    ? depositorPhones
                    : (forceWinner === 'bots'
                        ? (depositorPhones.length ? depositorPhones : eligibleRealPhones)
                        : eligibleRealPhones)
                ).filter((phone) => gameEngine.canTargetForWin(activePlayers[phone], eligCtx));
                if (!roundTargetPhone || !activePlayers[roundTargetPhone] || activePlayers[roundTargetPhone].isBot || !gameEngine.canTargetForWin(activePlayers[roundTargetPhone], eligCtx)) {
                    const steered = gameEngine.pickPriorityWinnerPhone(targetPhones, playersByPhone, eligCtx);
                    let fallback = null;
                    for (let i = 0; i < targetPhones.length; i++) {
                        const candidate = activePlayers[targetPhones[i]];
                        if (gameEngine.canTargetForWin(candidate, eligCtx)) {
                            fallback = targetPhones[i];
                            break;
                        }
                    }
                    roundTargetPhone = steered || fallback || null;
                }
                const targetPlayer = roundTargetPhone ? activePlayers[roundTargetPhone] : null;
                if (targetPlayer && gameEngine.minimumBotShare(targetPlayer, eligCtx) > 0) {
                    roundNetSplitFloor = 1;
                    mixCount = seatedBotShareCount();
                    if (botPlayers.length > 0 && (forceWinner === 'real' || forceWinner === 'mix_dep')) {
                        forceWinner = 'mix_dep';
                    }
                }
                const otherReals = realPlayers.filter((p) => !targetPlayer || p.phone !== targetPlayer.phone);
                const drawPool = safePool.length ? safePool : currentDrawSequence;
                const bonusRelease = new Set(gameEngine.allowedBonusReleaseNumbers(
                    activePlayers,
                    calledNumbers,
                    currentDrawSequence,
                    eligCtx,
                    indexedDraw ? roundLineIndex : null,
                    winForBots.concat(winForBlocked)
                ).map((n) => Number(n)));
                const completingAvoid = winForBots.concat(winForEligibleReal, winForBlocked, winForDepositor).filter((n) => !bonusRelease.has(Number(n)));
                const userCompletingAvoid = winForEligibleReal.concat(winForDepositor).filter((n) => !bonusRelease.has(Number(n)));
                let choice = gameEngine.chooseDrawnBall({
                    currentTurn,
                    finishCall: dynamicWinTurn,
                    forceWinner,
                    botCount: mixCount,
                    called: calledNumbers,
                    pool: drawPool,
                    targetPlayers: targetPlayer ? [targetPlayer] : [],
                    botPlayers,
                    others: otherReals,
                    fullPrize: totalPrizePool + jackpotBoostAmount,
                    depositor: forceWinner === 'mix_dep' || !!(targetPlayer && targetPlayer.hasDeposited),
                    vaultTwo: GLOBAL_SETTINGS.vaultTwoBalance,
                    virtualPool: GLOBAL_SETTINGS.virtualPrizePool,
                    gridOf: (ticket) => assignedCardGrid(ticket),
                    fourCorner: restrictedHits.fourCorner,
                    blockedCompleting: winForBlocked.filter((n) => !bonusRelease.has(Number(n))),
                    completing: completingAvoid,
                    botCompleting: winForBots,
                    userCompleting: userCompletingAvoid,
                    lineIndex: roundLineIndex,
                    useEarlyMap: currentTurn <= gameEngine.SCATTER_CALL_END && !!roundLineIndex,
                    soloBotChance: quotaPlan.soloBotChance
                });
                if (choice && choice.useMixedPicker) {
                    const mixed = gameEngine.chooseMixedCall(choice.mixedCtx);
                    if (mixed && mixed.num != null && mixed.plan !== 'build') {
                        choice = Object.assign({}, choice, {
                            num: mixed.num,
                            plan: mixed.plan
                        });
                    }
                }
                if (choice && choice.num != null) numToCall = choice.num;
                if (choice && choice.plan) roundWinPlan = choice.plan;
            }
            
            // የደህንነት ማጣሪያ — a ball that completes a 5-line is never swapped out.
            const completesFiveLine = winForBots.includes(numToCall) || winForEligibleReal.includes(numToCall) || winForBlocked.includes(numToCall) || winForDepositor.includes(numToCall);
            if (!ballAlreadyCalled && !completesFiveLine && (numToCall === null || restrictedHits.fourCorner.includes(numToCall))) {
                numToCall = safePool.length > 0 ? safePool[0] : currentDrawSequence.filter(n => !restrictedHits.fourCorner.includes(n))[0] || currentDrawSequence[0];
            }

            if (!ballAlreadyCalled) {
                currentDrawSequence = currentDrawSequence.filter(n => n !== numToCall);
                calledNumbers.push(numToCall);
                if (roundLineIndex) roundLineIndex.noteCalled(numToCall);
                io.emit('new_number', numToCall);
            }

            // Rescan after the new ball so every card that closed on THIS
            // number is kept. The line index is not the winner list: a second
            // player or a bot who bingos on the same ball stays in the split.
            const sameBallWinners = confirmedComplete
                ? priorWinners
                : gameEngine.collectSameBallWinners(activePlayers, roundEntriesForTick, calledNumbers, sameBallGrid);
            let winnersThisRound = gameEngine.restoreLockedHumanWinners(
                gameEngine.dropDeniedBonusWinners(sameBallWinners, eligCtx),
                sameBallWinners
            );
            const seenWinCards = new Set();
            for (let i = 0; i < winnersThisRound.length; i++) {
                const cardId = Number(winnersThisRound[i].ticket && winnersThisRound[i].ticket.id);
                if (Number.isInteger(cardId)) seenWinCards.add(cardId);
            }

            if (winnersThisRound.length > 0) {
                const lockedAtClose = winnersThisRound.filter((w) => gameEngine.isLockedHumanWinner(w));
                let hasBlockedWinner = false;
                let isEarlyWin = (calledNumbers.length < 14); // 👈 ድንገት ከ 14 ጥሪ በፊት የዘጋ ሰው ካለ ቼክ ያደርጋል
                
                for (let w of winnersThisRound) {
                    if (!w.player.isBot && gameEngine.isRestrictedFromWinning(w.player, eligCtx)) {
                        hasBlockedWinner = true;
                    }
                }

                const plannedAuthentic = roundWinPlan === 'shared' || roundWinPlan === 'solo';
                const plannedSynthetic = roundWinPlan === 'synthetic';
                const plannedClose = (plannedAuthentic || plannedSynthetic) && !isEarlyWin;
                const humanWinners = winnersThisRound.filter((w) => w.player && !w.player.isBot);
                const unexpectedHuman = humanWinners.length > 0 && (isEarlyWin || !plannedClose || hasBlockedWinner);
                let allowNegativeVault = false;

                function noteMixDepWinners(list) {
                    if (forceWinner !== 'mix_dep') return;
                    (list || []).forEach((w) => {
                        if (!w.player || w.player.isBot) return;
                        if (!mixDepWinnersHistory.includes(w.player.phone)) mixDepWinnersHistory.push(w.player.phone);
                    });
                }

                if (!humanWinners.length) {
                    winnersThisRound = gameEngine.capWinnerList(winnersThisRound, 5);
                } else if (unexpectedHuman) {
                    const soleHuman = humanWinners.length === 1 && winnersThisRound.length === 1;
                    const panicBots = botPlayers.slice().sort(() => Math.random() - 0.5);
                    const shield = gameEngine.applyPanicShield(winnersThisRound, {
                        calledCount: calledNumbers.length,
                        plannedClose: plannedClose,
                        blocked: hasBlockedWinner,
                        fullPrize: totalPrizePool + jackpotBoostAmount,
                        depositor: soleHuman && !!(humanWinners[0].player.hasDeposited || depositorPhones.includes(humanWinners[0].player.phone)),
                        vaultTwo: GLOBAL_SETTINGS.vaultTwoBalance,
                        virtualPool: GLOBAL_SETTINGS.virtualPrizePool,
                        injectBot: (list) => claimSyntheticBot(panicBots, seenWinCards, list)
                    });
                    winnersThisRound = shield.winners;
                    allowNegativeVault = !!shield.allowNegative;
                } else {
                    let originalWinners = winnersThisRound.slice();
                    winnersThisRound = gameEngine.restoreLockedHumanWinners(
                        gameEngine.excludeRestrictedWinners(winnersThisRound, eligCtx),
                        originalWinners
                    );
                    if (winnersThisRound.length === 0) {
                        winnersThisRound = originalWinners;
                        const panicBots = botPlayers.slice().sort(() => Math.random() - 0.5);
                        const shield = gameEngine.applyPanicShield(winnersThisRound, {
                            calledCount: calledNumbers.length,
                            plannedClose: false,
                            blocked: true,
                            fullPrize: totalPrizePool + jackpotBoostAmount,
                            depositor: false,
                            vaultTwo: GLOBAL_SETTINGS.vaultTwoBalance,
                            virtualPool: GLOBAL_SETTINGS.virtualPrizePool,
                            injectBot: (list) => claimSyntheticBot(panicBots, seenWinCards, list)
                        });
                        winnersThisRound = shield.winners;
                        allowNegativeVault = !!shield.allowNegative;
                    } else if (plannedSynthetic) {
                        noteMixDepWinners(winnersThisRound);
                        let mixCount = GLOBAL_SETTINGS.mixBotCount === 0 ? 0 : (GLOBAL_SETTINGS.mixBotCount || 1);
                        let haveBots = winnersThisRound.filter((w) => w.player && w.player.isBot).length;
                        let need = Math.max(0, mixCount - haveBots);
                        if (winnersThisRound.length + need > 5) need = Math.max(0, 5 - winnersThisRound.length);
                        let availableBots = botPlayers.sort(() => Math.random() - 0.5);
                        for (let i = 0; i < need; i++) {
                            if (!claimSyntheticBot(availableBots, seenWinCards, winnersThisRound)) break;
                        }
                    } else if (plannedAuthentic) {
                        noteMixDepWinners(winnersThisRound);
                    } else {
                        let actualReals = winnersThisRound.filter(w => !w.player.isBot);
                        if ((forceWinner === 'mix' || forceWinner === 'mix_dep') && actualReals.length > 0) {
                            noteMixDepWinners(actualReals);
                            let mixCount = GLOBAL_SETTINGS.mixBotCount === 0 ? 0 : (GLOBAL_SETTINGS.mixBotCount || 1);
                            let availableBots = botPlayers.sort(() => Math.random() - 0.5);
                            let toAdd = Math.min(mixCount, availableBots.length, Math.max(0, 5 - winnersThisRound.length));
                            for (let i = 0; i < toAdd; i++) {
                                if (!claimSyntheticBot(availableBots, seenWinCards, winnersThisRound)) break;
                            }
                        }
                    }
                    winnersThisRound = gameEngine.capWinnerList(winnersThisRound, 5);
                }

                const soloHumans = winnersThisRound.filter((w) => w && w.player && !w.player.isBot);
                const soloBots = winnersThisRound.filter((w) => w && w.player && w.player.isBot);
                if (soloHumans.length === 1 && soloBots.length === 0 && winnersThisRound.length < 5 && gameEngine.minimumBotShare(soloHumans[0].player, eligCtx) > 0) {
                    const shareBots = botPlayers.slice().sort(() => Math.random() - 0.5);
                    claimSyntheticBot(shareBots, seenWinCards, winnersThisRound);
                }

                winnersThisRound = gameEngine.restoreLockedHumanWinners(winnersThisRound, lockedAtClose);
                if (lockedAtClose.length) allowNegativeVault = true;
                roundResolutionLocked = true;
                roundLockReason = gameEngine.USER_5_MATCH_LOCK;
                declareWinners(winnersThisRound, { allowNegativeVault, eligCtx });
                return; // 🔥 ጌሙ ድርግም ብሎ እዚሁ ይዘጋል!
            }
        }
    } else if (gameState === "FINISHED") {
        gameClock--; if (gameClock <= 0) resetToWaiting();
    }
}, 1000);

let buyingLocks = {}; 
io.on('connection', (socket) => {
    let stateToSend = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
    socket.emit('game_status', { 
            state: stateToSend, 
            timer: gameClock, 
            totalPrizePool, 
            jackpotBoost: jackpotBoostAmount,
            totalTickets, 
            ticketPrice: GLOBAL_SETTINGS.ticketPrice, vaultTransferEnabled: GLOBAL_SETTINGS.vaultTransferEnabled !== false, 
            calledNumbers: calledNumbers, // ሪፍሬሽ ሲደረግ የተጠሩ ቁጥሮች እንዲመጡ
            takenTickets: globalTakenTickets, // ሪፍሬሽ ሲደረግ የተያዙ ካርቴላዎች እንዲመጡ
            playersCount: Object.keys(activePlayers).length, 
            gameId, 
            cardBoardOrder: GLOBAL_SETTINGS.cardBoardOrder || [],
            cardGridSeed: roundCardGridSeed,
            maxTickets: GLOBAL_SETTINGS.maxTicketsPerUser, 
            depBannerTextAm: GLOBAL_SETTINGS.depBannerTextAm, 
            depBannerTextEn: GLOBAL_SETTINGS.depBannerTextEn, 
            witBannerTextAm: GLOBAL_SETTINGS.witBannerTextAm, 
            witBannerTextEn: GLOBAL_SETTINGS.witBannerTextEn, 
            minWithdrawLimit: GLOBAL_SETTINGS.minWithdrawLimit,
            bankInfo: {
                tbName: GLOBAL_SETTINGS.telebirrAccountName,
                tbNum: GLOBAL_SETTINGS.telebirrAccountNumber,
                cbeName: GLOBAL_SETTINGS.cbeAccountName,
                cbeNum: GLOBAL_SETTINGS.cbeAccountNumber
            }
        });
    
    socket.on('get_initial_data', (phone) => { 
        // 🔥 የቅርብ ጊዜውን የጌም ሁኔታ ከግሎባል ቫሪያብል በቀጥታ ይወስዳል
        let currentState = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
        let p = activePlayers[String(phone)]; 
        
        const liveRound = gameState === 'WAITING' || gameState === 'PLAYING';
        socket.emit('sync_data', { 
            gameState: currentState, 
            globalTakenTickets: liveRound ? [...globalTakenTickets] : [],
            calledNumbers: liveRound ? [...calledNumbers] : [],
            myTickets: liveRound ? gameEngine.ticketsForActiveRound(p ? p.ticketsData : [], gameId) : [],
            gameId: gameId,
            currentRoundId: gameId,
            timer: gameClock,
            cardBoardOrder: GLOBAL_SETTINGS.cardBoardOrder || [],
            cardGridSeed: roundCardGridSeed
        });  
    });
    
    socket.on('buy_tickets', async (data) => {
        if(GLOBAL_SETTINGS.isGamePaused || gameState !== "WAITING") return;
        if (!Number.isInteger(gameId) || gameId <= 0) {
            socket.emit('bet_error', '❌ ዙሩ እየተዘጋጀ ነው። እባክዎ ትንሽ ይጠብቁ።');
            return;
        } 
        
        if (!data || typeof data !== 'object') return;
        let phone = String(data.phone || "");
        let ticketCount = parseInt(data.ticketCount);

        if (isNaN(ticketCount) || ticketCount <= 0 || ticketCount > GLOBAL_SETTINGS.maxTicketsPerUser) return;
        if (!Array.isArray(data.ticketsData) || data.ticketsData.length !== ticketCount) return;

        let incomingIds = gameEngine.normalizeIds(data.ticketIds || data.ticketsData.map(t => t.id));
        if (!incomingIds.length || incomingIds.length !== ticketCount) return;
        if (incomingIds.some((id) => id < 1 || id > gameEngine.TOTAL_CARDS)) {
            socket.emit('bet_error', '❌ የመረጡት ካርቴላ አልተገኘም!');
            return;
        }
        const requestRound = data.gameId != null ? data.gameId : (data.roundId != null ? data.roundId : data.currentRoundId);
        
        if (String(requestRound) !== String(gameId) || gameEngine.rejectEvalForRound(requestRound, gameId)) {
            socket.emit('sync_data', {
                gameState: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState,
                globalTakenTickets: [...globalTakenTickets],
                calledNumbers: [...calledNumbers],
                myTickets: [],
                gameId,
                currentRoundId: gameId
            });
            socket.emit('bet_error', "❌ ዙሩ ተቀይሯል! እባክዎ አዲስ ካርቴላ ይምረጡ።");
            return;
        }

        if (buyingLocks[phone]) return; 
        buyingLocks[phone] = true;

        try {
            // Reserve every card against this round's selected-card Set before any await.
            let isDuplicate = incomingIds.some((id) => cardUnavailable(id, phone));

            if (isDuplicate) {
                socket.emit('bet_error', `❌ የመረጡት ካርቴላ ቀድሞ ተይዟል! እባክዎ ሌላ ይምረጡ።`);
                return;
            }

            const reservedNow = [];
            for (let i = 0; i < incomingIds.length; i++) {
                const claim = roundCards.tryReserve(gameId, incomingIds[i], phone);
                if (!claim.ok) {
                    releaseReserved(phone, reservedNow);
                    io.emit('update_taken_tickets', globalTakenTickets);
                    socket.emit('bet_error', `❌ የመረጡት ካርቴላ ቀድሞ ተይዟል! እባክዎ ሌላ ይምረጡ።`);
                    return;
                }
                reservedNow.push(incomingIds[i]);
                rememberTakenId(incomingIds[i], phone);
            }
            
            io.emit('update_taken_tickets', globalTakenTickets); 

            let currentTickets = activePlayers[phone] ? activePlayers[phone].tickets : 0;
            if (currentTickets + ticketCount > GLOBAL_SETTINGS.maxTicketsPerUser) {
                releaseReserved(phone, reservedNow);
                io.emit('update_taken_tickets', globalTakenTickets);
                socket.emit('bet_error', `❌ ይቅርታ! በአጠቃላይ ከ ${GLOBAL_SETTINGS.maxTicketsPerUser} ካርቴላ በላይ መግዛት አይቻልም!`);
                return;
            }

            const purchase = gameEngine.bookCardPurchase(ticketCount, GLOBAL_SETTINGS.ticketPrice);
            const betAmount = purchase.gross;
            if (betAmount <= 0) {
                releaseReserved(phone, incomingIds);
                io.emit('update_taken_tickets', globalTakenTickets);
                return;
            } 

            // አሁን በምቾት ብር ቼክ ለማድረግ ወደ ዳታቤዝ (Database) እንሄዳለን (ካርቴላውን አስቀድመን በእጃችን ስላስገባን ማንም ሊነጥቀን አይችልም)
            const user = await User.findOne({ phone: phone }).select('playBalance mainBalance unplayedRealDeposit played totalTicketsBought periodTickets ticketCycleReady seasonCardsPlayed seasonId eatDayKey depositTodayEtb dailyRealBets dailyWins roundsTodayWithoutWin winsToday totalDeposited totalWithdrawn won');
            const stake = gameEngine.cardStakeFromWallets(
                user && user.playBalance,
                user && user.mainBalance,
                betAmount,
                GLOBAL_SETTINGS.vaultTransferEnabled
            );
            
            if(user && stake.ok) {
                let playDeducted = stake.playDeducted;
                let mainDeducted = stake.mainDeducted;
                user.playBalance -= playDeducted;
                user.mainBalance -= mainDeducted;

                const stakeSplit = gameEngine.splitPlayStake(playDeducted, user.unplayedRealDeposit);
                user.unplayedRealDeposit = stakeSplit.nextUnplayed;

                let realBetAmount = Number((mainDeducted + stakeSplit.realFromPlay).toFixed(2));
                let bonusBetAmount = stakeSplit.bonusFromPlay;
                const realStakeToday = realBetAmount;

                if (mainDeducted > 0 && stake.allowMain) {
                    let v3Cut = mainDeducted * ((GLOBAL_SETTINGS.vaultThreePercent !== undefined ? GLOBAL_SETTINGS.vaultThreePercent : 10) / 100);
                    let v1Cut = mainDeducted - v3Cut;

                    GLOBAL_SETTINGS.virtualPrizePool += v1Cut;
                    GLOBAL_SETTINGS.vaultThreeBalance += v3Cut;

                    await SystemSettings.updateOne({}, { 
                        $inc: { virtualPrizePool: v1Cut, vaultThreeBalance: v3Cut } 
                    });
                } else if (mainDeducted > 0) {
                    GLOBAL_SETTINGS.vaultBlockedAmount = Number(((Number(GLOBAL_SETTINGS.vaultBlockedAmount) || 0) + mainDeducted).toFixed(2));
                    await SystemSettings.updateOne({}, {
                        $inc: { vaultBlockedAmount: mainDeducted }
                    });
                }
                
                user.played += 1; 
                user.totalTicketsBought = (user.totalTicketsBought || 0) + ticketCount;
                applyPeriodTickets(user, ticketCount);
                await bumpSeasonCards(user, ticketCount);
                ensureEatDayCounters(user);
                user.dailyRealBets = Number(((Number(user.dailyRealBets) || 0) + realStakeToday).toFixed(2));
                user.roundsTodayWithoutWin = (Number(user.roundsTodayWithoutWin) || 0) + 1;
                await User.updateOne({ phone: phone }, {
                    $set: {
                        playBalance: user.playBalance,
                        mainBalance: user.mainBalance,
                        unplayedRealDeposit: user.unplayedRealDeposit,
                        played: user.played,
                        totalTicketsBought: user.totalTicketsBought,
                        periodTickets: user.periodTickets,
                        ticketCycleReady: !!user.ticketCycleReady,
                        seasonCardsPlayed: user.seasonCardsPlayed || 0,
                        seasonId: user.seasonId || '',
                        eatDayKey: user.eatDayKey || '',
                        depositTodayEtb: user.depositTodayEtb || 0,
                        dailyRealBets: user.dailyRealBets || 0,
                        dailyWins: user.dailyWins || 0,
                        roundsTodayWithoutWin: user.roundsTodayWithoutWin || 0,
                        winsToday: user.winsToday || 0
                    }
                });

                let playPerTicket = playDeducted / ticketCount;
                let mainPerTicket = mainDeducted / ticketCount;
                let bonusPerTicket = bonusBetAmount / ticketCount;
                
                gameEngine.stampTicketsForRound(data.ticketsData, gameId);
                data.ticketsData.forEach(t => {
                    t.paidFromPlay = playPerTicket;
                    t.paidFromMain = mainPerTicket;
                    t.paidFromBonus = bonusPerTicket;
                    t.mainWalletBlocked = !stake.allowMain && mainPerTicket > 0;
                    t.platformFee = purchase.feePerTicket;
                    t.netToPool = purchase.netPerTicket;
                    // 🔥 ይህንን አዲስ ኮድ እዚህ ያክሉ (ቁጥሮቹን String ከሆኑ ወደ Number ይቀይራቸዋል)
                    t.grid = generateFixedCard(t.id);
                });
                if (!activePlayers[phone]) {
                    activePlayers[phone] = {
                        name: data.name,
                        phone: phone,
                        tickets: ticketCount,
                        ticketsData: data.ticketsData,
                        isBot: false,
                        hasDeposited: (user.totalDeposited > 0),
                        realBetAmount: realBetAmount,
                        bonusBetAmount: bonusBetAmount,
                        won: user.won || 0,
                        depositTodayEtb: user.depositTodayEtb || 0,
                        totalDeposited: user.totalDeposited || 0,
                        totalWithdrawn: user.totalWithdrawn || 0,
                        netContribution: (Number(user.totalDeposited) || 0) - (Number(user.totalWithdrawn) || 0),
                        roundsTodayWithoutWin: user.roundsTodayWithoutWin || 0,
                        winsToday: user.winsToday || 0,
                        dailyRealBets: user.dailyRealBets || 0,
                        dailyWins: user.dailyWins || 0,
                        eatDayKey: user.eatDayKey || ''
                    };
                } else { 
                    activePlayers[phone].tickets += ticketCount; 
                    activePlayers[phone].ticketsData.push(...data.ticketsData); 
                    activePlayers[phone].hasDeposited = (user.totalDeposited > 0);
                    activePlayers[phone].realBetAmount = (activePlayers[phone].realBetAmount || 0) + realBetAmount;
                    activePlayers[phone].bonusBetAmount = (activePlayers[phone].bonusBetAmount || 0) + bonusBetAmount;
                    activePlayers[phone].won = user.won || 0;
                    activePlayers[phone].depositTodayEtb = user.depositTodayEtb || 0;
                    activePlayers[phone].totalDeposited = user.totalDeposited || 0;
                    activePlayers[phone].totalWithdrawn = user.totalWithdrawn || 0;
                    activePlayers[phone].netContribution = (Number(user.totalDeposited) || 0) - (Number(user.totalWithdrawn) || 0);
                    activePlayers[phone].roundsTodayWithoutWin = user.roundsTodayWithoutWin || 0;
                    activePlayers[phone].winsToday = user.winsToday || 0;
                    activePlayers[phone].dailyRealBets = user.dailyRealBets || 0;
                    activePlayers[phone].dailyWins = user.dailyWins || 0;
                    activePlayers[phone].eatDayKey = user.eatDayKey || '';
                }
                
                totalTickets += ticketCount; 
                totalCollectedMoney += betAmount;

                totalPrizePool += purchase.totalNet;

                const seatedTickets = cacheCommittedTickets(phone, data.name, data.ticketsData, false);
                let dupRetried = false;
                try {
                    await persistRoundEntries(phone, data.name, seatedTickets, false);
                } catch (err) {
                    if (err && err.code === 11000 && !dupRetried) {
                        dupRetried = true;
                        try {
                            await clearCancelledRoundEntries(incomingIds);
                            await persistRoundEntries(phone, data.name, seatedTickets, false);
                        } catch (err2) {
                            if (err2 && err2.code === 11000) {
                                const recovered = await recoverOwnCommittedTickets(socket, phone, incomingIds, data.name);
                                const seatedNow = activePlayers[phone];
                                const held = seatedNow && (seatedNow.ticketsData || []).some((ticket) => incomingIds.indexOf(Number(ticket && ticket.id)) !== -1);
                                if (!recovered && !held) {
                                    rejectTickets(socket, incomingIds, `❌ የመረጡት ካርቴላ ቀድሞ ተይዟል! እባክዎ ሌላ ይምረጡ።`);
                                }
                            }
                        }
                    }
                }
                if (gameState === 'PLAYING') warmRoundLineIndex();
                confirmTicketsLocked(socket, phone, incomingIds);
                io.emit('update_taken_tickets', getPublicTakenTickets());
                let currentState = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
                socket.emit('sync_data', { 
                    gameState: currentState, 
                    globalTakenTickets: globalTakenTickets, 
                    calledNumbers: calledNumbers, 
                    myTickets: gameEngine.ticketsForActiveRound(activePlayers[phone].ticketsData, gameId),
                    gameId,
                    currentRoundId: gameId
                });

                socket.emit('balance_updated', phone);
            } else {
                // ብር ከሌለው ወይም አካውንቱ ችግር ካለበት ያሲዝነውን ካርቴላ ለሌላ ሰው አየር ላይ እንለቅለታለን (Rollback)
                releaseReserved(phone, incomingIds);
                io.emit('update_taken_tickets', globalTakenTickets);
                socket.emit('bet_error', `❌ በቂ ሂሳብ የለዎትም!`);
            }
        } finally {
            delete buyingLocks[phone];
        }
    });

    socket.on('cancel_ticket', async (data) => {
        if(GLOBAL_SETTINGS.isGamePaused || gameState !== "WAITING") return; 
        
        if (!data || typeof data !== 'object') return;
        let phone = String(data.phone || "");
        let ticketId = Number(data.ticketId);
        if (!phone || !Number.isInteger(ticketId) || ticketId <= 0) return;
        const requestRound = data.gameId != null ? data.gameId : (data.roundId != null ? data.roundId : data.currentRoundId);
        if (requestRound != null && requestRound !== '' && gameEngine.rejectEvalForRound(requestRound, gameId)) {
            rejectTickets(socket, [ticketId], 'STALE_ROUND');
            return;
        }

        const denyRelease = () => {
            if (!socket) return;
            socket.emit('ticket_cancel_denied', ticketId);
            const seated = activePlayers[phone];
            socket.emit('sync_data', {
                gameState: GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState,
                globalTakenTickets: getPublicTakenTickets(),
                calledNumbers: calledNumbers,
                myTickets: gameEngine.ticketsForActiveRound(seated ? seated.ticketsData : [], gameId),
                pendingTicketIds: ticketLocks.pendingIdsForPhone(phone),
                gameId,
                currentRoundId: gameId
            });
        };

        if (buyingLocks[phone]) return; 
        buyingLocks[phone] = true;

        try {
            const user = await User.findOne({phone: phone});
            if(user) {
                let p = activePlayers[phone];
                let canceledTicketIndex = p ? p.ticketsData.findIndex(t => String(t.id) === String(ticketId)) : -1;
                
                if(p && canceledTicketIndex !== -1) {
                    
                    let canceledTicket = p.ticketsData[canceledTicketIndex];
                    const refund = gameEngine.refundCancelledCard(canceledTicket);
                    let refundPlay = refund.refundPlay;
                    let refundMain = refund.refundMain;

                    let realStakeRefund = refundMain;
                    if (canceledTicket.paidFromBonus != null) {
                        const bonusOnCard = Number(canceledTicket.paidFromBonus) || 0;
                        const playOnCard = Number(canceledTicket.paidFromPlay) || 0;
                        const realPlayOnCard = Math.max(0, Number((playOnCard - bonusOnCard).toFixed(2)));
                        user.unplayedRealDeposit = Number(((Number(user.unplayedRealDeposit) || 0) + realPlayOnCard).toFixed(2));
                        realStakeRefund = Number((realPlayOnCard + refundMain).toFixed(2));
                    }
                    ensureEatDayCounters(user);
                    user.dailyRealBets = Math.max(0, Number(((Number(user.dailyRealBets) || 0) - realStakeRefund).toFixed(2)));
                    p.dailyRealBets = user.dailyRealBets || 0;
                    p.dailyWins = user.dailyWins || 0;
                    p.eatDayKey = user.eatDayKey || '';

                    p.ticketsData.splice(canceledTicketIndex, 1);
                    p.tickets -= 1;
                    p.realBetAmount = Number(seatRealStake(p.ticketsData).toFixed(2));
                    p.bonusBetAmount = (p.ticketsData || []).reduce((sum, ticket) => sum + (Number(ticket && ticket.paidFromBonus) || 0), 0);

                    user.playBalance += refundPlay;
                    user.mainBalance += refundMain;
                    user.played = Math.max(0, user.played - 1);
                    user.totalTicketsBought = Math.max(0, (user.totalTicketsBought || 0) - 1);
                    applyPeriodTickets(user, -1);
                    await bumpSeasonCards(user, -1);
                    await user.save();
               
                    if (refundMain > 0 && canceledTicket.mainWalletBlocked) {
                        GLOBAL_SETTINGS.vaultBlockedAmount = Math.max(0, Number(((Number(GLOBAL_SETTINGS.vaultBlockedAmount) || 0) - refundMain).toFixed(2)));
                        await SystemSettings.updateOne({}, {
                            $set: { vaultBlockedAmount: GLOBAL_SETTINGS.vaultBlockedAmount }
                        });
                    } else if (refundMain > 0) {
                        let v3Cut = refundMain * ((GLOBAL_SETTINGS.vaultThreePercent || 10) / 100);
                        let v1Cut = refundMain - v3Cut;

                        GLOBAL_SETTINGS.virtualPrizePool = Math.max(0, GLOBAL_SETTINGS.virtualPrizePool - v1Cut);
                        GLOBAL_SETTINGS.vaultThreeBalance = Math.max(0, GLOBAL_SETTINGS.vaultThreeBalance - v3Cut);

                        await SystemSettings.updateOne({}, { 
                            $set: { virtualPrizePool: GLOBAL_SETTINGS.virtualPrizePool, vaultThreeBalance: GLOBAL_SETTINGS.vaultThreeBalance } 
                        });
                    }  
                    
                    let activeTicketsToSync = p.ticketsData;

                    if(p.tickets === 0) {
                        activeTicketsToSync = [];
                        delete activePlayers[phone];
                    }

                    totalTickets -= 1;
                    totalCollectedMoney -= refund.refundTotal;

                    totalPrizePool = Math.max(0, Number((totalPrizePool - refund.poolReversal).toFixed(2))); 

                    roundCards.release(gameId, ticketId, phone);
                    forgetTakenIds([ticketId]);
                    dropCommittedCacheTickets([ticketId]);
                    cancelRoundEntry(phone, ticketId).catch(() => {});

                    // 🔥 አዲስ የተጨመረ: Cancel ካደረጉ በኋላ ዌብሳይቱ (UI) ያንኑ ካርቴላ ይዞ እንዳይቀር FORCE SYNC ያደርጋል
                    let currentState = GLOBAL_SETTINGS.isGamePaused ? "MAINTENANCE" : gameState;
                    socket.emit('sync_data', { 
                        gameState: currentState, 
                        globalTakenTickets: globalTakenTickets, 
                        calledNumbers: calledNumbers, 
                        myTickets: gameEngine.ticketsForActiveRound(activeTicketsToSync, gameId),
                        gameId,
                        currentRoundId: gameId
                    });

                    io.emit('update_taken_tickets', globalTakenTickets); 
                    socket.emit('balance_updated', phone);
                    socket.emit('ticket_cancelled_success', ticketId);
                }
            }
        } finally {
            delete buyingLocks[phone];
        }
    });
});

bot.setWebHook(`${WEB_URL}/bot${telegramToken}`);
app.post(`/bot${telegramToken}`, (req, res) => { bot.processUpdate(req.body); res.sendStatus(200); });
const botState = {};

function releaseBannedBotState(user) {
    const keys = [];
    if (user && user.telegramId) keys.push(String(user.telegramId));
    if (user && user.phone) keys.push(String(user.phone));
    keys.forEach((key) => {
        const state = botState[key];
        if (!state) return;
        delete state.banned;
        if (state.step === 'banned') state.step = 'idle';
    });
}

const t = {
    am: {
        welcome: "🟢 <b>አማር</b> ⚪️ <b>ቢንጎ</b>\n\n🎉 <b>እንኳን ወደ AMAR BINGO በደህና መጡ!</b> 🎉\n\nየኢትዮጵያ #1 እና በጣም ታማኝ የሆነው የቢንጎ መጫወቻ ፕላትፎርም። አሁኑኑ ይጫወቱ፣ ያሸንፉ፣ እና ወዲያውኑ ወደ ሂሳብዎ ገቢ ያድርጉ!\n\n👇 <b>ከታች ካሉት አማራጮች የሚፈልጉትን ይምረጡ፡</b>",
        btn_play: "🎮 ጌም ይጫወቱ (PLAY)", btn_profile: "👤 ፕሮፋይል", btn_balance: "💰 ሂሳብ", btn_deposit: "📥 ገቢ (Deposit)", btn_withdraw: "📤 ወጪ (Withdraw)", btn_invite: "🔗 ጋብዝ & አግኝ", btn_promo: "🗣 ድርጅቱን አስተዋውቅ", btn_guide: "📖 መመሪያ", btn_help: "🆘 እርዳታ", btn_rules: "📜 ደንቦች", btn_lang: "🌐 ቋንቋ (Language)", btn_bonus: "🎁 ቦነስ (Claim Promo)", btn_back: "🔙 ወደ ኋላ ተመለስ", btn_promocode: "🎟️ ፕሮሞ ኮድ",
        share_contact: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", err_reg_first: "እባክዎ መጀመሪያ /start ብለው ይመዝገቡ።", err_cancel: "❌ ትዕዛዙ ተቋርጧል።",
        profile_text: (u) => `👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${u.name}\n🔹 <b>ስልክ:</b> ${u.phone}\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>የሂሳብ ማረጋገጫ:</b>\n\n🟢 መጫወቻ ሂሳብ (Play): <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 ዋና ሂሳብ (Main): <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>የትኛውን የባንክ አማራጭ መጠቀም ይፈልጋሉ?</b>", wit_msg: "🏦 <b>በየትኛው ባንክ ወጪ ማድረግ ይፈልጋሉ?</b>",
        invite_msg: (l) => `🔗 <b>ጋብዝ እና አግኝ</b>\n\nይህንን የራስዎ የሆነ መጋበዣ ሊንክ ለጓደኞችዎ ይላኩ። ጓደኛዎ በእርስዎ ሊንክ ገብቶ ሲመዘገብ <b>እርስዎም ሆነ ጓደኛዎ ልዩ የመጫወቻ ቦነስ ያገኛላችሁ!</b>\n\n👇 የጋብዝ ሊንክዎ:\n${l}`,
        guide_msg: `📖 <b>የጨዋታው መመሪያ:</b>\n\n1️⃣ ካርድ ሲገዙ ከ 1 እስከ 75 ባሉት ቁጥሮች የተሞላ 5x5 ካርቴላ ይሰጥዎታል።\n2️⃣ ጨዋታው ሲጀመር ሲስተሙ በየ 3 ሰከንዱ ቁጥሮችን ይጠራል።\n3️⃣ ሲስተሙ ራሱ ያጠቁርልዎታል (ምንም መንካት አይጠበቅብዎትም)።\n\n🏆 <b>እንዴት ያሸንፋሉ?</b>\nየተጠሩት ቁጥሮች በአግድም፣ ወደ ታች፣ በማዕዘን (X ቅርፅ) ወይም 4ቱን ጥግ ከሰሩ <b>BINGO!</b> ብለው ያሸንፋሉ።`,
        rules_msg: `📜 <b>የጨዋታው ደንቦች:</b>\n\n1️⃣ <b>የሂሳብ ደንቦች:</b>\n🟢 <b>መጫወቻ ሂሳብ:</b> ካርድ ገዝቶ ለመጫወት ብቻ የሚያገለግል ሲሆን በፍፁም ወጪ (Withdraw) ማድረግ አይቻልም።\n🟡 <b>ዋና ሂሳብ:</b> ተጫውተው ሲያሸንፉ የሚገባበት ሲሆን፣ በማንኛውም ሰዓት ወጪ ማድረግ ይችላሉ።\n\n2️⃣ <b>የገቢ ደንብ:</b>\n👉 ከ ቴሌብር ወደ ቴሌብር\n👉 ከ ሲቢኢ ብር ወደ ሲቢኢ ብር ብቻ ያስገቡ።\n\n3️⃣ <b>ማረጋገጫ:</b> ገቢ ሲያደርጉ የደረሰዎትን ትክክለኛ የባንክ (SMS/TxRef) በትክክል ያስገቡ።\n4️⃣ <b>እድሜ:</b> ተጫዋቾች ከ 21 ዓመት በላይ መሆን አለባቸው።`,
        choose_lang: "እባክዎ ቋንቋ ይምረጡ:", lang_set: "✅ ቋንቋ በተሳካ ሁኔታ ተቀይሯል!",
        warn_telebirr: "⚠️ <b>ማሳሰቢያ፡</b> እባክዎ ከ ቴሌብር ወደ ቴሌብር (Telebirr to Telebirr) ብቻ ያስገቡ!\n\n", warn_cbebirr: "⚠️ <b>ማሳሰቢያ፡</b> እባክዎ ከ ሲቢኢ ብር ወደ ሲቢኢ ብር (CBEBirr to CBEBirr) ብቻ ያስገቡ!\n\n",
        bank_info: (method, warning, name, num) => `🏦 ባንክ: <b>${method}</b>\n\n${warning}እባክዎ ብሩን ወደዚህ አካውንት ያስገቡ:\n👤 ስም: <b>${name}</b>\n👉 ቁጥር: <b>${num}</b>\n\nከዚያም <b>ያስገቡትን የብር መጠን</b> ብቻ እዚህ ይፃፉልኝ (ምሳሌ: 100):`,
        wit_info: (method) => `🏦 ባንክ: <b>${method}</b>\n\nገንዘቡ እንዲላክልዎ የሚፈልጉትን <b>ስልክ ቁጥር ወይም አካውንት</b> ያስገቡ፦`,
        invalid_amt: (min) => `❌ ትክክለኛ መጠን ያስገቡ (ቢያንስ ${min} ብር):`, enter_sms: (amt) => `✅ መጠን: <b>${amt} ETB</b>\n\nእባክዎ ክፍያ የፈጸሙበትን የ <b>ትክክለኛውን የባንክ SMS ማረጋገጫ (Tx Ref) ፅሁፍ</b> አሁን እዚህ ይላኩ፦`,
        dep_success: "✅ <b>የገቢ ጥያቄዎ በተሳካ ሁኔታ ተልኳል!</b>\n\nሲረጋገጥ በሰከንዶች ውስጥ ይሞላል።",
        enter_wit_amt: (acc, min) => `✅ አካውንት: <b>${acc}</b>\n\nማውጣት የሚፈልጉትን መጠን ያስገቡ (ቢያንስ ${min} ብር):`, insufficient: "❌ በዋና ሂሳብዎ ላይ በቂ ብር የለም!", wit_success: (amt, acc) => `✅ <b>የወጪ ጥያቄዎ ተልኳል!</b>\n\nመጠን: ${amt} ETB\nወደ: ${acc}\n\nበቅርቡ ይላካል!`,
        play_msg: "በአማር ቢንጎ ቤት ይጫወቱ ይዝናኑ በሺዎች ያሸንፉ\nመልካም እድል ይሁንሎት"
    },
    en: {
        welcome: "🟢 <b>አማር</b> ⚪️ <b>ቢንጎ</b>\n\n🎉 <b>Welcome to AMAR BINGO!</b> 🎉\n\nEthiopia's #1 BINGO platform.\n\n👇 <b>Choose an option:</b>",
        btn_play: "🎮 PLAY BINGO", btn_profile: "👤 Profile", btn_balance: "💰 Balance", btn_deposit: "📥 Deposit", btn_withdraw: "📤 Withdraw", btn_invite: "🔗 Invite & Earn", btn_promo: "🗣 Promote", btn_guide: "📖 Guide", btn_help: "🆘 Help", btn_rules: "📜 Rules", btn_lang: "🌐 Language", btn_bonus: "🎁 Claim Promo Bonus", btn_back: "🔙 Go Back", btn_promocode: "🎟️ Promo Code",
        share_contact: "📱 Share Contact", err_reg_first: "Register first by sending /start.", err_cancel: "❌ Action cancelled.",
        profile_text: (u) => `👤 <b>Your Profile</b>\n\n🔹 <b>Name:</b> ${u.name}\n🔹 <b>Phone:</b> ${u.phone}\n\n💰 <b>Play Balance:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>Main Balance:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>Wallet Balance:</b>\n\n🟢 Play Balance: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 Main Balance: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>Choose a bank to Deposit:</b>", wit_msg: "🏦 <b>Choose a bank to Withdraw:</b>",
        invite_msg: (l) => `🔗 <b>Invite & Earn</b>\n\nWhen a friend joins, <b>both YOU and YOUR FRIEND get special Play Bonus!</b>\n\n👇 Your Link:\n${l}`,
        guide_msg: `📖 <b>How to Play:</b>\n\n1️⃣ Get a 5x5 card.\n2️⃣ System calls a number every 3 sec.\n3️⃣ System auto-daubs.\n\n🏆 Match 5 in a row or 4 corners to win <b>BINGO!</b>`,
        rules_msg: `📜 <b>Rules:</b>\n\n👉 Telebirr to Telebirr ONLY.\n👉 CBEBirr to CBEBirr ONLY.\n👉 Paste exact SMS.\n👉 Must be 21+.`,
        choose_lang: "Please choose your language:", lang_set: "✅ Language changed successfully!",
        warn_telebirr: "⚠️ <b>WARNING:</b> Send Telebirr to Telebirr ONLY!\n\n", warn_cbebirr: "⚠️ <b>WARNING:</b> Send CBEBirr to CBEBirr ONLY!\n\n",
        bank_info: (method, warning, name, num) => `🏦 Bank: <b>${method}</b>\n\n${warning}Send money to:\n👤 Name: <b>${name}</b>\n👉 Account: <b>${num}</b>\n\nType the <b>amount you sent</b> here (e.g., 100):`,
        wit_info: (method) => `🏦 Bank: <b>${method}</b>\n\nEnter the <b>Account or Phone number</b>:`,
        invalid_amt: (min) => `❌ Invalid Amount. Min ${min} ETB:`, enter_sms: (amt) => `✅ Amount: <b>${amt} ETB</b>\n\nPaste exact <b>Bank SMS</b>:`,
        dep_success: "✅ <b>Deposit Request Sent!</b>", enter_wit_amt: (acc, min) => `✅ Account: <b>${acc}</b>\n\nEnter withdrawal amount (Min ${min} ETB):`, insufficient: "❌ Insufficient Main Balance!", wit_success: (amt, acc) => `✅ <b>Withdrawal Request Sent!</b>\nAmount: ${amt} ETB\nTo: ${acc}`,
        play_msg: "Play and have fun at Amar Bingo and win thousands!\nGood luck!"
    },
    or: {
        welcome: "🟢 <b>አማር</b> ⚪️ <b>ቢንጎ</b>\n\n🎉 <b>Baga nagaan dhuftan!</b> 🎉", btn_play: "🎮 Tapadhu", btn_profile: "👤 Pirofaayilii", btn_balance: "💰 Herrega", btn_deposit: "📥 Galchuu", btn_withdraw: "📤 Baasuu", btn_invite: "🔗 Afeeri", btn_promo: "🗣 Promote", btn_guide: "📖 Qajeelfama", btn_help: "🆘 Gargaarsa", btn_rules: "📜 Seera", btn_lang: "🌐 Afaan", btn_bonus: "🎁 Boonasii", btn_back: "🔙 Duubatti", btn_promocode: "🎟️ Promo Code", share_contact: "📱 Lakkoofsa ergi", err_reg_first: "Dura /start tuqi.", err_cancel: "❌ Haqameera.",
        profile_text: (u) => `👤 <b>Pirofaayilii</b>\n\n🔹 <b>Maqaa:</b> ${u.name}\n🔹 <b>Lakkoofsa:</b> ${u.phone}\n\n💰 <b>Herrega Taphaa:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>Muummee:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>Herrega Kee:</b>\n\n🟢 Tapha: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 Muummee: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>Baankii filadhu:</b>", wit_msg: "🏦 <b>Baankii baasuuf filadhu:</b>", invite_msg: (l) => `🔗 <b>Afeeri</b>\n\nLachuun keessan Boonasii argattu!\n\n👇 Liinkii Kee:\n${l}`, guide_msg: `📖 <b>Akkaataa Tapha:</b> Sarara guutu BINGO!`, rules_msg: `📜 <b>Seera:</b> Telebirr gara Telebirr QOFA. CBEBirr gara CBEBirr QOFA.`, choose_lang: "Afaan filadhu:", lang_set: "✅ Jijjiirameera!", warn_telebirr: "⚠️ Telebirr gara Telebirr QOFA!\n\n", warn_cbebirr: "⚠️ CBEBirr gara CBEBirr QOFA!\n\n",
        bank_info: (method, warning, name, num) => `🏦 Baankii: <b>${method}</b>\n\n${warning}Qarshii ergaa:\n👤 Maqaa: <b>${name}</b>\n👉 Lakkoofsa: <b>${num}</b>\n\n<b>Hamma qarshii</b> asitti barreessaa (Fkn: 100):`,
        wit_info: (method) => `🏦 Baankii: <b>${method}</b>\n\nLakkoofsa barreessaa:`, invalid_amt: (min) => `❌ Yoo xiqqaate ${min} ETB:`, enter_sms: (amt) => `✅ Hamma: <b>${amt} ETB</b>\n\nAmma <b>SMS Baankii</b> asitti ergaa:`, dep_success: "✅ <b>Ergameera!</b>", enter_wit_amt: (acc, min) => `✅ Herrega: <b>${acc}</b>\n\nHamma galchaa (Min ${min}):`, insufficient: "❌ Qarshiን ga'aan hin jiru!", wit_success: (amt, acc) => `✅ <b>Ergameera!</b>`,
        play_msg: "AMAR BINGO irratti taphadhaa, bashannanaa, kumaatama mo'adhaa!\nCarraa Gaarii!"
    },
    ti: {
        welcome: "🟢 <b>አማር</b> ⚪️ <b>ቢንጎ</b>\n\n🎉 <b>እንቋዕ ብደሓን መጻእኩም!</b> 🎉", btn_play: "🎮 ጻወት", btn_profile: "👤 ፕሮፋይል", btn_balance: "💰 ሕሳብ", btn_deposit: "📥 ኣእቱ", btn_withdraw: "📤 ኣውጽእ", btn_invite: "🔗 ዕደም", btn_promo: "🗣 Promote", btn_guide: "📖 መምርሒ", btn_help: "🆘 ሓገዝ", btn_rules: "📜 ሕግታት", btn_lang: "🌐 ቋንቋ", btn_bonus: "🎁 ቦነስ", btn_back: "🔙 ንድሕሪት", btn_promocode: "🎟️ Promo Code", share_contact: "📱 ቁጽሪ ኣካፍል", err_reg_first: "ቅድም /start በሉ።", err_cancel: "❌ ተቋሪጹ።",
        profile_text: (u) => `👤 <b>ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${u.name}\n🔹 <b>ስልኪ:</b> ${u.phone}\n\n💰 <b>መጻወቲ:</b> ${u.playBalance.toFixed(2)} ETB\n💰 <b>ቀንዲ:</b> ${u.mainBalance.toFixed(2)} ETB`,
        balance_text: (u) => `💰 <b>ናይ ሕሳብ ሓበሬታ:</b>\n\n🟢 መጻወቲ: <b>${u.playBalance.toFixed(2)} ETB</b>\n🟡 ቀንዲ: <b>${u.mainBalance.toFixed(2)} ETB</b>`,
        dep_msg: "🏦 <b>ባንኪ ምረጽ?</b>", wit_msg: "🏦 <b>ባንኪ ምረጽ?</b>", invite_msg: (l) => `🔗 <b>ዕደምን ረኸብን</b>\n\nንስኹም ሆነ ንሱ ፍሉይ ቦነስ ክትረኽቡ ኢኹም!\n\n👇 ሊንክ:\n${l}`, guide_msg: `📖 <b>መምርሒ:</b> ምሉእ መስመር እንተሰሪሖም BINGO!`, rules_msg: `📜 <b>ሕግታት:</b> ካብ ቴሌብር ናብ ቴሌብር ጥራይ። ካብ CBEBirr ናብ CBEBirr ጥራይ።`, choose_lang: "ቋንቋ ምረጹ:", lang_set: "✅ ተቐይሩ ኣሎ!", warn_telebirr: "⚠️ ካብ ቴሌብር ናብ ቴሌብር ጥራይ!\n\n", warn_cbebirr: "⚠️ ካብ CBEBirr ናብ CBEBirr ጥራይ!\n\n",
        bank_info: (method, warning, name, num) => `🏦 ባንኪ: <b>${method}</b>\n\n${warning}ገንዘብ ናብዚ ኣእትዉ:\n👤 ስም: <b>${name}</b>\n👉 ቁጽሪ: <b>${num}</b>\n\n<b>መጠን ገንዘብ</b> ኣብዚ ጽሓፉ (ንኣብነት: 100):`,
        wit_info: (method) => `🏦 ባንኪ: <b>${method}</b>\n\n<b>ቁጽሪ ስልኪ ወይ ኣካውንት</b> ኣእትዉ፦`, invalid_amt: (min) => `❌ እንተወሓደ ${min} ብር:`, enter_sms: (amt) => `✅ መጠን: <b>${amt} ETB</b>\n\nሕጂ <b>ትኽክለኛ SMS</b> ስደዱ፦`, dep_success: "✅ <b>ተላኢኹ!</b>", enter_wit_amt: (acc, min) => `✅ ኣካውንት: <b>${acc}</b>\n\nመጠን ኣእትዉ (Min ${min}):`, insufficient: "❌ እኹል ገንዘብ የለን!", wit_success: (amt, acc) => `✅ <b>ተላኢኹ!</b>`,
        play_msg: "ኣብ አማር ቢንጎ ጻወቱ፡ ተዘናግዑ፡ ብኣሽሓት ድማ ዕወቱ!\nሰናይ ዕድል!"
    }
};

function getLang(user) { return user && user.language && t[user.language] ? t[user.language] : t['am']; }
function getMainMenu(user) {
    let ln = getLang(user);
    return { reply_markup: { keyboard: [ 
        [{ text: ln.btn_play }], 
        [{ text: ln.btn_profile }, { text: ln.btn_balance }], 
        [{ text: ln.btn_deposit }, { text: ln.btn_withdraw }], 
        [{ text: ln.btn_invite }, { text: ln.btn_promo }], 
        [{ text: ln.btn_promocode }, { text: ln.btn_lang }], 
        [{ text: ln.btn_guide }, { text: ln.btn_help }, { text: ln.btn_rules }]
    ], resize_keyboard: true } };
}
const cancelKeyboard = (ln) => ({ reply_markup: { keyboard: [[{ text: ln.btn_back }]], resize_keyboard: true } });

bot.onText(/\/start(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id; let user = await User.findOne({ telegramId: msg.from.id.toString() }); let ln = getLang(user);
    if (user) rememberTelegramIdentity(msg.from);
    if(user) { 
        try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: ln.welcome, parse_mode: "HTML", ...getMainMenu(user) }); }
        catch(e) { bot.sendMessage(chatId, ln.welcome, { parse_mode: "HTML", ...getMainMenu(user) }); }
    } else {
        botState[chatId] = { step: 'idle', refCode: match[1] };
        const cap = `🟢 <b>አማር</b> ⚪️ <b>ቢንጎ</b>\n\n👋 <b>እንኳን ወደ AMAR BINGO መጡ!</b>\n\nጌሙን ለመጀመር ከታች ያለውን <b>'📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ'</b> ይጫኑ።`;
        try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", reply_markup: { keyboard: [ [{ text: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", request_contact: true }] ], resize_keyboard: true, one_time_keyboard: true } }); }
        catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", reply_markup: { keyboard: [ [{ text: "📱 ለመመዝገብ ስልክ ቁጥር ያጋሩ", request_contact: true }] ], resize_keyboard: true, one_time_keyboard: true } }); }
    }
});

bot.on('contact', async (msg) => {
    const chatId = msg.chat.id;
    const senderId = contactGuard.senderTelegramId(msg.from);
    if (!contactGuard.isOwnContact(msg)) {
        try {
            const sender = senderId ? await User.findOne({ telegramId: senderId }) : null;
            if (sender) {
                const pending = contactGuard.mismatchAccountPatch();
                sender.contactVerified = pending.contactVerified;
                sender.verificationStatus = pending.verificationStatus;
                await sender.save();
            }
        } catch (e) {}
        bot.sendMessage(chatId, contactGuard.OWN_CONTACT_REQUIRED);
        return;
    }
    let phone = contactGuard.normalizeContactPhone(msg.contact && msg.contact.phone_number);
    let user = await User.findOne({ phone: phone });
    if (contactGuard.phoneLinkedToOther(user, senderId)) {
        bot.sendMessage(chatId, contactGuard.PHONE_ALREADY_LINKED);
        return;
    }
    const share = contactGuard.reviewContactShare(msg, user);
    if (!share.ok) {
        bot.sendMessage(chatId, share.message || contactGuard.OWN_CONTACT_REQUIRED);
        return;
    }
    let state = botState[chatId] || {};
    try {
        if (!user) {
            let actualRef = "";
            let cleanRefCode = state.refCode || "";

            let isPromoLink = false;
            if (cleanRefCode.startsWith('promo_')) { 
                cleanRefCode = cleanRefCode.replace('promo_', ''); 
                isPromoLink = true;
            }

            const invite = await claimInviteLink(cleanRefCode, phone, isPromoLink);
            if (!invite.ok) {
                bot.sendMessage(chatId, invite.message || 'Daily referral invite limit reached for this link');
                return;
            }
            actualRef = invite.actualRef;
            isPromoLink = invite.isPromoLink;
            let myRefCode = generateRefCode();
            try {
                const verified = contactGuard.verifiedAccountPatch();
                const welcomeBonus = share.bonus === 'register' ? GLOBAL_SETTINGS.registerBonus : 0;
                user = await User.create({ phone, name: msg.contact.first_name || "User", firstName: (msg.contact && msg.contact.first_name) || (msg.from && msg.from.first_name) || "", telegramUsername: (msg.from && msg.from.username) ? String(msg.from.username).replace(/^@+/, '') : "", password: Math.random().toString(36).slice(-6), refCode: myRefCode, telegramId: senderId, referredBy: actualRef, referredViaPromo: isPromoLink, playBalance: welcomeBonus, language: 'am', contactVerified: verified.contactVerified, verificationStatus: verified.verificationStatus });
            } catch (saveErr) {
                if (invite.referrerId) await rollbackReferrerReward(invite.referrerId, invite.bonusApplied);
                throw saveErr;
            }
            if (invite.bonusApplied && invite.actualRef) io.emit('balance_updated', invite.actualRef);
            
            const cap = `🟢 <b>አማር</b> ⚪️ <b>ቢንጎ</b>\n\n🎉 እንኳን ደስ አሎት <b>${user.name}</b>! ምዝገባው ተጠናቋል።\n\n👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${user.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
            try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", ...getMainMenu(user) }); }
            catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", ...getMainMenu(user) }); }
        } else {
            user.telegramId = senderId;
            const verifiedLink = contactGuard.verifiedAccountPatch();
            user.contactVerified = verifiedLink.contactVerified;
            user.verificationStatus = verifiedLink.verificationStatus;
            const linkedProfile = telegramProfilePatch(msg.from || {});
            const contactFirst = msg.contact && msg.contact.first_name ? String(msg.contact.first_name).trim() : '';
            if (contactFirst) linkedProfile.firstName = contactFirst;
            if (linkedProfile.telegramUsername) user.telegramUsername = linkedProfile.telegramUsername;
            if (linkedProfile.firstName) user.firstName = linkedProfile.firstName;
            await user.save();
            const cap = `🟢 <b>አማር</b> ⚪️ <b>ቢንጎ</b>\n\n✅ አካውንትዎ ተገናኝቷል!\n\n👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n🔑 <b>የይለፍ ቃል:</b> <code>${user.password}</code>\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
            try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", ...getMainMenu(user) }); }
            catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", ...getMainMenu(user) }); }
        }
        botState[chatId] = { step: 'idle' };
    } catch (e) { bot.sendMessage(chatId, "❌ ይቅርታ፣ ችግር አጋጥሟል።"); }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id; const text = msg.text;
    if(!text || text.startsWith('/start') || msg.contact) return;
    
    let user = await User.findOne({ telegramId: msg.from.id.toString() }); 
    if (user && msg.from) {
        const profile = telegramProfilePatch(msg.from);
        if (profile.telegramUsername) user.telegramUsername = profile.telegramUsername;
        if (profile.firstName) user.firstName = profile.firstName;
        if (user.isModified()) {
            User.updateOne({ _id: user._id }, { $set: profile }).exec();
        }
    }
    let ln = getLang(user); 
    let state = botState[chatId] || { step: 'idle' };

    if (text === t.am.btn_back || text === t.en.btn_back || text === t.or.btn_back || text === t.ti.btn_back || text.includes('ተመለስ') || text.includes('Back') || text.includes('Duubatti') || text.includes('ንድሕሪት') || text === '/back') { 
        botState[chatId] = { step: 'idle' }; 
        return bot.sendMessage(chatId, ln.err_cancel, user ? { parse_mode: "HTML", ...getMainMenu(user) } : { reply_markup: { remove_keyboard: true } }); 
    }

    if (state.step === 'support_chat') {
        if(!user) return;
        await SupportMessage.create({ telegramId: msg.from.id.toString(), phone: user.phone, name: user.name, text: text, sender: 'user' });
        
        io.emit('new_support_message'); 

        bot.sendMessage(chatId, "✅ መልዕክትዎ ደርሶናል! አድሚን ሲያይ በዚሁ ቦት በኩል ይመልስሎታል።", { parse_mode: "HTML", ...getMainMenu(user) });
        state.step = 'idle';
        botState[chatId] = state;
        return;
    }

    if (text === t.am.btn_play || text === t.en.btn_play || text === t.or.btn_play || text === t.ti.btn_play || text.includes('PLAY') || text.includes('ጌም ይጫወቱ') || text.includes('Tapadhu') || text.includes('ጻወት') || text === '/play') {
        bot.sendMessage(chatId, ln.play_msg, { reply_markup: { inline_keyboard: [[{ text: ln.btn_play, web_app: { url: (user) ? `${WEB_URL}/?phone=${user.phone}&pass=${user.password}` : WEB_URL } }]] } });
    }
    else if (text === t.am.btn_promocode || text === t.en.btn_promocode || text === t.or.btn_promocode || text === t.ti.btn_promocode || text.includes('ፕሮሞ ኮድ') || text.includes('Promo Code') || text === '/promocode') {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        bot.sendMessage(chatId, "🎟️ <b>ኩፖን (Promo Code)</b>\n\nከታች ያለውን ቁልፍ ተጭነው ኩፖንዎን ያስገቡ።", { 
            parse_mode: "HTML", 
            reply_markup: { inline_keyboard: [[{ text: "🎟️ ኩፖን አስገባ (Enter Code)", web_app: { url: `${WEB_URL}/promo_app?phone=${user.phone}&pass=${user.password}` } }]] } 
        });
    }
    else if (text === t.am.btn_profile || text === t.en.btn_profile || text === t.or.btn_profile || text === t.ti.btn_profile || text.includes('ፕሮፋይል') || text.includes('Profile') || text.includes('Pirofaayilii') || text === '/profile' || text === '/account') { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        const cap = `👤 <b>የእርስዎ ፕሮፋይል</b>\n\n🔹 <b>ስም:</b> ${user.name}\n🔹 <b>ስልክ:</b> ${user.phone}\n\n💰 <b>መጫወቻ ሂሳብ:</b> ${user.playBalance.toFixed(2)} ETB\n💰 <b>ዋና ሂሳብ:</b> ${user.mainBalance.toFixed(2)} ETB\n\n👇 <b>ጌሙን ለመጀመር ከታች '🎮 ጌም ይጫወቱ (PLAY)' የሚለውን ይጫኑ።</b>`;
        try { await bot.sendPhoto(chatId, WELCOME_PHOTO_URL, { caption: cap, parse_mode: "HTML", ...getMainMenu(user) }); }
        catch(e) { bot.sendMessage(chatId, cap, { parse_mode: "HTML", ...getMainMenu(user) }); }
    }
    else if (text === t.am.btn_balance || text === t.en.btn_balance || text === t.or.btn_balance || text === t.ti.btn_balance || text.includes('ሂሳብ') || text.includes('Balance') || text.includes('Herrega') || text.includes('ሕሳብ')) { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        bot.sendMessage(chatId, ln.balance_text(user), { parse_mode: "HTML", ...getMainMenu(user) }); 
    } 
    else if (text === t.am.btn_deposit || text === t.en.btn_deposit || text === t.or.btn_deposit || text === t.ti.btn_deposit || text.includes('ገቢ') || text.includes('Deposit') || text.includes('Galchuu') || text.includes('ኣእቱ') || text === '/deposit') {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        state.step = 'idle';
        bot.sendMessage(chatId, ln.dep_msg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"📱 TeleBirr", callback_data:"dep_TeleBirr"}, {text:"🏦 CBEBirr", callback_data:"dep_CBEBirr"}]] } });
    } 
    else if (text === t.am.btn_withdraw || text === t.en.btn_withdraw || text === t.or.btn_withdraw || text === t.ti.btn_withdraw || text.includes('ወጪ') || text.includes('Withdraw') || text.includes('Baasuu') || text.includes('ኣውጽእ') || text === '/withdraw') {
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        state.step = 'idle';
        bot.sendMessage(chatId, ln.wit_msg, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"📱 TeleBirr", callback_data:"wit_TeleBirr"}, {text:"🏦 CBEBirr", callback_data:"wit_CBEBirr"}]] } });
    } 
    else if (text === t.am.btn_invite || text === t.en.btn_invite || text === t.or.btn_invite || text === t.ti.btn_invite || text.includes('ጋብዝ') || text.includes('Invite') || text.includes('Afeeri') || text.includes('ዕደም') || text === '/referral') { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        if(!user.refCode) { user.refCode = generateRefCode(); await user.save(); }
        
        let actualInvites = user.totalInvites || 0; 
        let displayEarned = actualInvites * GLOBAL_SETTINGS.inviteBonus;

        if (user.isPromoter) {
            let normalLink = `https://t.me/amar_bingo_bot?start=${user.refCode}`;
            let promoLink = `https://t.me/amar_bingo_bot?start=promo_${user.refCode}`;

            let msg = `📊 <b>የእርስዎ መረጃ (Your Stats):</b>\n👥 <b>ያመጡት ሰው (Invited):</b> ${actualInvites} ሰው\n🎁 <b>በጋባዥነት ያገኙት (Invite Bonus):</b> ${displayEarned} ETB\n💸 <b>የኮሚሽን ገቢ (Commission):</b> ${(user.promoterEarned || 0).toLocaleString()} ETB\n💰 <b>አሁን ያለው ሂሳብዎ:</b> ${user.playBalance.toFixed(2)} ETB\n\n`;
            msg += `🌟 <b>እርስዎ ልዩ አስተዋዋቂ ነዎት! ከታች 2 አይነት ሊንክ አለዎት፡</b>\n\n`;
            msg += `1️⃣ <b>የመጫወቻ ቦነስ ማግኛ ሊንክ (Normal Link):</b>\nይህንን ለሰው ሲልኩ፣ ሰውየው ሲገባ እርስዎ ወዲያውኑ የመጫወቻ ቦነስ ያገኛሉ። (ሰውየው ብር ቢያስገባ ግን ፐርሰንት የለዎትም)\n👇\n${normalLink}\n\n`;
            msg += `2️⃣ <b>የኮሚሽን ማግኛ ሊንክ (Promoter Link):</b>\nይህንን ለሰው ሲልኩ ወዲያውኑ የመጫወቻ ቦነስ አያገኙም፣ ነገር ግን ሰውየው ብር ሲያስገባ እርስዎ የገንዘብ ፐርሰንት (ኮሚሽን) ያገኛሉ።\n👇\n${promoLink}`;

            bot.sendMessage(chatId, msg, { parse_mode: "HTML", disable_web_page_preview: true, ...getMainMenu(user) });
        } else {
            let normalLink = `https://t.me/amar_bingo_bot?start=${user.refCode}`;
            let statsText = `\n\n📊 <b>የእርስዎ መረጃ (Your Stats):</b>\n👥 <b>የጋበዙት ሰው (Invited):</b> ${actualInvites} ሰው\n💰 <b>አሁን ያለው መጫወቻ ሂሳብዎ:</b> ${user.playBalance.toFixed(2)} ETB`;
            bot.sendMessage(chatId, ln.invite_msg(normalLink) + statsText, { parse_mode: "HTML", disable_web_page_preview: true, ...getMainMenu(user) });
        }
    } 
    else if (text === t.am.btn_promo || text === t.en.btn_promo || text === t.or.btn_promo || text === t.ti.btn_promo || text.includes('ድርጅቱን አስተዋውቅ') || text.includes('አስተዋውቅ') || text.includes('Promote') || text.includes('Promoter')) { 
        if(!user) return bot.sendMessage(chatId, ln.err_reg_first); 
        if(user.isPromoter) {
            bot.sendMessage(chatId, "📊 <b>የአስተዋዋቂ ዳሽቦርድ (Promoter Dashboard)</b>\n\nከታች ያለውን ቁልፍ ተጭነው መረጃዎን ይመልከቱ፣ እንዲሁም ያገኙትን ኮሚሽን ወጪ (Withdraw) ያድርጉ።", {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[{ text: "🚀 ዳሽቦርድ ክፈት (Open Dashboard)", web_app: { url: `${WEB_URL}/promoter?phone=${user.phone}&pass=${user.password}` } }]]
                }
            });
        } else {
            bot.sendMessage(chatId, "🗣 <b>ልዩ አስተዋዋቂ (Promoter) ይሁኑ!</b>\n\nልዩ አስተዋዋቂ ለመሆን እና ኮሚሽን በየቀኑ ለመሰብሰብ እባክዎ አድሚን ያናግሩ: <b>@amarbingo</b>", { parse_mode: "HTML", ...getMainMenu(user) });
        }
    } 
    else if (text === t.am.btn_guide || text === t.en.btn_guide || text === t.or.btn_guide || text === t.ti.btn_guide || text.includes('መመሪያ') || text.includes('Guide') || text.includes('Qajeelfama') || text.includes('መምርሒ')) { 
        if(!user) return; 
        let langParam = user.language || 'am';
        let guideTxt = langParam === 'en' ? "Open Guide" : (langParam === 'or' ? "Qajeelfama Bani" : (langParam === 'ti' ? "መምርሒ ክፈት" : "መመሪያ ክፈት"));
        bot.sendMessage(chatId, "📖 <b>እንዴት መጫወት እና ማሸነፍ ይቻላል?</b>\n\nከታች ያለውን ቁልፍ በመጫን በምስል የተደገፈ መመሪያ ይመልከቱ።", { 
            parse_mode: "HTML", 
            reply_markup: { inline_keyboard: [[{ text: `📖 ${guideTxt}`, web_app: { url: `${WEB_URL}/guide?lang=${langParam}` } }]] }
        }); 
    }
    else if (text === t.am.btn_help || text === t.en.btn_help || text === t.or.btn_help || text === t.ti.btn_help || text.includes('እርዳታ') || text.includes('Help') || text.includes('Gargaarsa') || text.includes('ሓገዝ') || text === '/help') { 
        if(!user) return; 
        bot.sendMessage(chatId, "💬 <b>ማንኛውም ጥያቄ ወይም አስተያየት ካለዎት አድሚኑን በቴሌግራም ቀጥታ በ @amarbingo ያናግሩ።\n\n📞 በተጨማሪም በቀጥታ በስልክ መስመራችን፡ YOUR_PHONE_NUMBER ይደውሉልን።</b>", { parse_mode: "HTML", ...getMainMenu(user) }); 
    }
    else if (text === t.am.btn_lang || text === t.en.btn_lang || text === t.or.btn_lang || text === t.ti.btn_lang || text.includes('ቋንቋ') || text.includes('Language') || text === '/lang') { 
        if(!user) return; 
        bot.sendMessage(chatId, "እባክዎ ቋንቋ ይምረጡ (Choose Language):", { 
            reply_markup: { 
                inline_keyboard: [
                    [{text: "🇪🇹 አማርኛ", callback_data: "lang_am"}, {text: "🇺🇸 English", callback_data: "lang_en"}],
                    [{text: "🌳 Afaan Oromoo", callback_data: "lang_or"}, {text: "🇪🇷 ትግርኛ", callback_data: "lang_ti"}]
                ] 
            } 
        }); 
    } 
    else if (text === t.am.btn_rules || text === t.en.btn_rules || text === t.or.btn_rules || text === t.ti.btn_rules || text.includes('ደንቦች') || text.includes('Rules') || text.includes('Seera') || text.includes('ሕግታት')) { 
        if(!user) return; 
        bot.sendMessage(chatId, ln.rules_msg, { parse_mode: "HTML", ...getMainMenu(user) }); 
    } 
    
    else if (state.step === 'awaiting_dep_amt') {
        state.amount = parseFloat(text); if(isNaN(state.amount) || state.amount < 50) return bot.sendMessage(chatId, ln.invalid_amt(50), cancelKeyboard(ln));
        bot.sendMessage(chatId, ln.enter_sms(state.amount), { parse_mode: "HTML", ...cancelKeyboard(ln) }); state.step = 'awaiting_dep_sms';
    } 
    else if (state.step === 'awaiting_dep_sms') {
        if(user) { 
            let txRef = getTxRef(text);
            if (!txRef) { return bot.sendMessage(chatId, "❌ ትክክለኛ የባንክ ማረጋገጫ (TxRef) ከፅሁፉ ውስጥ አልተገኘም። እባክዎ ትክክለኛውን የባንክ SMS ይላኩ።", { parse_mode: "HTML", ...getMainMenu(user) }); }
            let isUsed = await isSmsAlreadyUsed(text);
            if (isUsed) { 
                await SystemLog.create({ phone: user.phone, actionType: "Fake Deposit Attempt", details: `Tried to use existing TxRef: ${txRef}`, severity: "High" });
                return bot.sendMessage(chatId, "❌ ያስገቡት sms (TxRef) ቀድሞ ጥቅም ላይ ውሏል!", { parse_mode: "HTML", ...getMainMenu(user) }); 
            }

            // 1. ጥያቄውን ሴቭ ያደርጋል
            let newTx = await new Transaction({ phone: user.phone, type: 'deposit', amount: state.amount, method: state.method, smsText: text, txRef: txRef }).save(); 
            
            // 2. የባንክ SMS ቀድሞ መጥቶ እንደሆነ ቼክ ያደርጋል
            await autoApprovePendingDeposits(); 
            
            // 3. አሁንም Pending ከሆነ ለተጠቃሚው ሜሴጅ ይልካል (Approve ከሆነ autoApprovePendingDeposits ራሱ "ገባልህ" ብሎ ይልካል)
            let checkTx = await Transaction.findById(newTx._id);
            if (checkTx && checkTx.status === 'Pending') {
                let pendMsg = `⏳ <b>የገቢ ጥያቄዎ በመታየት ላይ ነው!</b>\n\n🧾 <b>ማረጋገጫ (TxRef):</b> ${txRef}\n\nባንኩ ሜሴጅ (SMS) እንደላከልን በሰከንዶች ውስጥ በራሱ አረጋግጦ ሂሳብዎ ላይ ይሞላል። እባክዎ ትንሽ ይጠብቁ...`;
                bot.sendMessage(chatId, pendMsg, { parse_mode: "HTML", ...getMainMenu(user) });
            }
        }
        state.step = 'idle';
    } 
    else if (state.step === 'awaiting_wit_acc') {
        state.destinationPhone = text.trim(); 
        bot.sendMessage(chatId, ln.enter_wit_amt(state.destinationPhone, GLOBAL_SETTINGS.minWithdrawLimit), { parse_mode: "HTML", ...cancelKeyboard(ln) }); state.step = 'awaiting_wit_amt';
    }
    else if (state.step === 'awaiting_wit_amt') {
        state.amount = parseFloat(text); 
        if(isNaN(state.amount) || state.amount < GLOBAL_SETTINGS.minWithdrawLimit) return bot.sendMessage(chatId, ln.invalid_amt(GLOBAL_SETTINGS.minWithdrawLimit), cancelKeyboard(ln));
        if(user) {
            if(user.mainBalance < state.amount) return bot.sendMessage(chatId, ln.insufficient, { ...getMainMenu(user) });
            user.mainBalance -= state.amount; await user.save(); await new Transaction({ phone: user.phone, type: 'withdraw', amount: state.amount, method: state.method, smsText: `Transfer to: ${state.destinationPhone}` }).save();
            bot.sendMessage(chatId, ln.wit_success(state.amount, state.destinationPhone), { parse_mode: "HTML", ...getMainMenu(user) });
        }
        state.step = 'idle';
    }
    botState[chatId] = state;
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id; 
    const data = query.data;
    let user = await User.findOne({ telegramId: query.from.id.toString() }); 
    let ln = getLang(user);
    
    // 1. የቋንቋ ምርጫ
    if(data.startsWith('lang_')) { 
        if(user) { 
            user.language = data.split('_')[1]; 
            await user.save(); 
            ln = getLang(user); 
            bot.sendMessage(chatId, ln.lang_set, { parse_mode: "HTML", ...getMainMenu(user) }); 
        } 
        bot.answerCallbackQuery(query.id); 
        return; 
    }
    
    // 2. የፕሮሞ ቦነስ መውሰጃ (Claim Promo)
    if (data === 'claim_promo') {
        if(!user) return bot.answerCallbackQuery(query.id, { text: "❌ እባክዎ መጀመሪያ ይመዝገቡ!", show_alert: true });
        
        let isJoined = await checkTelegramJoin(user.telegramId);
        if(!isJoined) return bot.answerCallbackQuery(query.id, { text: `❌ ይህንን ቦነስ ለመውሰድ እባክዎ መጀመሪያ የቴሌግራም ቻናላችንን ይቀላቀሉ! ቻናል: ${GLOBAL_SETTINGS.telegramChannel}`, show_alert: true });

        let activeBonus = await ActiveBonus.findOne({ isActive: true, expiresAt: { $gt: new Date() } });
        if (!activeBonus) return bot.answerCallbackQuery(query.id, { text: "❌ ፕሮሞው አልቋል ወይም ጊዜው አልፏል!", show_alert: true });
        if (activeBonus.currentClaims >= activeBonus.maxUsers) return bot.answerCallbackQuery(query.id, { text: "❌ ይቅርታ! የሰው ኮታ ሞልቷል።", show_alert: true });
        if (activeBonus.claimedBy.includes(user.phone)) return bot.answerCallbackQuery(query.id, { text: "❌ እርስዎ ይህንን ቦነስ ቀድመው ወስደዋል!", show_alert: true });
        
        if (activeBonus.depositorsOnly) {
            let minDep = activeBonus.minDepositAmount || 0;
            if (activeBonus.requireDepositWithinHours > 0) {
                let cutoff = new Date(Date.now() - (activeBonus.requireDepositWithinHours * 60 * 60 * 1000));
                let recentDep = await Transaction.findOne({ phone: user.phone, type: 'deposit', status: 'Approved', amount: { $gte: minDep }, date: { $gte: cutoff } });
                if (!recentDep) return bot.answerCallbackQuery(query.id, { text: `❌ ይህንን ቦነስ ለማግኘት ባለፉት ${activeBonus.requireDepositWithinHours} ሰዓታት ውስጥ ቢያንስ ${minDep} ብር ገቢ አድርገው መሆን አለበት!`, show_alert: true });
            } else {
                let validDep = await Transaction.findOne({ phone: user.phone, type: 'deposit', status: 'Approved', amount: { $gte: minDep } });
                if (!validDep) return bot.answerCallbackQuery(query.id, { text: `❌ ይህንን ቦነስ ለማግኘት ቢያንስ ${minDep} ብር ገቢ (Deposit) አድርገው መሆን አለበት!`, show_alert: true });
            }
        }

        activeBonus.claimedBy.push(user.phone); 
        activeBonus.currentClaims += 1; 
        await activeBonus.save(); 
        user.playBalance += activeBonus.amount; 
        await user.save();
        io.emit('balance_updated', user.phone); 
        return bot.answerCallbackQuery(query.id, { text: `🎉 እንኳን ደስ አሎት! የ ${activeBonus.amount} ETB ቦነስ አግኝተዋል!`, show_alert: true });
    }

    // የቴሌግራም ስቴት (State) መቆጣጠሪያ
    if(!botState[chatId]) botState[chatId] = { step: 'idle' }; 
    let state = botState[chatId];
    
    // 3. ዴፖዚት ሲደረግ (አዲሱ የባንክ ኮድ ያለበት)
    if (data.startsWith('dep_')) {
        state.method = data.split('_')[1]; 
        state.step = 'awaiting_dep_amt';
        
        let accInfo = { num: '09...', name: 'Bingo Admin' };
        if(state.method === 'TeleBirr') {
            accInfo = { num: GLOBAL_SETTINGS.telebirrAccountNumber, name: GLOBAL_SETTINGS.telebirrAccountName };
        } else if (state.method === 'CBEBirr') {
            accInfo = { num: GLOBAL_SETTINGS.cbeAccountNumber, name: GLOBAL_SETTINGS.cbeAccountName };
        }
        
        let warn = state.method === 'TeleBirr' ? ln.warn_telebirr : (state.method === 'CBEBirr' ? ln.warn_cbebirr : "");
        bot.sendMessage(chatId, ln.bank_info(state.method, warn, accInfo.name, accInfo.num), { parse_mode: "HTML", ...cancelKeyboard(ln) });
    }
    // 4. ዊዝድሮው (Withdraw) ሲደረግ
    else if (data.startsWith('wit_')) { 
        if(!user) return bot.answerCallbackQuery(query.id);
        state.method = data.split('_')[1]; 
        state.destinationPhone = user.phone; 
        state.step = 'awaiting_wit_amt'; 
        bot.sendMessage(chatId, ln.enter_wit_amt(user.phone, GLOBAL_SETTINGS.minWithdrawLimit), { parse_mode: "HTML", ...cancelKeyboard(ln) }); 
    }
    
    botState[chatId] = state; 
    bot.answerCallbackQuery(query.id);
});


const basicAuth = (req, res, next) => {
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
    
    if (req.path === '/Babi2204') {
        if (login === 'admin' && password === GLOBAL_SETTINGS.adminPass) { 
            return next(); 
        }
    }
    
    if (req.path === '/papi2204') {
        if ((login === 'finance' && password === GLOBAL_SETTINGS.financePass) || 
            (login === 'admin' && password === GLOBAL_SETTINGS.adminPass)) { 
            return next(); 
        }
    }
    
    res.set('WWW-Authenticate', 'Basic realm="Secure Area"');
    res.status(401).send('<h1>🔒 Private Page. Access Denied.</h1><p>እባክዎ ትክክለኛውን Username እና Password ያስገቡ።</p>');
};

app.get('/guide', (req, res) => {
    let lang = req.query.lang || 'am';
    
    const guideTrans = {
        am: {
            title: "📖 የጨዋታው መመሪያ እና ደንቦች",
            terms_html: `<div style="font-size:16px; font-weight:800; color:#fbbf24; margin-bottom:10px;">አማር ቢንጎ — የተጠቃሚ መመሪያ እና የስምምነት ውል</div>
            <p style="margin:0 0 14px 0;">እንኳን ወደ አማር ቢንጎ ቤተሰብ በደህና መጡ! መዝናናትዎ እና ደህንነትዎ ቅድሚያ የምንሰጣቸው ጉዳዮች ናቸው። መጫወት ከመጀመርዎ በፊት እነዚህን መመሪያዎች በጥንቃቄ አንብበው እንዲከተሉ በትህትና እንጠይቃለን።</p>
            <div style="font-weight:800; color:#4ade80; margin:0 0 8px 0;">1. የጨዋታው ባህሪ እና አሠራር</div>
            <ul style="margin:0 0 14px 0; padding-left:18px;">
                <li style="margin-bottom:8px;"><b>ሙሉ በሙሉ የዕድል ጨዋታ፦</b> የአማር ቢንጎ ውጤቶች ሙሉ በሙሉ በዕጣ እና በዕድል ይወሰናሉ። ስለዚህ ማንኛውንም ዙር እንደሚያሸንፉ ዋስትና ወይም አስቀድሞ የተወሰነ ውጤት የለም።</li>
                <li style="margin-bottom:8px;"><b>እያንዳንዱ ዙር ለብቻው ነው፦</b> እያንዳንዱ ዙር ሙሉ በሙሉ የተለየ ክስተት ነው፤ ካለፉ ጨዋታዎች ጋር ቀጥተኛ ግንኙነት የለውም። መሸነፍ ወደፊት ድል እንደሚያረጋግጥ ማመን ስህተት ነው፤ ምንም ቀመር ወይም ሳይንሳዊ እርግጠኝነት የለም። ተከታታይ መሸነፍ ሊከሰት እንደሚችል በመገንዘብ በኃላፊነት ይጫወቱ።</li>
                <li><b>ለመዝናኛ ብቻ፦</b> ይህ መድረክ የተዘጋጀው በትርፍ ጊዜዎ ለመዝናናት እና ለማረፍ ብቻ ነው። ቢጠፋ የዕለት ተዕለት ኑሮዎን ወይም የገንዘብ ደህንነትዎን የማይነካ፣ መለየት የሚችሉትን ገንዘብ ብቻ እንድትጫወቱ አጥብቀን እንመክራለን።</li>
            </ul>
            <div style="font-weight:800; color:#4ade80; margin:0 0 8px 0;">2. የአካውንት እና የክፍያ አስተዳደር</div>
            <ul style="margin:0; padding-left:18px;">
                <li><b>ተመላሽ የማይደረግ ገቢ፦</b> ወደ አማር ቢንጎ ሂሳብዎ የገባ ማንኛውም ገንዘብ በቀጥታ ለጨዋታ ተሳትፎ የተመደበ ነው። አንዴ ከተሞላ በኋላ ገቢው በፍጹም ተመላሽ አይደረግም።</li>
            </ul>`,
            win_title: "🏆 ማሸነፊያ መንገዶች",
            win_desc: "ከታች ባሉት አራት ቅርፆች መሰረት ከተጠሩት ቁጥሮች አምስቱን ካገኙ <b>BINGO</b> ብለው ያሸንፋሉ!",
            horiz: "1. በአግድም",
            vert: "2. ወደ ታች",
            diag: "3. በማዕዘን (X ቅርጽ)",
            corner: "4. አራቱ ጥግ",
            hint: "💡 ሲስተሙ ራሱ አሸናፊውን ስለሚለይ ምንም መነካት አይጠበቅብዎትም!",
            back: "🔙 ወደ ኋላ ተመለስ"
        },
        en: {
            title: "📖 Game Guide & Rules",
            terms_html: `<div style="font-size:16px; font-weight:800; color:#fbbf24; margin-bottom:10px;">Amar Bingo — User Guide &amp; Terms of Agreement</div>
            <p style="margin:0 0 14px 0;">Welcome to the Amar Bingo family! Your entertainment and safety are our top priorities. Before starting to play, we kindly ask you to read and follow these guidelines:</p>
            <div style="font-weight:800; color:#4ade80; margin:0 0 8px 0;">1. Nature and Mechanics of the Game</div>
            <ul style="margin:0 0 14px 0; padding-left:18px;">
                <li style="margin-bottom:8px;"><b>Pure Game of Chance:</b> Amar Bingo results are completely determined by a random lottery/chance. Therefore, there is no guarantee or predetermined outcome to win any round.</li>
                <li style="margin-bottom:8px;"><b>Independent Rounds:</b> Each round is an entirely separate event and has no direct connection to past games. Believing a loss will guarantee a future win is a fallacy; there is no formula or scientific certainty. Please play responsibly, knowing that consecutive losses can happen.</li>
                <li><b>For Entertainment Only:</b> This platform is designed solely for leisure and relaxation in your free time. We strongly advise you to play only with disposable funds that will not affect your daily life or financial well-being if lost.</li>
            </ul>
            <div style="font-weight:800; color:#4ade80; margin:0 0 8px 0;">2. Account &amp; Payment Management</div>
            <ul style="margin:0; padding-left:18px;">
                <li><b>Non-Refundable Deposits:</b> Any funds deposited into your Amar Bingo balance are dedicated directly to gameplay participation. Once credited, deposits are strictly non-refundable.</li>
            </ul>`,
            win_title: "🏆 Winning Patterns",
            win_desc: "Match 5 numbers based on the four patterns below to win <b>BINGO</b>!",
            horiz: "1. Horizontal",
            vert: "2. Vertical",
            diag: "3. Diagonal (X)",
            corner: "4. Four Corners",
            hint: "💡 The system detects winners automatically. You don't need to touch anything!",
            back: "🔙 Go Back"
        }
    };

    let tr = guideTrans[lang] || guideTrans['am'];

    let html = `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${tr.title}</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: white; padding: 20px; text-align: center; margin: 0; padding-bottom: 90px !important; }
            h2 { color: #4ade80; margin-top: 10px; }
            .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; max-width: 280px; margin: 15px auto 30px auto; background: #1e293b; padding: 12px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
            .cell { background: #334155; padding: 12px 0; border-radius: 6px; font-weight: bold; font-size: 15px; color: #cbd5e1; display:flex; align-items:center; justify-content:center; }
            .hl { background: #fbbf24; color: black; box-shadow: 0 0 10px rgba(251,191,36,0.6); transform: scale(1.05); }
            .title { color: #38bdf8; font-size: 18px; font-weight: bold; border-bottom: 2px dashed #334155; display: inline-block; padding-bottom: 5px; margin-bottom: 5px; }
            .free { background: #0f172a; color: white; border: 1px solid #4ade80; font-size: 12px; }
            .free.hl { background: #4ade80; color: black; border: none; }
            
            .back-btn-wrapper {
                position: fixed; bottom: 15px; left: 50%; transform: translateX(-50%);
                width: 90%; max-width: 400px; z-index: 9999;
            }
            .back-btn-wrapper button {
                width: 100%; padding: 16px; border-radius: 14px;
                background: linear-gradient(135deg, #1e293b, #0f172a);
                border: 2px solid #4ade80; color: #4ade80;
                font-size: 16px; font-weight: 900;
                box-shadow: 0 10px 25px rgba(0,0,0,0.8); cursor: pointer;
                text-transform: uppercase; letter-spacing: 1px;
                transition: 0.3s;
            }
            .back-btn-wrapper button:active { transform: scale(0.95); }
        </style>
    </head>
    <body>
        <div style="text-align: left; margin-bottom: 10px; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 16px; font-weight: 900; letter-spacing: 1px; background: rgba(0,0,0,0.3); display: inline-block; padding: 5px 10px; border-radius: 6px; float: left;">
            <span style="color: #4ade80;">አማር</span> <span style="color: #ffffff;">ቢንጎ</span>
        </div>
        <div style="clear: both;"></div>

        <h2>${tr.title}</h2>
        
        <div style="text-align: left; background: #1e293b; padding: 15px; border-radius: 10px; margin-bottom: 30px; font-size: 14px; line-height: 1.65; border: 1px solid #334155; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
            ${tr.terms_html}
        </div>

        <h2 style="color: #38bdf8;">${tr.win_title}</h2>
        <p style="color:#94a3b8; font-size:14px; margin-bottom: 30px;">${tr.win_desc}</p>

        <div class="title">${tr.horiz}</div>
        <div class="grid">
            <div class="cell hl">1</div><div class="cell hl">16</div><div class="cell hl">31</div><div class="cell hl">46</div><div class="cell hl">61</div>
            <div class="cell">2</div><div class="cell">17</div><div class="cell">32</div><div class="cell">47</div><div class="cell">62</div>
            <div class="cell">3</div><div class="cell">18</div><div class="cell free">FREE</div><div class="cell">48</div><div class="cell">63</div>
            <div class="cell">4</div><div class="cell">19</div><div class="cell">34</div><div class="cell">49</div><div class="cell">64</div>
            <div class="cell">5</div><div class="cell">20</div><div class="cell">35</div><div class="cell">50</div><div class="cell">65</div>
        </div>

        <div class="title">${tr.vert}</div>
        <div class="grid">
            <div class="cell hl">1</div><div class="cell">16</div><div class="cell">31</div><div class="cell">46</div><div class="cell">61</div>
            <div class="cell hl">2</div><div class="cell">17</div><div class="cell">32</div><div class="cell">47</div><div class="cell">62</div>
            <div class="cell hl">3</div><div class="cell">18</div><div class="cell free hl">FREE</div><div class="cell">48</div><div class="cell">63</div>
            <div class="cell hl">4</div><div class="cell">19</div><div class="cell">34</div><div class="cell">49</div><div class="cell">64</div>
            <div class="cell hl">5</div><div class="cell">20</div><div class="cell">35</div><div class="cell">50</div><div class="cell">65</div>
        </div>

        <div class="title">${tr.diag}</div>
        <div class="grid">
            <div class="cell hl">1</div><div class="cell">16</div><div class="cell">31</div><div class="cell">46</div><div class="cell">61</div>
            <div class="cell">2</div><div class="cell hl">17</div><div class="cell">32</div><div class="cell">47</div><div class="cell">62</div>
            <div class="cell">3</div><div class="cell">18</div><div class="cell free hl">FREE</div><div class="cell">48</div><div class="cell">63</div>
            <div class="cell">4</div><div class="cell">19</div><div class="cell">34</div><div class="cell hl">49</div><div class="cell">64</div>
            <div class="cell">5</div><div class="cell">20</div><div class="cell">35</div><div class="cell">50</div><div class="cell hl">65</div>
        </div>

        <div class="title">${tr.corner}</div>
        <div class="grid">
            <div class="cell hl">1</div><div class="cell">16</div><div class="cell">31</div><div class="cell">46</div><div class="cell hl">61</div>
            <div class="cell">2</div><div class="cell">17</div><div class="cell">32</div><div class="cell">47</div><div class="cell">62</div>
            <div class="cell">3</div><div class="cell">18</div><div class="cell free">FREE</div><div class="cell">48</div><div class="cell">63</div>
            <div class="cell">4</div><div class="cell">19</div><div class="cell">34</div><div class="cell">49</div><div class="cell">64</div>
            <div class="cell hl">5</div><div class="cell">20</div><div class="cell">35</div><div class="cell">50</div><div class="cell hl">65</div>
        </div>
        
        <p style="color:#4ade80; font-size:12px; margin-top:20px; border:1px dashed #4ade80; padding:10px; border-radius:8px;">${tr.hint}</p>

        <div class="back-btn-wrapper">
            <button onclick="window.location.href='/'">${tr.back}</button>
        </div>

    </body>
    </html>
    `;
    res.send(html);
});

app.get('/promoter', async (req, res) => {
    let phone = req.query.phone;
    let pass = req.query.pass;
    let user = await User.findOne({ phone, password: pass });
    if(!user || !user.isPromoter) return res.send("<h1 style='color:red; text-align:center; margin-top:50px;'>❌ Unauthorized / የተፈቀደ አስተዋዋቂ አይደሉም!</h1>");

    let referredUsers = await User.find({ referredBy: user.phone });
    let activeDepositedUsers = referredUsers.filter(u => u.totalDeposited > 0).length;

    let txHistory = await Transaction.find({ phone: user.phone, method: "Promoter Comm" }).sort({ date: -1 }).limit(15);
    
    let myCode = user.refCode ? user.refCode : user.phone;
    let link = `https://t.me/amar_bingo_bot?start=promo_${myCode}`;

    let lang = user.language || 'am';
    
    const proTrans = {
        am: {
            dash: "📊 ዳሽቦርድ (Dashboard)",
            brought: "👥 ያመጧቸው (Total)", active: "✅ ገቢ ያደረጉ (Active)", bal: "💰 ሂሳብ (Balance)", earned: "🎁 የተሰበሰበ ኮሚሽን",
            perc: "📈 የኮሚሽን መጠንዎ", link_title: "🔗 ኮሚሽን ማግኛ ሊንክ (Promo Link):", copy_hint: "📋 ይጫኑ ኮፒ ለማድረግ", copied: "✅ ሊንክዎ ኮፒ ተደርጓል (Link Copied)!",
            wit_title: "💸 ኮሚሽን ወጪ ማድረጊያ", wit_desc: "ያገኙትን ኮሚሽን በቀጥታ ወደ አካውንትዎ ያስገቡ",
            amt_ph: "የብር መጠን (ቢያንስ 500 ብር)", acc_ph: "የባንክ አካውንት (ወይም ስልክ)", btn_wit: "ወጪ አድርግ (Withdraw)",
            wait: "እባክዎ ይጠብቁ...", alert_fill: "እባክዎ መረጃውን በትክክል ይሙሉ!", err_conn: "ግንኙነት ተቋርጧል",
            hist_title: "📜 የወጪ ታሪክ (Withdraw History)", date: "ቀን", amt: "መጠን", status: "ሁኔታ", no_hist: "ምንም ታሪክ የለም (No History)"
        },
        en: {
            dash: "📊 Promoter Dashboard",
            brought: "👥 Total Invited", active: "✅ Active Depositors", bal: "💰 Unpaid Balance", earned: "🎁 Total Earned",
            perc: "📈 Your Commission %", link_title: "🔗 Your Share Link:", copy_hint: "📋 Click to Copy", copied: "✅ Link Copied!",
            wit_title: "💸 Withdraw Commission", wit_desc: "Withdraw your earned commissions directly",
            amt_ph: "Amount (Min 500 ETB)", acc_ph: "Bank Account (or Phone)", btn_wit: "Withdraw Now",
            wait: "Please wait...", alert_fill: "Please fill in all details!", err_conn: "Connection Error",
            hist_title: "📜 Withdrawal History", date: "Date", amt: "Amount", status: "Status", no_hist: "No History Found"
        }
    };
    
    let pr = proTrans[lang] || proTrans['am'];

    let html = `
    <!DOCTYPE html>
    <html lang="${lang}">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Promoter Dashboard</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: white; margin: 0; padding: 20px; }
            .card { background: linear-gradient(145deg, #1e293b, #0f172a); border: 1px solid #334155; border-radius: 16px; padding: 20px; margin-bottom: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
            .title { font-size: 22px; font-weight: bold; color: #38bdf8; text-align: center; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
            .stat-box { background: #1e293b; padding: 15px; border-radius: 12px; margin-bottom: 15px; border-left: 4px solid #38bdf8; display:flex; justify-content: space-between; align-items:center;}
            .stat-box.green { border-left-color: #34d399; }
            .stat-box.orange { border-left-color: #fb923c; }
            .stat-title { font-size: 13px; color: #94a3b8; margin-bottom:5px;}
            .stat-value { font-size: 22px; font-weight: bold; color: #fff; }
            .input-group { margin-bottom: 15px; }
            input { width: 100%; padding: 14px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white; box-sizing: border-box; font-size:16px; outline:none; text-align:center;}
            input:focus { border-color: #fb923c; }
            .btn { background: #fb923c; color: #fff; border: none; padding: 16px; width: 100%; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.2s;}
            .btn:active { transform: scale(0.98); }
            .link-box { background: #020617; padding: 15px; border-radius: 8px; font-size: 13px; color: #34d399; word-break: break-all; text-align:center; border: 1px dashed #34d399; cursor:pointer;}
            .loader { display: none; margin-top: 10px; text-align: center; color: #fb923c; font-size:14px;}
        </style>
    </head>
    <body>
        <div style="text-align: left; margin-bottom: 15px; font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 16px; font-weight: 900; letter-spacing: 1px; background: rgba(0,0,0,0.3); display: inline-block; padding: 5px 10px; border-radius: 6px;">
            <span style="color: #4ade80;">አማር</span> <span style="color: #ffffff;">ቢንጎ</span>
        </div>

        <div class="card">
            <div class="title">${pr.dash}</div>
            
            <div class="stat-box">
                <div style="flex:1;">
                    <div class="stat-title">${pr.brought}</div>
                    <div class="stat-value">${referredUsers.length}</div>
                </div>
                <div style="flex:1; border-left: 1px solid #334155; padding-left: 15px;">
                    <div class="stat-title">${pr.active}</div>
                    <div class="stat-value" style="color:#4ade80;">${activeDepositedUsers}</div>
                </div>
                <div style="font-size:30px; margin-left: 10px;">🧑‍🤝‍🧑</div>
            </div>

            <div class="stat-box orange">
                <div><div class="stat-title">${pr.bal}</div><div class="stat-value" id="unpaidBal">${(user.promoterUnpaidBalance || 0).toLocaleString()} ETB</div></div>
                <div style="font-size:30px;">💳</div>
            </div>

            <div class="stat-box green">
                <div><div class="stat-title">${pr.earned}</div><div class="stat-value">${(user.promoterEarned || 0).toLocaleString()} ETB</div></div>
                <div style="font-size:30px;">💸</div>
            </div>

            <div class="stat-box" style="border-left-color: #a855f7;">
                <div><div class="stat-title">${pr.perc}</div><div class="stat-value" style="color:#a855f7;">${user.promoterPercent}%</div></div>
                <div style="font-size:30px;">🔥</div>
            </div>

            <h3 style="font-size:14px; color:#94a3b8; margin-top:20px;">${pr.link_title}</h3>
            <div class="link-box" onclick="navigator.clipboard.writeText('${link}'); alert('${pr.copied}');">${link} <br><br><span style="color:white; font-size:11px; background:#1e293b; padding:5px 10px; border-radius:5px;">${pr.copy_hint}</span></div>
        </div>

        <div class="card" style="border-top: 4px solid #fb923c;">
            <h3 style="margin-top:0; color:#fb923c; text-align:center;">${pr.wit_title}</h3>
            <p style="color:#94a3b8; font-size:12px; text-align:center; margin-bottom:20px;">${pr.wit_desc}</p>
            <div class="input-group">
                <input type="number" id="wAmt" placeholder="${pr.amt_ph}">
            </div>
            <div class="input-group">
                <input type="text" id="wAcc" placeholder="${pr.acc_ph}">
            </div>
            <button class="btn" id="wBtn" onclick="requestWithdraw()">${pr.btn_wit}</button>
            <div class="loader" id="loader">${pr.wait}</div>
        </div>

        <div class="card" style="margin-top:20px; padding: 15px;">
            <h3 style="color:#38bdf8; text-align:center; margin-top:0;">${pr.hist_title}</h3>
            <table style="width:100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                <thead>
                    <tr style="border-bottom: 1px solid #475569; color:#94a3b8;">
                        <th style="padding: 10px 5px;">${pr.date}</th>
                        <th style="padding: 10px 5px;">${pr.amt}</th>
                        <th style="padding: 10px 5px;">${pr.status}</th>
                    </tr>
                </thead>
                <tbody>
                    ${txHistory.length > 0 ? txHistory.map(tx => `
                        <tr style="border-bottom: 1px solid #334155;">
                            <td style="padding: 10px 5px;">${new Date(tx.date).toLocaleDateString()}</td>
                            <td style="padding: 10px 5px; font-weight:bold; color:#fb923c;">${tx.amount} ETB</td>
                            <td style="padding: 10px 5px;">
                                <span style="background:${tx.status==='Approved'?'#064e3b':(tx.status==='Pending'?'#78350f':'#7f1d1d')}; color:${tx.status==='Approved'?'#34d399':(tx.status==='Pending'?'#fbbf24':'#f87171')}; padding: 3px 8px; border-radius: 4px; font-size:11px;">${tx.status}</span>
                            </td>
                        </tr>
                    `).join('') : `<tr><td colspan="3" style="text-align:center; padding: 15px; color:#94a3b8;">${pr.no_hist}</td></tr>`}
                </tbody>
            </table>
        </div>

        <script>
            async function requestWithdraw() {
                let amt = document.getElementById('wAmt').value;
                let acc = document.getElementById('wAcc').value;
                if(!amt || !acc) return alert('${pr.alert_fill}');
                
                document.getElementById('wBtn').style.display = 'none';
                document.getElementById('loader').style.display = 'block';

                try {
                    let res = await fetch('/api/promoter/withdraw', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ phone: '${phone}', pass: '${pass}', amount: amt, account: acc })
                    });
                    let data = await res.json();
                    alert(data.message);
                    if(data.success) { window.location.reload(); }
                } catch(e) {
                    alert('${pr.err_conn}');
                }
                
                document.getElementById('wBtn').style.display = 'block';
                document.getElementById('loader').style.display = 'none';
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/promo_app', async (req, res) => {
    let phone = req.query.phone;
    let pass = req.query.pass;
    let user = await User.findOne({ phone, password: pass });
    if(!user) return res.send("<h1 style='color:red; text-align:center; margin-top:50px;'>❌ Unauthorized</h1>");

    let html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Promo Code - Amar Bingo</title>
        <script src="https://telegram.org/js/telegram-web-app.js"></script>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;900&display=swap');
            body { font-family: 'Poppins', sans-serif; background: radial-gradient(circle at top, #1e293b 0%, #0f172a 100%); color: white; margin: 0; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; box-sizing: border-box; overflow: hidden; position: relative;}
            
            .btn-back { position: absolute; top: 20px; left: 20px; background: rgba(0,0,0,0.5); border: 1px solid #334155; color: white; padding: 8px 15px; border-radius: 8px; font-weight: bold; cursor: pointer; text-decoration: none; font-size: 14px; transition: 0.3s; z-index: 1000;}
            .btn-back:hover { background: rgba(74, 222, 128, 0.2); border-color: #4ade80; }

            .brand-header { background: rgba(0,0,0,0.4); border: 1px solid #334155; padding: 10px 20px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 5px 15px rgba(0,0,0,0.5); display: inline-block;}
            .brand-header span:first-child { color: #4ade80; font-weight: 900; font-size: 24px; letter-spacing: 2px;}
            .brand-header span:last-child { color: #ffffff; font-weight: 900; font-size: 24px; letter-spacing: 2px;}

            .card { background: rgba(30, 41, 59, 0.7); backdrop-filter: blur(10px); border: 1px solid rgba(74, 222, 128, 0.2); border-radius: 20px; padding: 35px 25px; width: 100%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.6); text-align: center;}
            
            .icon-gift { font-size: 50px; margin-bottom: 10px; filter: drop-shadow(0 0 10px rgba(251, 191, 36, 0.5)); animation: bounce 2s infinite;}
            @keyframes bounce { 0%, 100% {transform: translateY(0);} 50% {transform: translateY(-10px);} }

            h2 { color: #fbbf24; margin-top: 0; font-size: 22px; text-transform: uppercase; letter-spacing: 1px; }
            p { color: #94a3b8; font-size: 13px; margin-bottom: 25px; line-height: 1.6; }
            
            input { width: 100%; padding: 18px; border-radius: 12px; border: 2px solid #334155; background: rgba(0,0,0,0.5); color: white; box-sizing: border-box; font-size:20px; font-weight: 900; outline:none; text-align:center; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 20px; transition: 0.3s;}
            input:focus { border-color: #fbbf24; box-shadow: 0 0 15px rgba(251, 191, 36, 0.2); background: rgba(0,0,0,0.8);}
            
            .btn { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #000; border: none; padding: 16px; width: 100%; border-radius: 12px; font-size: 16px; font-weight: 900; cursor: pointer; transition: 0.3s; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 5px 15px rgba(245, 158, 11, 0.4); margin-bottom: 10px;}
            .btn:active { transform: scale(0.95); box-shadow: 0 2px 10px rgba(245, 158, 11, 0.4);}
            .btn:hover { background: linear-gradient(135deg, #fcd34d, #fbbf24); }

            .loader { display: none; margin-top: 15px; color: #4ade80; font-size:14px; font-weight: bold; animation: pulse 1s infinite;}
            @keyframes pulse { 0% {opacity:0.5;} 100% {opacity:1;} }
        </style>
    </head>
    <body>
        <a href="/?phone=${phone}&pass=${pass}" class="btn-back">🔙 ተመለስ</a>

        <div class="brand-header">
            <span>አማር</span> <span>ቢንጎ</span>
        </div>

        <div class="card">
            <div class="icon-gift">🎁</div>
            <h2>ኩፖን (Promo Code)</h2>
            <p>በተለያዩ መንገዶች ያገኙትን የፕሮሞ ኮድ እዚህ በማስገባት የተዘጋጀልዎትን ቦነስ ይቀበሉ!</p>
            
            <input type="text" id="pCode" placeholder="ኮድ ያስገቡ..." autocomplete="off">
            
            <button class="btn" id="claimBtn" onclick="claimCode()">🚀 ቦነስ ተቀበል</button>
            <div class="loader" id="loader">እባክዎ ይጠብቁ...</div>
        </div>

        <script>
            async function claimCode() {
                let code = document.getElementById('pCode').value.trim();
                if(!code) return alert('እባክዎ ኮድ ያስገቡ!');
                
                document.getElementById('claimBtn').style.display = 'none';
                document.getElementById('loader').style.display = 'block';

                try {
                    let res = await fetch('/api/claim-promo-code', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ phone: '${phone}', pass: '${pass}', code: code })
                    });
                    let data = await res.json();
                    
                    if(data.success) {
                        alert("✅ " + data.message);
                        document.getElementById('pCode').value = '';
                    } else {
                        alert("❌ " + data.message);
                    }
                } catch(e) {
                    alert('❌ Connection Error!');
                }
                
                document.getElementById('claimBtn').style.display = 'block';
                document.getElementById('loader').style.display = 'none';
            }
        </script>
    </body>
    </html>
    `;
    res.send(html);
});

app.get('/amarbingo/papi2204', (req, res) => {
    const target = path.join(__dirname, 'public', 'mobile-ops.html');
    if (fs.existsSync(target)) res.sendFile(target); else res.send("<h1>❌ mobile ops panel not found!</h1>");
});

app.get('/Babi2204', (req, res) => {
    let target = fs.existsSync(path.join(__dirname, 'admin.html')) ? path.join(__dirname, 'admin.html') : path.join(__dirname, 'public', 'admin.html');
    if (fs.existsSync(target)) res.sendFile(target); else res.send("<h1>❌ admin.html not found!</h1>");
});

app.get('/papi2204', (req, res) => {
    let target = fs.existsSync(path.join(__dirname, 'finance.html')) ? path.join(__dirname, 'finance.html') : path.join(__dirname, 'public', 'finance.html');
    if (fs.existsSync(target)) res.sendFile(target); else res.send("<h1>❌ finance.html not found!</h1>");
});
        

app.get('*', (req, res) => {
    let target = fs.existsSync(path.join(__dirname, 'index.html')) ? path.join(__dirname, 'index.html') : path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(target)) {
        let html = fs.readFileSync(target, 'utf8');
        
        let maintenanceScript = `
        <style>
            #dynamic-maintenance {
                display: none; position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.5); z-index: 9999999; flex-direction: column; align-items: center;
                justify-content: center; color: white; text-align: center; padding: 20px; box-sizing: border-box;
                backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
            }
            body.paused-mode > *:not(#dynamic-maintenance) {
                filter: blur(12px) grayscale(50%);
                pointer-events: none;
                user-select: none;
            }
            
            .shared-alert-box {
                background: linear-gradient(135deg, rgba(22,163,74,0.3), rgba(5,150,105,0.3));
                border: 2px solid #4ade80;
                color: #ffffff;
                padding: 12px;
                border-radius: 12px;
                margin-top: 15px;
                font-size: 15px;
                font-weight: bold;
                text-align: center;
                box-shadow: 0 0 15px rgba(74,222,128,0.5);
                animation: popBlink 1s infinite alternate;
                width: 90%;
                margin-left: auto;
                margin-right: auto;
            }
            @keyframes popBlink { 
                from { transform: scale(1); box-shadow: 0 0 10px rgba(74,222,128,0.4); } 
                to { transform: scale(1.05); box-shadow: 0 0 25px rgba(74,222,128,0.8); } 
            }
        </style>

        <div id="dynamic-maintenance">
            <h1 style="color:#ea580c;font-size:50px;margin-bottom:10px;font-family:sans-serif;text-shadow: 0 4px 10px rgba(0,0,0,0.8);">⚠️ ጥገና ላይ ነን!</h1>
            <p style="font-size:24px;color:#cbd5e1;font-family:sans-serif;margin-top:0;font-weight:bold;text-shadow: 0 2px 5px rgba(0,0,0,0.8);">(MAINTENANCE)</p>
            <p style="font-size:18px;color:#f8fafc;max-width:500px;line-height:1.6;font-family:sans-serif;background:rgba(0,0,0,0.7);padding:20px;border-radius:12px;border:1px solid #ea580c;">በአሁኑ ሰዓት ሲስተሙን እያሻሻልን ስለሆነ ጌም መጫወት አይቻልም።<br><br>እባክዎ ከጥቂት ደቂቃዎች በኋላ ተመልሰው ይሞክሩ። እናመሰግናለን!</p>
        </div>
        
        <!-- 🔥 WEB PROMO POPUP 🔥 -->
        <div id="web-promo-popup" style="display:none; position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.8); z-index:99999; justify-content:center; align-items:center; backdrop-filter:blur(5px);">
            <div style="background:#1e293b; padding:20px; border-radius:12px; border:2px solid #fbbf24; text-align:center; max-width:320px; width:90%; color:white; box-shadow:0 10px 30px rgba(0,0,0,0.8);">
                <div style="font-size:50px; margin-bottom:10px;">🎁</div>
                <h2 style="color:#fbbf24; margin-top:0; font-size:22px;">ልዩ የቦነስ ስጦታ!</h2>
                <p id="web-promo-msg" style="font-size:14px; margin-bottom:20px; color:#cbd5e1; line-height:1.5;"></p>
                <button onclick="claimWebPromo()" style="background:linear-gradient(135deg, #4ade80, #16a34a); color:white; font-weight:bold; padding:12px 20px; border:none; border-radius:8px; cursor:pointer; width:100%; font-size:16px; box-shadow:0 4px 15px rgba(74,222,128,0.4);">🚀 አሁኑኑ ቦነሱን ይቀበሉ</button>
                <button onclick="document.getElementById('web-promo-popup').style.display='none'" style="background:transparent; color:#94a3b8; border:none; margin-top:15px; cursor:pointer; font-size:13px; text-decoration:underline;">አይ አሁን አልፈልግም (Close)</button>
            </div>
        </div>

        <script>
            window.claimWebPromo = async function() {
                if(!window.currentUser || !window.currentUser.phone) return alert("❌ እባክዎ መጀመሪያ Login ያድርጉ!");
                
                let btn = document.querySelector('#web-promo-popup button');
                let oldText = btn.innerText;
                btn.innerText = "እየተረጋገጠ ነው...";
                
                try {
                    let res = await fetch('/api/claim-promo-web', {
                        method: 'POST', headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({phone: window.currentUser.phone})
                    });
                    let data = await res.json();
                    if(data.success) {
                        alert("🎉 እንኳን ደስ አሎት! የ " + data.amount + " ETB ቦነስ አግኝተዋል!");
                        document.getElementById('web-promo-popup').style.display = 'none';
                    } else {
                        alert(data.message || "❌ ቦነሱን መውሰድ አልተቻለም።");
                    }
                } catch(e) {
                    alert("❌ Connection error.");
                }
                btn.innerText = oldText;
            };

            document.addEventListener("DOMContentLoaded", () => {
                let depBanner = document.querySelector('.dep-banner');
                if (depBanner && !document.getElementById('dep-strict-warn')) {
                    let warnHTML = '<div id="dep-strict-warn" style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.4); border-radius: 8px; padding: 10px; margin-bottom: 15px; font-size: 11px; color: #fde047; text-align: center;">⚠️ <b>ማሳሰቢያ:</b> እባክዎ ከ ቴሌብር ወደ ቴሌብር፣ እንዲሁም ከ ሲቢኢ ብር ወደ ሲቢኢ ብር (CBE Birr) ብቻ ገቢ ያድርጉ።</div>';
                    depBanner.insertAdjacentHTML('afterend', warnHTML);
                }

                if (typeof io !== 'undefined') {
                    const blurSocket = io();
                    
                    blurSocket.on('new_promo_alert', (data) => {
                        let msgDisplay = data.msg + "<br><br><span style='color:#4ade80; font-weight:bold; font-size:18px;'>💰 " + data.amount + " ETB</span>";
                        document.getElementById('web-promo-msg').innerHTML = msgDisplay;
                        document.getElementById('web-promo-popup').style.display = 'flex';
                    });

                    blurSocket.on('game_status', (data) => {
                        if (data.state === 'MAINTENANCE') {
                            document.body.classList.add('paused-mode');
                            document.getElementById('dynamic-maintenance').style.display = 'flex';
                        } else {
                            document.body.classList.remove('paused-mode');
                            document.getElementById('dynamic-maintenance').style.display = 'none';
                        }

                        if (data.minWithdrawLimit) {
                            let witInputs = document.querySelectorAll('input[type="number"]');
                            witInputs.forEach(input => {
                                let ph = input.getAttribute('placeholder') || '';
                                if (ph.includes('ቢያንስ') || ph.includes('Min')) {
                                    if (ph.includes('ብር') || ph.includes('ETB')) {
                                        input.setAttribute('placeholder', 'የብር መጠን (ቢያንስ ' + data.minWithdrawLimit + ' ብር)');
                                    }
                                }
                            });
                        } 
                        // 🔥 Update top header dynamically 🔥
                        let stateHeader = document.getElementById('header-state');
                        let jackpotHeader = document.getElementById('header-jackpot');
                        if(stateHeader && jackpotHeader) {
                            stateHeader.innerText = data.state;
                            stateHeader.style.color = data.state === 'PLAYING' ? '#4ade80' : 'var(--orange)';
                            jackpotHeader.innerText = Number(data.totalPrizePool || 0).toLocaleString('en-US', {minimumFractionDigits: 2}) + " ETB";
                        }
                    });

                    blurSocket.on('game_winner', (data) => {
                        let oldAlert = document.getElementById('shared-alert-msg');
                        if(oldAlert) oldAlert.remove();

                        setTimeout(() => {
                            let amIWinner = false;
                            if (window.currentUser && window.currentUser.phone && data.phone.includes(window.currentUser.phone)) {
                                amIWinner = true;
                            }

                            let titleEl = document.querySelector('.winner-card h3');
                            let nameEl = document.getElementById('win-name');
                            let winnerCard = document.querySelector('.winner-card');

                            if (amIWinner) {
                                if (titleEl) {
                                    titleEl.innerHTML = "🎉 እንኳን ደስ አሎት! 🎉";
                                    titleEl.style.color = "#4ade80";
                                    titleEl.style.fontSize = "16px";
                                }
                                if (nameEl) {
                                    nameEl.innerHTML = "እርስዎ አሸንፈዋል! 👏";
                                    nameEl.style.color = "#fbbf24";
                                }

                                let alertBox = document.createElement('div');
                                alertBox.id = 'shared-alert-msg';
                                alertBox.className = 'shared-alert-box';

                                if (data.isShared) {
                                    alertBox.innerHTML = "✨ ከሌሎች <b>" + (data.winnerCount - 1) + "</b> ሰዎች ጋር አሸንፈዋል! ✨<br><span style='font-size:12px; color:#ffffff; font-weight:normal; display:block; margin-top:5px;'>የእርስዎ ድርሻ: " + Number(data.prize).toLocaleString('en-US', {maximumFractionDigits: 0}) + " ETB ሂሳብዎ ላይ ገቢ ተደርጓል!</span>";
                                } else {
                                    alertBox.style.background = "linear-gradient(135deg, rgba(234,88,12,0.3), rgba(217,119,6,0.3))";
                                    alertBox.style.borderColor = "#fbbf24";
                                    alertBox.style.boxShadow = "0 0 15px rgba(251,191,36,0.5)";
                                    alertBox.innerHTML = "✨ ጠቅላ কমলা የደራሽ ሽልማትዎን ወስደዋል! ✨<br><span style='font-size:13px; color:#fbbf24; font-weight:bold; display:block; margin-top:5px;'>" + Number(data.prize).toLocaleString('en-US', {maximumFractionDigits: 0}) + " ETB ሂሳብዎ ላይ ገቢ ተደርጓል!</span>";
                                }
                                if(winnerCard) winnerCard.appendChild(alertBox);

                            } else {
                                if (titleEl) {
                                    titleEl.innerHTML = "አሸናፊ (WINNER)";
                                    titleEl.style.color = "white";
                                }
                                if (data.isShared) {
                                    let alertBox = document.createElement('div');
                                    alertBox.id = 'shared-alert-msg';
                                    alertBox.className = 'shared-alert-box';
                                    alertBox.innerHTML = "✨ ሽልማቱ በእነዚህ <b>" + data.winnerCount + "</b> ሰዎች መካከል እኩል ተካፋይ ሆኗል! ✨<br><span style='font-size:12px; color:#4ade80; font-weight:normal; display:block; margin-top:5px;'>እያንዳንዳቸው: " + Number(data.prize).toLocaleString('en-US', {maximumFractionDigits: 0}) + " ETB</span>";
                                    if(winnerCard) winnerCard.appendChild(alertBox);
                                }
                            }
                        }, 150); 
                    });
                }
            });
        </script>
        `;
        
        html = html.replace('<body>', '<body>\n' + maintenanceScript);
        
        if (GLOBAL_SETTINGS.isGamePaused) {
            html = html.replace('<body>', '<body class="paused-mode">');
        }
        
        res.send(html);
    } else {
        res.send("<h1>Amar Bingo System is Running.</h1>");
    }
});

setInterval(async () => {
    try {
        await User.updateMany({ totalDeposited: { $gt: 0 }, diagnosticFraudReported: true }, { $set: { diagnosticFraudReported: false } });
        await User.updateMany({ mainBalance: { $gte: 0 }, playBalance: { $gte: 0 }, diagnosticNegativeReported: true }, { $set: { diagnosticNegativeReported: false } });

        let negativeUsers = await User.find({ $or: [{mainBalance: {$lt: 0}}, {playBalance: {$lt: 0}}], diagnosticNegativeReported: { $ne: true } });
        for (let u of negativeUsers) {
            await SystemLog.create({ 
                phone: u.phone, 
                actionType: "CRITICAL: Negative Balance Detected", 
                details: `System Alert: Main: ${u.mainBalance}, Play: ${u.playBalance}`, 
                severity: "High" 
            });
            u.diagnosticNegativeReported = true;
            await u.save();
        }

        let fraudUsers = await User.find({ totalDeposited: 0, played: { $gte: 5 }, diagnosticFraudReported: { $ne: true } });
        for (let u of fraudUsers) {
            await SystemLog.create({ 
                phone: u.phone, 
                actionType: "FRAUD ALERT: Bonus Exploiter", 
                details: `Played ${u.played} times without making any deposit.`, 
                severity: "High" 
            });
            u.diagnosticFraudReported = true;
            await u.save();
        }
    } catch (error) {
        console.log("System Check Error:", error.message);
    }
}, 15 * 60 * 1000); 

// ==========================================
// 🧹 አዲሱ የ AUTO-CLEANUP ኮድ (DATABASE PRUNING)
// የገንዘብ ታሪክ (Transaction) መቼም አይጠፋም። ሌሎች ብቻ ይፀዳሉ።
// ==========================================
setInterval(async () => {
    try {
        // 1. GameHistory Cleanup (የቅርብ ጊዜ 11000 ጌሞችን ብቻ አስቀርቶ የድሮውን ያጠፋል)
        const gameCount = await GameHistory.countDocuments();
        if (gameCount > 10000) {
            // RAM እንዳይሞላ select('date') ተጠቅመናል
            const gamesToKeep = await GameHistory.find().select('date').sort({ date: -1 }).limit(10000).lean();
            if (gamesToKeep.length === 10000) {
                await GameHistory.deleteMany({ date: { $lt: gamesToKeep[9999].date } });
            }
        }

        // 2. BankSMS Cleanup (1000 ሜሴጆችን ብቻ አስቀርቶ ሌላውን ሙሉ በሙሉ ያጠፋል)
        const smsCount = await BankSMS.countDocuments();
        if (smsCount > 1000) {
            const smsToKeep = await BankSMS.find().select('dateReceived').sort({ dateReceived: -1 }).limit(1000).lean();
            if (smsToKeep.length === 1000) {
                // 🔥 isUsed: true የሚለውን አጥፍተነዋል። አሁን የቆሸሸ እና አላስፈላጊ (Spam) ሜሴጆችንም ጠራርጎ ያጠፋል!
                await BankSMS.deleteMany({ dateReceived: { $lt: smsToKeep[999].dateReceived } });
            }
        }

        // 3. SystemLog Cleanup (የሲስተም ሎግ 1000 ብቻ አስቀርቶ ያጠፋል)
        const logCount = await SystemLog.countDocuments();
        if (logCount > 1000) {
            const logsToKeep = await SystemLog.find().select('date').sort({ date: -1 }).limit(1000).lean();
            if (logsToKeep.length === 1000) {
                await SystemLog.deleteMany({ date: { $lt: logsToKeep[999].date } });
            }
        }

        // 4. SupportMessage Cleanup (የእርዳታ መልዕክት 1000 ብቻ አስቀርቶ ያጠፋል)
        const msgCount = await SupportMessage.countDocuments();
        if (msgCount > 1000) {
            // 🔥 የነበረው የ GameHistory እና latestMsgs ERROR ተስተካክሏል!
            const msgsToKeep = await SupportMessage.find().select('date').sort({ date: -1 }).limit(1000).lean();
            if (msgsToKeep.length === 1000) {
                await SupportMessage.deleteMany({ date: { $lt: msgsToKeep[999].date } });
            }
        }
        
    } catch (error) {
        console.log("⚠️ DB Cleanup Error:", error.message);
    }
}, 60 * 60 * 1000); // በየ 1 ሰዓቱ (60 ደቂቃ) ይሰራል


// ==========================================
// 🔴 የ ERROR መቆጣጠሪያ እና ሰርቨር ማስነሻ
// ==========================================
process.on('unhandledRejection', (reason, promise) => {
    if (reason && reason.message && reason.message.includes('bot was blocked by the user')) {
        console.log('⚠️ ማሳሰቢያ: አንድ ተጫዋች ቦቱን ብሎክ አድርጓል። ሰርቨሩ ግን ስራውን ይቀጥላል።');
    } else {
        console.log("Unhandled Error Ignored:", reason.message || reason);
    }
});

process.on('uncaughtException', (err) => {
    if (err && err.message && err.message.includes('bot was blocked by the user')) {
        console.log('⚠️ ማሳሰቢያ: ተጠቃሚው ቦቱን ብሎክ አድርጓል።');
    } else {
        console.error('Uncaught Exception thrown:', err);
    }
});

// የሰርቨሩ መጨረሻ
server.listen(process.env.PORT || 3000, () => console.log(`🚀 Server running on port 3000`));
























