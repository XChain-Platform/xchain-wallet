// Activity-feed grouping for the History route (§28.2).
//
// Collapses related entries into a single expandable card while leaving
// unrelated entries as plain rows. Operates on the already-filtered
// visible entry list — when a member's leader is not in the input the
// member renders ungrouped, so chain / cross-chain filters can never
// produce orphan cards.
//
// Recognised groupings:
//   - issue-mint:        ISSUE leader + every MINT of the same
//                        (chainId, tick, source).
//   - dispenser-dispense:DISPENSER leader + every DISPENSE that
//                        references it via dispenser_action_index.
//   - order-fills:       ORDER leader + every ORDER_MATCH / fill row
//                        that references it via order_action_index or
//                        the canonical tx0_index / tx1_index pair.
//
// BATCH grouping is intentionally skipped — XChain's BATCH parent
// reference is not exposed on history-row payloads we currently consume,
// so a heuristic would risk false collapses. Tracked in FOLLOWUPS.md
// under §28.

/**
 * @typedef {{
 *   key: string,
 *   chainId: string,
 *   address: string,
 *   actionIndex: string,
 *   action: string,
 *   blockIndex: number,
 *   timestamp: number,
 *   txHash: string,
 *   source: string,
 *   raw: any,
 *   link: any | null,
 * }} HistoryEntry
 */

/**
 * @typedef {{ kind: 'entry', entry: HistoryEntry }
 *         | { kind: 'group', subkind: 'issue-mint' | 'dispenser-dispense' | 'order-fills',
 *             leader: HistoryEntry, members: HistoryEntry[],
 *             summary: string, key: string }} GroupedItem
 */

/**
 * @param {HistoryEntry[]} entries  visible entries in DESC order
 * @param {'grouped' | 'flat'} [mode]
 * @returns {GroupedItem[]}
 */
export function groupHistoryEntries(entries, mode = 'grouped') {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    if (mode !== 'grouped') {
        return entries.map((e) => ({ kind: 'entry', entry: e }));
    }

    const issueLeaders = new Map();
    const dispenserLeaders = new Map();
    const orderLeaders = new Map();

    for (const e of entries) {
        const a = upper(e.action);
        if (a === 'ISSUE' || a === 'ISSUANCE') {
            const tick = upper(pickField(e.raw, ['tick', 'TICK', 'asset', 'ASSET']));
            if (!tick) continue;
            const src = pickField(e.raw, ['source', 'SOURCE']) || e.source || '';
            issueLeaders.set(`${e.chainId}|${tick}|${src}`, e);
        } else if (a === 'DISPENSER') {
            dispenserLeaders.set(`${e.chainId}|${e.actionIndex}`, e);
        } else if (a === 'ORDER') {
            orderLeaders.set(`${e.chainId}|${e.actionIndex}`, e);
        }
    }

    /** @type {Map<string, string>} entry.key -> groupKey */
    const memberGroup = new Map();
    /** @type {Map<string, { subkind: string, leader: HistoryEntry, members: HistoryEntry[] }>} */
    const groups = new Map();

    const ensureGroup = (groupKey, subkind, leader) => {
        let g = groups.get(groupKey);
        if (!g) {
            g = { subkind, leader, members: [] };
            groups.set(groupKey, g);
            memberGroup.set(leader.key, groupKey);
        }
        return g;
    };

    for (const e of entries) {
        const a = upper(e.action);
        if (a === 'MINT') {
            const tick = upper(pickField(e.raw, ['tick', 'TICK', 'asset', 'ASSET']));
            if (!tick) continue;
            const src = pickField(e.raw, ['source', 'SOURCE']) || e.source || '';
            const k = `${e.chainId}|${tick}|${src}`;
            const leader = issueLeaders.get(k);
            if (!leader) continue;
            const groupKey = `issue-mint:${k}`;
            const g = ensureGroup(groupKey, 'issue-mint', leader);
            g.members.push(e);
            memberGroup.set(e.key, groupKey);
        } else if (a === 'DISPENSE') {
            const parentIdx = pickField(e.raw, [
                'dispenser_action_index', 'DISPENSER_ACTION_INDEX',
                'dispenser_tx_index', 'DISPENSER_TX_INDEX',
                'dispenser_index', 'DISPENSER_INDEX',
            ]);
            if (parentIdx == null) continue;
            const parentKey = `${e.chainId}|${String(parentIdx)}`;
            const leader = dispenserLeaders.get(parentKey);
            if (!leader) continue;
            const groupKey = `dispenser-dispense:${parentKey}`;
            const g = ensureGroup(groupKey, 'dispenser-dispense', leader);
            g.members.push(e);
            memberGroup.set(e.key, groupKey);
        } else if (a === 'ORDER_MATCH' || a === 'ORDERFILL' || a === 'ORDER_FILL') {
            const parentIdx = pickField(e.raw, [
                'order_action_index', 'ORDER_ACTION_INDEX',
                'tx0_index', 'TX0_INDEX',
                'tx1_index', 'TX1_INDEX',
                'order_match_id', 'ORDER_MATCH_ID',
            ]);
            if (parentIdx == null) continue;
            const parentKey = `${e.chainId}|${String(parentIdx)}`;
            const leader = orderLeaders.get(parentKey);
            if (!leader) continue;
            const groupKey = `order-fills:${parentKey}`;
            const g = ensureGroup(groupKey, 'order-fills', leader);
            g.members.push(e);
            memberGroup.set(e.key, groupKey);
        }
    }

    /** @type {GroupedItem[]} */
    const out = [];
    const seen = new Set();
    for (const e of entries) {
        const groupKey = memberGroup.get(e.key);
        if (groupKey) {
            if (seen.has(groupKey)) continue;
            const g = groups.get(groupKey);
            if (!g || g.members.length === 0) {
                out.push({ kind: 'entry', entry: e });
                continue;
            }
            seen.add(groupKey);
            // Members were collected in DESC order; the leader (older
            // ISSUE / DISPENSER / ORDER) belongs at the bottom so the
            // expanded list reads newest-first like the rest of History.
            const members = [...g.members, g.leader];
            out.push({
                kind: 'group',
                subkind: /** @type {any} */ (g.subkind),
                leader: g.leader,
                members,
                summary: summarizeGroup(g.subkind, g.leader, g.members),
                key: groupKey,
            });
            continue;
        }
        out.push({ kind: 'entry', entry: e });
    }

    return out;
}

function pickField(raw, names) {
    if (!raw) return undefined;
    for (const n of names) {
        if (raw[n] != null && raw[n] !== '') return raw[n];
    }
    return undefined;
}

function upper(v) {
    return v == null ? '' : String(v).toUpperCase();
}

function summarizeGroup(subkind, leader, members) {
    if (subkind === 'issue-mint') {
        const tick = pickField(leader.raw, ['tick', 'TICK', 'asset', 'ASSET']) || '';
        const supply = totalAmount(members);
        return supply == null
            ? `Launched ${tick}`
            : `Launched ${tick} (supply ${supply})`;
    }
    if (subkind === 'dispenser-dispense') {
        const src = pickField(leader.raw, ['source', 'SOURCE']) || leader.source || '';
        const short = src.length > 12 ? `${src.slice(0, 6)}…${src.slice(-4)}` : src;
        const noun = members.length === 1 ? 'dispense' : 'dispenses';
        return `Dispenser at ${short} — ${members.length} ${noun}`;
    }
    if (subkind === 'order-fills') {
        const noun = members.length === 1 ? 'fill' : 'fills';
        return `Limit order — ${members.length} ${noun}`;
    }
    return '';
}

// Sum MINT amounts as BigInt when every value parses; fall back to null
// if any row is missing or non-integer so the summary degrades to the
// tick-only form rather than printing a wrong supply.
function totalAmount(members) {
    let total = 0n;
    for (const m of members) {
        const a = pickField(m.raw, ['amount', 'AMOUNT', 'quantity', 'QUANTITY']);
        if (a == null) return null;
        const s = String(a).trim();
        if (!/^-?\d+$/.test(s)) return null;
        try { total += BigInt(s); } catch { return null; }
    }
    return total.toString();
}
