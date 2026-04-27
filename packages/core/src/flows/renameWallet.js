// renameWallet — change the `name` field on a Wallet record. Pure
// vault metadata update; no signer needed.

import { WalletNotFoundError } from './unlockWallet.js';

/**
 * @param {object} opts
 * @param {string} opts.walletId
 * @param {string} opts.name
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @returns {Promise<import('../schemas/wallet.js').Wallet>}
 */
export async function renameWallet({ walletId, name, vault }) {
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('renameWallet: walletId is required');
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('renameWallet: name must be a non-empty string');
    }
    if (!vault) throw new Error('renameWallet: vault is required');

    const wallet = await vault.wallets.get(walletId);
    if (!wallet) throw new WalletNotFoundError(walletId);

    const updated = { ...wallet, name: name.trim() };
    await vault.wallets.put(updated);
    return updated;
}
