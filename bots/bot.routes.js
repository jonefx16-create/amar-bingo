const express = require('express');
const router = express.Router();
const { BotUser } = require('./bot.model');
const { applyBotMasterSettings, generateUniqueBotNames, MALE_ETH_BOT_NAMES, botNameKey, botNameEndsWithNumber, selectVisibleBotUsers, botListFilter, BOT_LIST_PAGE_SIZE } = require('../game/botController');

// server.js ላይ ያሉትን Settings እና Auth ወደዚህ ፋይል ለማምጣት በ Parameter እንቀበላቸዋለን
module.exports = function(SystemSettings, loadSettings, auth) {
    
    // 1. የቦቶችን ዝርዝር ወደ Admin የሚያልከው (የነበረው)
    router.post('/bots-list', auth, async (req, res) => {
        try {
            const page = Math.max(1, parseInt(req.body.page, 10) || 1);
            const limit = Math.min(BOT_LIST_PAGE_SIZE, Math.max(1, parseInt(req.body.limit, 10) || BOT_LIST_PAGE_SIZE));
            const filter = botListFilter(req.body.search);
            const [rows, total, settings] = await Promise.all([
                BotUser.find(filter).select('name phone isActive lastPlayed cardsCount').sort({ _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
                BotUser.countDocuments(filter),
                SystemSettings.findOne().select('isBotSystemActive botWinnerForce mixBotCount isBotScheduleActive botRampMinutes botDist1 botDist2 botDist3 botDist4 botSchedule1 botSchedule2 botSchedule3 botSchedule4 botSchedule5 botSchedule6 botSchedule7').lean()
            ]);
            res.json({
                success: true,
                bots: selectVisibleBotUsers(rows),
                total: total,
                page: page,
                limit: limit,
                settings: settings
            });
        } catch(e) { 
            res.json({ success: false }); 
        }
    });

    // 2. Admin ላይ የሚስተካከለውን Bot Settings ሴቭ የሚያደርገው (የነበረው)
    // እዚህ ውስጥ isBotSystemActive (On/Off) እና botWinnerForce (Bot or Real User) አሉ።
    router.post('/bot-master-update', auth, async (req, res) => {
        try {
            let s = await SystemSettings.findOne();
            applyBotMasterSettings(s, req.body);
            
            await s.save();
            await loadSettings(); // አዲሱን Setting Update እንዲያደርግ
            res.json({ success: true });
        } catch(e) { 
            res.json({ success: false }); 
        }
    });

    // ==========================================
    // አዲስ የተጨመሩ (አንተ የጠየቅካቸው) ራውቶች
    // ==========================================

    // 3. ቦትን Edit ማድረጊያ (ስም፣ ስንት ካርቴላ እንዲይዝ እና የራሱ On/Off)
    router.post('/bot-edit', auth, async (req, res) => {
        try {
            const { botId, name, phone, cardsCount, isActive } = req.body;
            const wanted = String(name || '').trim();
            if (botNameEndsWithNumber(wanted)) {
                return res.json({ success: false, message: "A bot name cannot end with a number." });
            }
            const key = botNameKey(wanted);
            if (key) {
                const others = await BotUser.find({ _id: { $ne: botId } }, 'name').lean();
                for (let i = 0; i < others.length; i++) {
                    if (botNameKey(others[i].name) === key) {
                        return res.json({ success: false, message: "That username is already used." });
                    }
                }
            }
            await BotUser.findByIdAndUpdate(botId, {
                name: wanted,
                phone: phone,
                cardsCount: cardsCount, // ቦቱ ስንት ካርቴላ መግዛት/መያዝ እንዳለበት
                isActive: isActive      // ይሄኛው ቦት ብቻውን እንዲሰራ ወይስ እንዳይሰራ (On/Off)
            });
            res.json({ success: true, message: "Bot successfully updated!" });
        } catch(e) {
            res.json({ success: false, message: "Error updating bot" });
        }
    });

    // 4. አዲስ ቦቶችን በብዛት (30 ወይም 50) መጨመሪያ
    router.post('/bot-add-custom', auth, async (req, res) => {
        try {
            const amount = parseInt(req.body.amount) || 30; // ከ Admin የሚላክ ቁጥር (ለምሳሌ 50)
            const existing = await BotUser.find({}, 'name').lean();
            const reserved = existing.map((bot) => bot.name);
            const names = generateUniqueBotNames(amount, reserved, MALE_ETH_BOT_NAMES);
            for (let i = 0; i < names.length; i++) {
                await BotUser.create({
                    name: names[i],
                    phone: "09" + Math.floor(Math.random() * 90000000 + 10000000),
                    cardsCount: 1, // መጀመሪያ ሲገቡ በ1 ካርቴላ ይጀምራሉ (በኋላ edit ይደረጋል)
                    isActive: true
                });
            }
            res.json({ success: true, message: `${names.length} new bots added!` });
        } catch(e) {
            res.json({ success: false });
        }
    });

    // 5. ከሴኮንዱ ጋር አብረው ቀስ እያሉ ካርቴላ እንዲገዙ (Simulate) ማድረጊያ
    // ጨዋታው ሊጀመር ሰከንድ ሲቆጥር ከ Frontend በየ 1 ሰከንዱ ይህንን API መጥራት ትችላለህ
    router.post('/bot-gradual-buy', auth, async (req, res) => {
        try {
            // Master System Off ከሆነ ምንም አይግዙ
            let s = await SystemSettings.findOne();
            if(!s.isBotSystemActive) {
                return res.json({ success: true, bought: false, message: "Bot system is OFF" });
            }

            // 1 Active የሆነ ቦት በ Random እንመርጣለን
            const activeBots = await BotUser.find({ isActive: true });
            if(activeBots.length === 0) return res.json({ success: false });

            const randomBot = activeBots[Math.floor(Math.random() * activeBots.length)];
            
            // የቦቱ CardsCount ስንት እንደሆነ እናያለን 
            const cardsToBuy = randomBot.cardsCount;

            // (እዚህ ጋር ቦቱ ወደ ጨዋታው እንደገባ እና 'cardsToBuy' ያህል ካርቴላ እንደገዛ አድርገህ ወደ ጌም ሎጂክህ ትጨምረዋለህ)
            // ለምሳሌ የ Socket.io Event መላክ ትችላለህ: 
            // io.emit('bot_bought_card', { botName: randomBot.name, count: cardsToBuy })

            res.json({ 
                success: true, 
                bought: true, 
                bot: randomBot.name, 
                cards: cardsToBuy 
            });
        } catch(e) {
            res.json({ success: false });
        }
    });

    return router;
};
