// Fetch every token whose issuer (`owner_id` in the indexer) is the
// supplied address. Wraps xchain-sdk's `getTokens(address, 'address')`,
// which hits the explorer's `/{COIN}/api/tokens/{ADDRESS}/address`
// endpoint — backed by `WHERE m.owner_id = ?` in xchain-explorer.
//
// One address at a time. The renderer fans out across the wallet's
// addresses for a given chain and aggregates the results.

/**
 * @typedef {Object} OwnedTokenHit
 * @property {string} tick                       canonical ticker (uppercase)
 * @property {string | null} totalSupply         circulating supply as a string, or null
 * @property {string | null} maxSupply           cap as a string, or null
 * @property {string | null} description         indexer-stored description, or null
 * @property {boolean} locked                    supply locked
 * @property {number | null} divisibility        divisibility (0-8), or null
 * @property {boolean} youOwn                    issuer still holds non-zero balance of this tick
 * @property {boolean} hasOpenDispenser          at least one open dispenser sells this tick from this address
 */

/**
 * @param {Object} params
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} params.sdkRegistry
 * @param {string} params.chainId
 * @param {string} params.address                 owner address to query for
 * @param {number} [params.limit]                cap (clamped to [1, 500]); defaults to 200
 * @returns {Promise<OwnedTokenHit[]>}
 */
export async function listOwnedTokens({ sdkRegistry, chainId, address, limit = 200 }) {
    if (!sdkRegistry) throw new Error('listOwnedTokens: sdkRegistry is required');
    if (!chainId) throw new Error('listOwnedTokens: chainId is required');
    if (typeof address !== 'string' || address.trim().length === 0) return [];
    const cappedLimit = Math.max(1, Math.min(500, Number(limit) || 200));
    const sdk = sdkRegistry.get(chainId);
    if (typeof sdk.getTokens !== 'function') return [];
    const trimmed = address.trim();
    const tokensRaw = await sdk.getTokens(trimmed, 'address', { limit: cappedLimit }).catch(() => []);
    const tokenRowsRaw = Array.isArray(tokensRaw)
        ? tokensRaw
        : (Array.isArray(tokensRaw?.data) ? tokensRaw.data : []);

    // If the SDK has already enriched each token row with `youOwn` and
    // `hasOpenDispenser` (the dev-mock SDK does this), skip the
    // balance + dispenser fan-out — those calls only exist to derive
    // those two flags from the real explorer.
    const needsEnrichment = tokenRowsRaw.some(
        (r) => r && (r.youOwn === undefined || r.hasOpenDispenser === undefined),
    );
    const [balancesRaw, dispensersRaw] = needsEnrichment
        ? await Promise.all([
            typeof sdk.getBalances === 'function'
                ? sdk.getBalances(trimmed).catch(() => null)
                : Promise.resolve(null),
            typeof sdk.getDispensers === 'function'
                ? sdk.getDispensers(trimmed, 'address').catch(() => [])
                : Promise.resolve([]),
        ])
        : [null, []];

    // Build a "ticks the address still holds" set from balances. The
    // explorer's balance endpoint emits one row per (address, tick); a
    // row with a positive amount means the address still controls some
    // of that tick. If we can't read balances we leave `youOwn`
    // undefined — the UI treats that as "unknown, don't hide".
    const heldTicks = balancesRaw === null ? null : new Set();
    if (heldTicks) {
        // Accept either the explorer's flat array (real SDK) or the
        // wallet's `{ native, tokens: [...] }` shape (dev-mock SDK and
        // some intra-wallet adapters).
        const rows = Array.isArray(balancesRaw)
            ? balancesRaw
            : (Array.isArray(balancesRaw?.data)
                ? balancesRaw.data
                : (Array.isArray(balancesRaw?.tokens) ? balancesRaw.tokens : []));
        for (const r of rows) {
            const tick = typeof r?.tick === 'string' ? r.tick.toUpperCase() : null;
            const qty = r?.quantity ?? r?.amount ?? r?.balance ?? null;
            if (!tick) continue;
            if (qty != null && String(qty) !== '0' && Number(qty) > 0) {
                heldTicks.add(tick);
            }
        }
    }

    // Build a "ticks with at least one open dispenser" set from
    // dispensers fetched for this source address.
    const listedTicks = new Set();
    const dRows = Array.isArray(dispensersRaw)
        ? dispensersRaw
        : (Array.isArray(dispensersRaw?.data) ? dispensersRaw.data : []);
    for (const d of dRows) {
        const tick = typeof d?.tick === 'string'
            ? d.tick.toUpperCase()
            : (typeof d?.asset === 'string' ? d.asset.toUpperCase() : null);
        const open = d?.status === undefined ? true : (Number(d.status) === 0);
        if (tick && open) listedTicks.add(tick);
    }

    const out = /** @type {OwnedTokenHit[]} */ ([]);
    for (const raw of tokenRowsRaw) {
        const row = normalizeTokenRow(raw);
        if (!row || !row.tick) continue;
        const tick = row.tick.toUpperCase();
        out.push({
            tick,
            totalSupply: row.supply,
            maxSupply: row.maxSupply,
            description: row.description,
            locked: row.locked,
            divisibility: row.divisibility,
            youOwn: typeof raw.youOwn === 'boolean'
                ? raw.youOwn
                : (heldTicks === null ? true : heldTicks.has(tick)),
            hasOpenDispenser: typeof raw.hasOpenDispenser === 'boolean'
                ? raw.hasOpenDispenser
                : listedTicks.has(tick),
        });
    }
    return out;
}

// The /tokens/{address}/address endpoint returns rows as either a
// keyed object (dev mock + future explorer revisions) or a positional
// array (current xchain-explorer XChainExplorer.js line 817 collapses
// the row to `[count_reverse, block_index, timestamp, tick, supply,
// max_supply, max_mint, locks, id]` to shrink the wire payload). We
// accept both shapes and produce a stable internal object. Exported
// so tests can hit the array / keyed paths without spinning the SDK.
export function normalizeTokenRow(raw) {
    if (!raw) return null;
    if (Array.isArray(raw)) {
        // Positional shape: [count, block, ts, tick, supply, max_supply, max_mint, locks, id]
        const tick = typeof raw[3] === 'string' ? raw[3] : null;
        if (!tick) return null;
        // `locks` is a pipe-joined string of 7 boolean-flags in this
        // order: lock_max_supply, lock_mint, lock_mint_supply,
        // lock_max_mint, lock_description, lock_sleep, lock_callback.
        // Any of the first three being truthy makes the token "locked"
        // in the wallet's sense (no further mint possible).
        let locked = false;
        if (typeof raw[7] === 'string') {
            const flags = raw[7].split('|');
            locked = flags[0] === '1' || flags[1] === '1' || flags[2] === '1';
        }
        return {
            tick,
            supply: raw[4] != null ? String(raw[4]) : null,
            maxSupply: raw[5] != null ? String(raw[5]) : null,
            description: null, // not exposed by the tokens-list endpoint
            locked,
            divisibility: null, // bcformat is server-side; explorer strips decimals
        };
    }
    // Keyed shape — accept both `divisibility` and the legacy `decimals`
    // alias since the explorer's row name is `m.decimals` even when
    // exposed as a raw field.
    const tick = typeof raw.tick === 'string' ? raw.tick : null;
    if (!tick) return null;
    const divRaw = raw.divisibility ?? raw.decimals ?? null;
    // Lock columns can appear individually (raw indexer row) or as a
    // pipe-string (post-XChainExplorer collapse). Cover both.
    let locked = !!(raw.locked || raw.lock || raw.is_locked);
    if (!locked) {
        if (raw.lock_max_supply === 1 || raw.lock_max_supply === '1') locked = true;
        else if (raw.lock_mint === 1 || raw.lock_mint === '1') locked = true;
        else if (raw.lock_mint_supply === 1 || raw.lock_mint_supply === '1') locked = true;
        else if (typeof raw.locks === 'string') {
            const flags = raw.locks.split('|');
            locked = flags[0] === '1' || flags[1] === '1' || flags[2] === '1';
        }
    }
    return {
        tick,
        supply: raw.supply != null ? String(raw.supply) : null,
        maxSupply: raw.max_supply != null ? String(raw.max_supply) : null,
        description: typeof raw.description === 'string' ? raw.description : null,
        locked,
        divisibility: (divRaw != null && Number.isFinite(Number(divRaw))) ? Number(divRaw) : null,
    };
}
