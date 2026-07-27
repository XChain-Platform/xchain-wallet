// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// activeAddress (§11.3.2). The single active (operating) address per chain
// for an account: the one Home shows the balance for and that actions (Send)
// run against. The override lives on `account.activeAddressByChainId` (a
// sparse chainId -> addressId map). Absence means "use the default" = the
// lowest-index HD receive address for that chain, so a fresh wallet's first
// address is active with no stored state, and a deleted override falls back
// to the default automatically.

/**
 * Default active address for a chain group: the lowest-index HD receive
 * address (external branch change=0, not a dispenser). Imported / watch-only
 * / hardware addresses with no external-branch path are skipped.
 *
 * @param {import('../schemas/address.js').Address[]} addresses
 * @returns {import('../schemas/address.js').Address | null}
 */
function defaultActiveFor(addresses) {
    let best = null;
    let bestIndex = Infinity;
    for (const a of addresses) {
        if (a.source !== 'hd') continue;
        if (a.role === 'dispenser') continue;
        if (typeof a.derivationPath !== 'string') continue;
        const parts = a.derivationPath.split('/');
        if (parts.length < 2) continue;
        if (parts[parts.length - 2] !== '0') continue;
        const idx = Number(parts[parts.length - 1]);
        if (!Number.isFinite(idx)) continue;
        if (idx < bestIndex) { bestIndex = idx; best = a; }
    }
    return best;
}

/**
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} [walletId]
 * @param {string} [accountId]
 * @returns {Promise<import('../schemas/account.js').Account | null>}
 */
async function resolveAccount(vault, walletId, accountId) {
    if (typeof accountId === 'string' && accountId.length > 0) {
        const a = await vault.accounts.get(accountId);
        if (a) return a;
    }
    if (typeof walletId === 'string' && walletId.length > 0) {
        const list = await vault.accounts.findBy('walletId', walletId);
        return list[0] || null;
    }
    return null;
}

/**
 * Resolve the active address per chain for one account: the stored override
 * when it still points at a live address, otherwise the default.
 *
 * @param {Object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} [opts.walletId]
 * @param {string} [opts.accountId]
 * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
 * @returns {Promise<Record<string, { id: string, address: string }>>}  chainId -> active address
 */
export async function resolveActiveAddresses({ vault, walletId, accountId, chainRegistry }) {
    if (!vault) throw new Error('resolveActiveAddresses: vault is required');
    if (!chainRegistry) throw new Error('resolveActiveAddresses: chainRegistry is required');

    const account = await resolveAccount(vault, walletId, accountId);
    const overrides = (account && account.activeAddressByChainId) || {};
    const accId = account?.id;

    // Imported-WIF addresses are wallet-scoped (accountId=null), so the
    // account filter below skips them. They must still be resolvable as
    // an OVERRIDE - otherwise "Use" writes an active address that this
    // function can never find, and the UI silently keeps the old one -
    // but they stay out of the default pool: an imported key becomes the
    // active address only when the user picks it.
    /** @type {Set<string>} */
    let importedIds = new Set();
    if (account?.walletId) {
        try {
            const wallet = await vault.wallets?.get(account.walletId);
            const keys = Array.isArray(wallet?.importedKeys) ? wallet.importedKeys : [];
            importedIds = new Set(
                keys.map((k) => k?.addressId).filter((id) => typeof id === 'string' && id.length > 0),
            );
        } catch { /* no wallet record readable: overrides stay account-only */ }
    }

    // Group this account's addresses by chainId.
    const all = await vault.addresses.list();
    /** @type {Map<string, import('../schemas/address.js').Address[]>} */
    const byChain = new Map();
    /** @type {Map<string, import('../schemas/address.js').Address>} */
    const importedById = new Map();
    for (const a of all) {
        const chainId = chainRegistry.chainIdFor(a.chain, a.network);
        if (!chainId) continue;
        if (a.accountId == null && importedIds.has(a.id)) {
            importedById.set(a.id, a);
            if (!byChain.has(chainId)) byChain.set(chainId, []);
            continue;
        }
        if (accId && a.accountId !== accId) continue;
        if (!byChain.has(chainId)) byChain.set(chainId, []);
        byChain.get(chainId).push(a);
    }

    /** @type {Record<string, { id: string, address: string }>} */
    const out = {};
    for (const [chainId, addrs] of byChain) {
        let chosen = null;
        const overrideId = overrides[chainId];
        if (overrideId) {
            chosen = addrs.find((a) => a.id === overrideId)
                || importedById.get(overrideId)
                || null;
        }
        if (!chosen) chosen = defaultActiveFor(addrs);
        if (chosen) out[chainId] = { id: chosen.id, address: chosen.address };
    }
    return out;
}

/**
 * An imported-WIF address carries accountId=null by design (§11.3.3):
 * it is scoped to the WALLET, through that wallet's `importedKeys`, not
 * to any one account. "Belongs to this account" therefore has to mean
 * "belongs to this account's wallet" for those addresses. Without this,
 * an imported key can never be made active - and since Send spends the
 * ACTIVE address and offers no source picker, it could never be spent.
 * Fails closed: an unreadable wallet record denies the activation.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {{ walletId?: string }} account
 * @param {{ id: string, accountId: string | null }} addr
 * @returns {Promise<boolean>}
 */
async function isImportedKeyOfAccount(vault, account, addr) {
    if (addr.accountId != null) return false;
    if (!account?.walletId) return false;
    try {
        const wallet = await vault.wallets.get(account.walletId);
        const keys = Array.isArray(wallet?.importedKeys) ? wallet.importedKeys : [];
        return keys.some((k) => k?.addressId === addr.id);
    } catch {
        return false;
    }
}

/**
 * Set the active address for one (account, chain). Validates the address
 * exists and belongs to the account; writes the override on the account.
 *
 * @param {Object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.accountId
 * @param {string} opts.chainId
 * @param {string} opts.addressId
 * @returns {Promise<{ ok: true }>}
 */
export async function setActiveAddress({ vault, accountId, chainId, addressId }) {
    if (!vault) throw new Error('setActiveAddress: vault is required');
    if (typeof accountId !== 'string' || !accountId) throw new Error('setActiveAddress: accountId is required');
    if (typeof chainId !== 'string' || !chainId) throw new Error('setActiveAddress: chainId is required');
    if (typeof addressId !== 'string' || !addressId) throw new Error('setActiveAddress: addressId is required');

    const account = await vault.accounts.get(accountId);
    if (!account) throw new Error(`setActiveAddress: account "${accountId}" not found`);
    const addr = await vault.addresses.get(addressId);
    if (!addr) throw new Error(`setActiveAddress: address "${addressId}" not found`);
    if (addr.accountId !== accountId && !(await isImportedKeyOfAccount(vault, account, addr))) {
        throw new Error('setActiveAddress: address does not belong to this account');
    }

    const map = { ...(account.activeAddressByChainId || {}), [chainId]: addressId };
    await vault.accounts.put({ ...account, activeAddressByChainId: map });
    return { ok: true };
}
