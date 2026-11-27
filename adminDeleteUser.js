'use strict';

function normalizePhone(phone) {
    return String(phone || '').trim();
}

function phoneList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Games that mention this phone as a player, participant, or winner.
 * Comma-separated winnerPhone values are matched as whole tokens.
 */
function gameHistoryQuery(phone) {
    const target = normalizePhone(phone);
    return {
        $or: [
            { participantPhones: target },
            { 'playersData.phone': target },
            { winnerPhoneList: target },
            { winnerId: target },
            { winnerPhone: target },
            { winnerPhone: { $regex: '(^|[\\s,])' + escapeRegExp(target) + '([\\s,]|$)' } }
        ]
    };
}

/**
 * Remove one phone from a shared game record.
 * The document is deleted only when nobody else remains in it.
 */
function stripUserFromGame(game, phone) {
    const target = normalizePhone(phone);
    const source = game || {};
    const players = Array.isArray(source.playersData) ? source.playersData : [];
    const participants = phoneList(source.participantPhones);
    const winnerList = phoneList(source.winnerPhoneList);
    const winnerPhones = phoneList(source.winnerPhone);
    const winnerId = String(source.winnerId || '').trim();

    const involved = players.some((player) => player && String(player.phone) === target)
        || participants.indexOf(target) !== -1
        || winnerList.indexOf(target) !== -1
        || winnerPhones.indexOf(target) !== -1
        || winnerId === target;

    if (!target || !involved) return { changed: false, remove: false, patch: null };

    const nextPlayers = players.filter((player) => !player || String(player.phone) !== target);
    const nextParticipants = participants.filter((item) => item !== target);
    const nextWinnerList = winnerList.filter((item) => item !== target);
    const nextWinnerPhones = winnerPhones.filter((item) => item !== target);
    const wasWinner = winnerPhones.indexOf(target) !== -1 || winnerList.indexOf(target) !== -1 || winnerId === target;
    const winnersLeft = nextWinnerPhones.length + nextWinnerList.length;
    const nextWinnerId = winnerId === target ? (nextWinnerPhones[0] || nextWinnerList[0] || '') : winnerId;
    const remove = nextPlayers.length === 0 && nextParticipants.length === 0 && winnersLeft === 0 && !nextWinnerId;

    return {
        changed: true,
        remove,
        patch: {
            playersData: nextPlayers,
            participantPhones: nextParticipants,
            winnerPhoneList: nextWinnerList,
            winnerPhone: nextWinnerPhones.join(', '),
            winnerId: nextWinnerId,
            winnerName: (wasWinner && winnersLeft === 0) ? '' : source.winnerName
        }
    };
}

module.exports = {
    normalizePhone,
    gameHistoryQuery,
    stripUserFromGame
};
