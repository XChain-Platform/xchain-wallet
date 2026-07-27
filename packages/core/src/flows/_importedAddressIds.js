/**
 * Imported-WIF addresses carry `accountId: null` by design (§11.3.3): they
 * are scoped to the WALLET, through that wallet's `importedKeys` array, not
 * to any one account. Every site that selects "this wallet's addresses" by
 * walking the account link therefore drops them, which has now produced the
 * same defect five times (D-54, D-63, D-65 x2, D-66) in five different
 * files. This resolver is the one place that knows the rule.
 *
 * Scope note: the set is WALLET-wide even when the caller asked about a
 * single account. An imported key belongs to no account, so narrowing it by
 * accountId excludes it from every account-scoped query - which is exactly
 * how the first attempt at D-63 failed while its unit tests passed.
 *
 * Fails OPEN here (an unreadable wallet record yields an empty set) because
 * every caller uses it to WIDEN a selection: the worst case is the
 * pre-existing behaviour of not listing an imported address. Callers that
 * use it to authorize an action (activeAddress.js) must fail closed
 * themselves.
 *
 * @param {import('../storage/Vault.js').Vault} vault
 * @param {string} walletId
 * @returns {Promise<Set<string>>} address ids of this wallet's imported keys
 */
export async function importedAddressIdsFor(vault, walletId) {
    if (!vault?.wallets || typeof walletId !== 'string' || walletId.length === 0) {
        return new Set();
    }
    let wallet;
    try {
        wallet = await vault.wallets.get(walletId);
    } catch {
        return new Set();
    }
    const keys = Array.isArray(wallet?.importedKeys) ? wallet.importedKeys : [];
    return new Set(
        keys
            .map((k) => k?.addressId)
            .filter((id) => typeof id === 'string' && id.length > 0),
    );
}
