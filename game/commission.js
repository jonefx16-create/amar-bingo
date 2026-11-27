'use strict';

const PLATFORM_COMMISSION_RATE = 0.20;

/** Hardcoded 10 ETB card: 2 ETB platform fee, 8 ETB into the active round prize pool. */
const CARD_PRICE_ETB = 10;
const CARD_PLATFORM_FEE_ETB = 2;
const CARD_PRIZE_POOL_ETB = 8;

/**
 * Split a stake into the 20% company cut and the net amount that remains
 * for the prize pool / vaults. Used at ticket purchase (and refunds).
 */
function splitStake(grossAmount, rate) {
    const r = rate == null ? PLATFORM_COMMISSION_RATE : Number(rate);
    const gross = Number(grossAmount) || 0;
    if (gross <= 0) {
        return { rate: r, gross: 0, fee: 0, net: 0 };
    }
    const fee = Number((gross * r).toFixed(2));
    const net = Number((gross - fee).toFixed(2));
    return { rate: r, gross, fee, net };
}

/**
 * Platform fee booked the moment a user or bot buys/reserves tickets.
 * Example: 10 ETB ticket → 2 ETB company cut, 8 ETB into the prize pool.
 */
function applyPurchaseFee(ticketPrice, ticketCount, rate) {
    const price = Number(ticketPrice) || 0;
    const count = Math.max(0, Number(ticketCount) || 0);
    const per = splitStake(price, rate);
    return {
        rate: per.rate,
        ticketPrice: price,
        ticketCount: count,
        feePerTicket: per.fee,
        netPerTicket: per.net,
        totalFee: Number((per.fee * count).toFixed(2)),
        totalNet: Number((per.net * count).toFixed(2)),
        gross: Number((price * count).toFixed(2))
    };
}

/**
 * Winner settlement: the full split is paid out with no platform cut.
 * The 20% margin is already taken at purchase via applyPurchaseFee.
 */
function applyCommissionLedger(grossSplit, winnerCount) {
    const count = Number(winnerCount) || 0;
    const gross = Number(grossSplit) || 0;
    if (count <= 0) {
        return {
            rate: 0,
            winnerCount: 0,
            grossSplit: 0,
            commissionPerClaim: 0,
            netPayout: 0,
            totalCommission: 0,
            totalNetPayout: 0
        };
    }
    const netPayout = Number(gross.toFixed(2));
    const totalNetPayout = Number((netPayout * count).toFixed(2));
    return {
        rate: 0,
        winnerCount: count,
        grossSplit: gross,
        commissionPerClaim: 0,
        netPayout,
        totalCommission: 0,
        totalNetPayout
    };
}

function computeEvenSplit(totalPrize, winnerCount) {
    if (!winnerCount) return 0;
    return Number((totalPrize / winnerCount).toFixed(2));
}

/**
 * Stake booked when a real user or a bot buys cards.
 * The 2 ETB fee and 8 ETB prize-pool share are fixed for the 10 ETB card
 * and do not follow admin profit settings.
 * A non-default unit price still keeps the 2 ETB fee; the rest of that
 * price is the prize-pool share so the charge stays equal to fee + pool.
 */
function bookCardPurchase(ticketCount, unitPrice) {
    const count = Math.max(0, Math.floor(Number(ticketCount) || 0));
    const configured = Number(unitPrice);
    const price = configured > 0 ? Number(configured.toFixed(2)) : CARD_PRICE_ETB;
    const fee = CARD_PLATFORM_FEE_ETB;
    const net = price === CARD_PRICE_ETB
        ? CARD_PRIZE_POOL_ETB
        : Number(Math.max(0, price - fee).toFixed(2));
    return {
        ticketPrice: price,
        ticketCount: count,
        feePerTicket: fee,
        netPerTicket: net,
        totalFee: Number((fee * count).toFixed(2)),
        totalNet: Number((net * count).toFixed(2)),
        gross: Number((price * count).toFixed(2)),
        refundPerTicket: price
    };
}

/**
 * Cancellation before the round locks returns the full card price (10 ETB
 * on the standard card), not the 8 ETB that was added to the prize pool.
 */
function refundCancelledCard(ticket) {
    const paidPlay = Number(ticket && ticket.paidFromPlay) || 0;
    const paidMain = Number(ticket && ticket.paidFromMain) || 0;
    const paid = Number((paidPlay + paidMain).toFixed(2));
    let refundPlay = paidPlay;
    let refundMain = paidMain;
    if (paid <= 0) {
        refundPlay = CARD_PRICE_ETB;
        refundMain = 0;
    } else if (paid < CARD_PRICE_ETB) {
        refundPlay = Number((refundPlay + (CARD_PRICE_ETB - paid)).toFixed(2));
    }
    const storedNet = Number(ticket && ticket.netToPool);
    const poolReversal = storedNet > 0 ? storedNet : CARD_PRIZE_POOL_ETB;
    return {
        refundPlay,
        refundMain,
        refundTotal: Number((refundPlay + refundMain).toFixed(2)),
        poolReversal
    };
}

module.exports = {
    PLATFORM_COMMISSION_RATE,
    CARD_PRICE_ETB,
    CARD_PLATFORM_FEE_ETB,
    CARD_PRIZE_POOL_ETB,
    splitStake,
    applyPurchaseFee,
    applyCommissionLedger,
    computeEvenSplit,
    bookCardPurchase,
    refundCancelledCard
};
