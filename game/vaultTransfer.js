'use strict';

/**
 * Deposit split into the house wallet and the three vaults.
 * The casino switch does not apply here. Every deposit uses the admin
 * percents: Vault 2 and Vault 3 take their rates, Vault 1 takes the
 * remainder after the admin cut, and the Vault 1 + Vault 3 pair is recorded
 * on the transferred counter. Nothing from a deposit is blocked.
 */
function planDepositVaultTransfer(amount, settings) {
    settings = settings || {};
    const actual = Number(amount) || 0;
    const adminRate = settings.adminProfitPercent || 30;
    const vaultTwoRate = settings.vaultTwoPercent !== undefined ? Number(settings.vaultTwoPercent) : 10;
    const vaultThreeRate = settings.vaultThreePercent !== undefined ? Number(settings.vaultThreePercent) : 10;
    const adminCut = actual * (adminRate / 100);
    const vaultTwoCut = actual * (vaultTwoRate / 100);
    const vaultThreeCut = actual * (vaultThreeRate / 100);
    const vaultOneCut = actual - adminCut - vaultTwoCut - vaultThreeCut;
    return {
        allow: true,
        adminCut: adminCut,
        vaultOneCut: vaultOneCut,
        vaultTwoCut: vaultTwoCut,
        vaultThreeCut: vaultThreeCut,
        transferred: vaultOneCut + vaultThreeCut,
        blocked: 0,
        mainWalletCut: adminCut
    };
}

/**
 * Apply one deposit to the vault balances and the transferred ledger.
 * The blocked counter is left unchanged. The casino switch is ignored.
 */
function applyDepositVaultSplit(state, amount, settings) {
    const plan = planDepositVaultTransfer(amount, settings);
    const current = state || {};
    const inc = {
        vaultTwoBalance: plan.vaultTwoCut,
        vaultTransferredAmount: plan.transferred,
        vaultBlockedAmount: plan.blocked
    };
    if (plan.vaultOneCut) inc.virtualPrizePool = plan.vaultOneCut;
    if (plan.vaultThreeCut) inc.vaultThreeBalance = plan.vaultThreeCut;
    return {
        plan: plan,
        inc: inc,
        next: {
            virtualPrizePool: (Number(current.virtualPrizePool) || 0) + plan.vaultOneCut,
            vaultTwoBalance: (Number(current.vaultTwoBalance) || 0) + plan.vaultTwoCut,
            vaultThreeBalance: (Number(current.vaultThreeBalance) || 0) + plan.vaultThreeCut,
            vaultTransferredAmount: (Number(current.vaultTransferredAmount) || 0) + plan.transferred,
            vaultBlockedAmount: (Number(current.vaultBlockedAmount) || 0) + plan.blocked,
            dailyHouseProfit: (Number(current.dailyHouseProfit) || 0) + plan.mainWalletCut
        }
    };
}

/**
 * How a card purchase may draw on the two wallets.
 * Play balance is used first. A shortfall comes from the main wallet in
 * either switch position. While the switch is on, that main-wallet amount
 * enters Vault 1 and Vault 3. While it is off, the same amount is blocked
 * and does not enter those vaults.
 */
function cardStakeFromWallets(playBalance, mainBalance, betAmount, transferEnabled) {
    const bet = Number(betAmount) || 0;
    const play = Math.max(0, Number(playBalance) || 0);
    const main = Math.max(0, Number(mainBalance) || 0);
    const allowMain = transferEnabled !== false;
    const available = play + main;
    if (!(bet > 0) || available + 1e-9 < bet) {
        return { ok: false, allowMain: allowMain, blocked: false, playDeducted: 0, mainDeducted: 0 };
    }
    const playDeducted = Math.min(play, bet);
    const mainDeducted = Number((bet - playDeducted).toFixed(2));
    return {
        ok: true,
        allowMain: allowMain,
        blocked: !allowMain && mainDeducted > 0,
        playDeducted: playDeducted,
        mainDeducted: mainDeducted
    };
}

module.exports = {
    planDepositVaultTransfer: planDepositVaultTransfer,
    applyDepositVaultSplit: applyDepositVaultSplit,
    cardStakeFromWallets: cardStakeFromWallets
};
