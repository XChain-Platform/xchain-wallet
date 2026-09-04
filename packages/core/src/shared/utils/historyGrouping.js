// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Activity-feed grouping for the History route (§28.2).
//
// Collapses related entries into a single expandable card while leaving
// unrelated entries as plain rows. Operates on the already-filtered
// visible entry list. When a member's leader is not in the input the
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
//   - link-pair:         §28.3 cross-chain LINK pairing. Both sides
//                        of the same LINK action collapse into a
//                        single dual-chain card. Leader = the entry
//                        that appears first (newest) in the visible
//                        feed, members = the peer side(s).
//   - batch:             BATCH leader + every sub-action that names it
//                        via parent_batch_action_index.
//
// The batch reference is authoritative, not a heuristic. The indexer
// stores no parent column (every sub-command is its own root action);
// xchain-explorer derives parenthood in getHistoryData and publishes it
// as `parent_batch_action_index` on each row, NULL on the BATCH envelope
// itself and on every row that is not batched. Grouping on a shared txid
// instead (the only option before that field existed, which is why this
// rule waited) would have merged unrelated rows that share nothing but a
// transaction envelope.
//
// Batch containment is EXCLUSIVE and resolved first: a row inside a
// batch cannot also be claimed by issue-mint / dispenser-dispense /
// order-fills / link-pair, because a row that renders inside two cards
// renders twice. The batch envelope is the outer container, so it wins.

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
 *         | { kind: 'group', subkind: 'issue-mint' | 'dispenser-dispense' | 'order-fills' | 'link-pair' | 'batch',
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
    /** @type {Map<string, HistoryEntry>} BATCH envelopes by `chainId|actionIndex`. */
    const batchLeaders = new Map();
    /**
     * Cross-chain LINK pair tracker: the OLDEST entry seen for a given
     * linkActionIndex becomes the pair's leader, mirroring the
     * issue-mint convention (leader at the bottom of the expanded
     * list). The first iteration is DESC so we keep overwriting until
     * the oldest entry is the final value retained.
     * @type {Map<string, HistoryEntry>}
     */
    const linkPairLeaders = new Map();

    for (const e of entries) {
        const a = upper(e.action);
        if (a === 'ISSUE' || a === 'ISSUANCE') {
            const tick = upper(pickField(e.raw, ['tick', 'TICK', 'tick', 'ASSET']));
            if (!tick) continue;
            const src = pickField(e.raw, ['source', 'SOURCE']) || e.source || '';
            issueLeaders.set(`${e.chainId}|${tick}|${src}`, e);
        } else if (a === 'DISPENSER') {
            dispenserLeaders.set(`${e.chainId}|${e.actionIndex}`, e);
        } else if (a === 'ORDER') {
            orderLeaders.set(`${e.chainId}|${e.actionIndex}`, e);
        } else if (a === 'BATCH') {
            batchLeaders.set(`${e.chainId}|${e.actionIndex}`, e);
        }
        const lai = e.link?.linkActionIndex;
        if (lai) {
            // Keep overwriting; the loop runs DESC (newest first) so
            // the final value retained is the oldest entry, which we
            // want as the leader so the group renders at the older
            // member's slot and the expanded list reads newest-first.
            linkPairLeaders.set(lai, e);
        }
    }

    /** @type {Map<string, string>} entry.key -> groupKey */
    const memberGroup = new Map();
    /** @type {Map<string, { subkind: string, leader: HistoryEntry, members: HistoryEntry[] }>} */
    const groups = new Map();

    /**
     * Returns null when the would-be leader is already claimed by
     * another card (it sits inside a BATCH envelope, or it is already
     * a member of a pair). Stealing it would leave it in two members
     * lists and render the row twice; the caller falls back to flat
     * rows for the children instead.
     */
    const ensureGroup = (groupKey, subkind, leader) => {
        let g = groups.get(groupKey);
        if (!g) {
            if (memberGroup.has(leader.key)) return null;
            g = { subkind, leader, members: [] };
            groups.set(groupKey, g);
            memberGroup.set(leader.key, groupKey);
        }
        return g;
    };

    // Batch containment first, so a sub-action is claimed by its
    // envelope before any other rule can take it (see header note).
    for (const e of entries) {
        const parentIdx = pickField(e.raw, [
            'parent_batch_action_index', 'PARENT_BATCH_ACTION_INDEX',
            'parentBatchActionIndex',
        ]);
        if (parentIdx == null) continue;
        const parentKey = `${e.chainId}|${String(parentIdx)}`;
        const leader = batchLeaders.get(parentKey);
        // A parent outside the visible window (filtered out, or on the
        // previous page) leaves its children as plain rows, the same
        // orphan-free contract the other subkinds keep.
        if (!leader || leader.key === e.key) continue;
        const groupKey = `batch:${parentKey}`;
        const g = ensureGroup(groupKey, 'batch', leader);
        if (!g) continue;
        g.members.push(e);
        memberGroup.set(e.key, groupKey);
    }

    for (const e of entries) {
        // Already inside a batch card: no second claim.
        if (String(memberGroup.get(e.key) || '').startsWith('batch:')) continue;
        const a = upper(e.action);
        if (a === 'MINT') {
            const tick = upper(pickField(e.raw, ['tick', 'TICK', 'tick', 'ASSET']));
            if (!tick) continue;
            const src = pickField(e.raw, ['source', 'SOURCE']) || e.source || '';
            const k = `${e.chainId}|${tick}|${src}`;
            const leader = issueLeaders.get(k);
            if (!leader) continue;
            const groupKey = `issue-mint:${k}`;
            const g = ensureGroup(groupKey, 'issue-mint', leader);
            if (!g) continue;
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
            if (!g) continue;
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
            if (!g) continue;
            g.members.push(e);
            memberGroup.set(e.key, groupKey);
        }

        // §28.3 link-pair grouping. A row whose linkActionIndex matches
        // an earlier entry in the visible window is a peer side of the
        // LINK; collapse under the leader. The leader's own row stays
        // out of the members list. `ensureGroup` registers it once via
        // memberGroup, and the dispatch loop further down emits the
        // group at the leader's position.
        const lai = e.link?.linkActionIndex;
        if (lai) {
            const leader = linkPairLeaders.get(lai);
            if (leader && leader.key !== e.key) {
                const groupKey = `link-pair:${lai}`;
                const g = ensureGroup(groupKey, 'link-pair', leader);
                if (g) {
                    g.members.push(e);
                    memberGroup.set(e.key, groupKey);
                }
            }
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
            // Suppress single-child groups for leader-plus-children
            // subkinds. "Limit order: 1 fill" would expand to show
            // just the ORDER + its single ORDER_MATCH, which is the
            // same information as letting them render as two flat
            // rows but with an extra click. link-pair stays at >=1
            // because the pair itself is the unit of meaning.
            const minMembers = g && g.subkind === 'link-pair' ? 1 : 2;
            if (!g || g.members.length < minMembers) {
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
        const tick = pickField(leader.raw, ['tick', 'TICK', 'tick', 'ASSET']) || '';
        const supply = totalAmount(members);
        return supply == null
            ? `Launched ${tick}`
            : `Launched ${tick} (supply ${supply})`;
    }
    if (subkind === 'dispenser-dispense') {
        const src = pickField(leader.raw, ['source', 'SOURCE']) || leader.source || '';
        const short = src.length > 12 ? `${src.slice(0, 6)}…${src.slice(-4)}` : src;
        const noun = members.length === 1 ? 'dispense' : 'dispenses';
        return `Dispenser at ${short}: ${members.length} ${noun}`;
    }
    if (subkind === 'order-fills') {
        const noun = members.length === 1 ? 'fill' : 'fills';
        return `Limit order: ${members.length} ${noun}`;
    }
    if (subkind === 'batch') {
        // Count the sub-actions, not the envelope: "Batch: 3 actions"
        // is the number of things that happened, and the BATCH row
        // itself is only the wrapper they arrived in.
        const noun = members.length === 1 ? 'action' : 'actions';
        return `Batch: ${members.length} ${noun}`;
    }
    if (subkind === 'link-pair') {
        // Leader is the older side; members[0] is the newer (peer that
        // completed the pair). `${peer} ↔ ${leader}` reads in the
        // user's reading direction: newer (top) ↔ older (bottom).
        const leaderAction = upper(leader.action) || 'LINK';
        const peer = members[0];
        const peerAction = peer ? (upper(peer.action) || 'LINK') : '';
        return peerAction
            ? `Cross-chain link: ${peerAction} ↔ ${leaderAction}`
            : `Cross-chain link: ${leaderAction}`;
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
