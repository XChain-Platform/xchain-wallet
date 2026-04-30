// recipientsByAction — Cluster O FOLLOWUP 2 (DIVIDEND / AIRDROP recipient
// lists for §31.4 save-as-contact in History).
//
// Both action kinds carry a recipient set that's *derived*, not on-row:
//
//   - DIVIDEND distributes a payout to every holder of TICK at the
//     snapshot block. The row payload carries TICK + DIVIDEND_TICK +
//     AMOUNT, but not the recipient list — that's the holders table at
//     the snapshot block. We fetch via `sdk.getHolders(tick)`. Note:
//     the holders set is a *current* snapshot; for very old DIVIDEND
//     rows, holders may have shifted. The UI surfaces this as a hint
//     so the user understands the list isn't a frozen historical view.
//
//   - AIRDROP distributes to addresses in a referenced LIST. The row
//     payload carries LIST_ACTION_INDEX. We fetch the LIST action via
//     `sdk.getAction(idx)` and read its TYPE=2 (ADDRESS) ITEM array.
//     Older multi-airdrop variants (v1/v2/v3) reference multiple lists
//     — out of scope for this FOLLOWUP; the v0 path is the common
//     authored shape.
//
// Both flows accept optional pre-resolved fields (`tick`, `listAction-
// Index`) so callers that already have them on the History row don't
// pay an extra `getAction` round-trip.

/**
 * @typedef {Object} Recipient
 * @property {string} address
 * @property {string} [balance]   DIVIDEND only: holder's balance at
 *                                snapshot (often a string from the SDK)
 */

/**
 * @param {{ sdkRegistry: any, chainId: string, actionIndex?: string, tick?: string }} args
 * @returns {Promise<{ recipients: Recipient[], tick: string, source?: string | null, snapshotNote: string }>}
 */
export async function getDividendRecipients(args) {
    const { sdkRegistry, chainId } = args || {};
    if (!sdkRegistry) throw new Error('getDividendRecipients: sdkRegistry is required');
    if (!chainId) throw new Error('getDividendRecipients: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    if (!sdk) throw new Error(`getDividendRecipients: SDK not registered for ${chainId}`);

    let tick = typeof args.tick === 'string' && args.tick.length > 0 ? args.tick : null;
    let source = null;
    if (!tick) {
        if (typeof args.actionIndex !== 'string' || args.actionIndex.length === 0) {
            throw new Error(
                'getDividendRecipients: either tick or actionIndex is required',
            );
        }
        const action = await sdk.getAction(args.actionIndex);
        const params = action?.params || action || {};
        tick = String(params.TICK || params.tick || '').trim() || null;
        source = String(params.SOURCE || params.source || '').trim() || null;
        if (!tick) {
            throw new Error(
                `getDividendRecipients: action ${args.actionIndex} has no TICK field`,
            );
        }
    }

    const holdersResp = await sdk.getHolders(tick);
    const rawList = Array.isArray(holdersResp)
        ? holdersResp
        : Array.isArray(holdersResp?.holders)
            ? holdersResp.holders
            : Array.isArray(holdersResp?.rows)
                ? holdersResp.rows
                : [];
    /** @type {Recipient[]} */
    const recipients = [];
    const seen = new Set();
    for (const h of rawList) {
        if (!h || typeof h !== 'object') continue;
        const address = String(h.address || h.ADDRESS || '').trim();
        if (!address) continue;
        if (source && address === source) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        const balance = h.balance !== undefined
            ? String(h.balance)
            : h.BALANCE !== undefined
                ? String(h.BALANCE)
                : h.amount !== undefined
                    ? String(h.amount)
                    : undefined;
        recipients.push(balance !== undefined ? { address, balance } : { address });
    }

    return {
        recipients,
        tick,
        source,
        snapshotNote: 'Holders shown reflect current state; the actual snapshot at indexing may differ for older DIVIDENDs.',
    };
}

/**
 * @param {{ sdkRegistry: any, chainId: string, actionIndex?: string, listActionIndex?: string }} args
 * @returns {Promise<{ recipients: Recipient[], listActionIndex: string, listType: string | null }>}
 */
export async function getAirdropRecipients(args) {
    const { sdkRegistry, chainId } = args || {};
    if (!sdkRegistry) throw new Error('getAirdropRecipients: sdkRegistry is required');
    if (!chainId) throw new Error('getAirdropRecipients: chainId is required');
    const sdk = sdkRegistry.get(chainId);
    if (!sdk) throw new Error(`getAirdropRecipients: SDK not registered for ${chainId}`);

    let listActionIndex = typeof args.listActionIndex === 'string' && args.listActionIndex.length > 0
        ? args.listActionIndex
        : null;
    if (!listActionIndex) {
        if (typeof args.actionIndex !== 'string' || args.actionIndex.length === 0) {
            throw new Error(
                'getAirdropRecipients: either listActionIndex or actionIndex is required',
            );
        }
        const action = await sdk.getAction(args.actionIndex);
        const params = action?.params || action || {};
        listActionIndex = String(
            params.LIST_ACTION_INDEX || params.list_action_index || '',
        ).trim() || null;
        if (!listActionIndex) {
            throw new Error(
                `getAirdropRecipients: action ${args.actionIndex} has no LIST_ACTION_INDEX field`,
            );
        }
    }

    const list = await sdk.getAction(listActionIndex);
    const params = list?.params || list || {};
    const items = params.ITEM ?? params.item ?? params.ITEMS ?? params.items;
    const arr = Array.isArray(items) ? items : items != null ? [items] : [];
    const listType = params.TYPE != null ? String(params.TYPE) : params.type != null ? String(params.type) : null;

    /** @type {Recipient[]} */
    const recipients = [];
    const seen = new Set();
    for (const it of arr) {
        let address = null;
        if (typeof it === 'string') address = it.trim();
        else if (it && typeof it === 'object') {
            address = String(it.address || it.ADDRESS || '').trim();
        }
        if (!address) continue;
        if (seen.has(address)) continue;
        seen.add(address);
        recipients.push({ address });
    }

    return { recipients, listActionIndex, listType };
}
