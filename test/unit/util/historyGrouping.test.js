// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit tests for the §28.2 activity-feed grouping utility.

import { describe, it, expect } from 'vitest';
import { groupHistoryEntries } from '../../../packages/core/src/shared/utils/historyGrouping.js';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';

function entry(over) {
    return {
        key: over.key || `${over.chainId}:${over.actionIndex}:${over.address || 'addr1'}`,
        chainId: over.chainId,
        address: over.address || 'addr1',
        actionIndex: String(over.actionIndex),
        action: over.action,
        blockIndex: over.blockIndex ?? 0,
        timestamp: over.timestamp ?? 0,
        txHash: over.txHash || '',
        source: over.source || '',
        raw: over.raw || {},
        link: over.link || null,
    };
}

describe('shared/utils/historyGrouping', () => {
    it('returns flat passthrough in flat mode', () => {
        const entries = [
            entry({ chainId: BTC, actionIndex: 1, action: 'SEND' }),
            entry({ chainId: BTC, actionIndex: 2, action: 'ISSUE' }),
        ];
        const out = groupHistoryEntries(entries, 'flat');
        expect(out).toHaveLength(2);
        expect(out.every((it) => it.kind === 'entry')).toBe(true);
        expect(out.map((it) => it.entry.actionIndex)).toEqual(['1', '2']);
    });

    it('returns empty list for empty input', () => {
        expect(groupHistoryEntries([], 'grouped')).toEqual([]);
        expect(groupHistoryEntries(null, 'grouped')).toEqual([]);
    });

    it('does not group an ISSUE without any MINT companions', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 10, action: 'ISSUE',
                source: 'src1', raw: { tick: 'MYTOKEN', source: 'src1' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('entry');
    });

    it('collapses ISSUE + MINTs of the same tick + source into one card', () => {
        // DESC order: newer entries first, ISSUE oldest.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 30, action: 'MINT', blockIndex: 300,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '500' },
            }),
            entry({
                chainId: BTC, actionIndex: 20, action: 'MINT', blockIndex: 200,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '300' },
            }),
            entry({
                chainId: BTC, actionIndex: 10, action: 'ISSUE', blockIndex: 100,
                source: 'src1', raw: { tick: 'MYTOKEN', source: 'src1' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('group');
        expect(out[0].subkind).toBe('issue-mint');
        expect(out[0].summary).toBe('Launched MYTOKEN (supply 800)');
        expect(out[0].members.map((m) => m.actionIndex)).toEqual(['30', '20', '10']);
    });

    it('does not group MINTs whose source differs from the ISSUE', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 20, action: 'MINT', blockIndex: 200,
                raw: { tick: 'MYTOKEN', source: 'src2', amount: '300' },
            }),
            entry({
                chainId: BTC, actionIndex: 10, action: 'ISSUE', blockIndex: 100,
                source: 'src1', raw: { tick: 'MYTOKEN', source: 'src1' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(2);
        expect(out.every((it) => it.kind === 'entry')).toBe(true);
    });

    it('does not group MINT under an ISSUE on a different chain', () => {
        const entries = [
            entry({
                chainId: LTC, actionIndex: 21, action: 'MINT', blockIndex: 201,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '100' },
            }),
            entry({
                chainId: BTC, actionIndex: 10, action: 'ISSUE', blockIndex: 100,
                source: 'src1', raw: { tick: 'MYTOKEN', source: 'src1' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(2);
        expect(out.every((it) => it.kind === 'entry')).toBe(true);
    });

    it('falls back to tick-only summary when a MINT amount is missing', () => {
        // Two MINTs (one with a missing amount) so the group passes the
        // minMembers threshold but the supply rollup degrades to the
        // tick-only form per totalAmount()'s null-on-missing contract.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 21, action: 'MINT', blockIndex: 210,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '100' },
            }),
            entry({
                chainId: BTC, actionIndex: 20, action: 'MINT', blockIndex: 200,
                raw: { tick: 'MYTOKEN', source: 'src1' /* no amount */ },
            }),
            entry({
                chainId: BTC, actionIndex: 10, action: 'ISSUE', blockIndex: 100,
                source: 'src1', raw: { tick: 'MYTOKEN', source: 'src1' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('group');
        expect(out[0].summary).toBe('Launched MYTOKEN');
    });

    it('collapses DISPENSER + DISPENSEs that reference its action_index', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 42, action: 'DISPENSE', blockIndex: 410,
                raw: { dispenser_action_index: 7 },
            }),
            entry({
                chainId: BTC, actionIndex: 41, action: 'DISPENSE', blockIndex: 405,
                raw: { dispenser_action_index: 7 },
            }),
            entry({
                chainId: BTC, actionIndex: 7, action: 'DISPENSER', blockIndex: 100,
                source: 'bc1qabcdefghijklmnopqrxyz', raw: { source: 'bc1qabcdefghijklmnopqrxyz' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('group');
        expect(out[0].subkind).toBe('dispenser-dispense');
        expect(out[0].summary).toMatch(/Dispenser at bc1qab…rxyz: 2 dispenses/);
    });

    it('does not group a DISPENSE whose dispenser is filtered out', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 42, action: 'DISPENSE',
                raw: { dispenser_action_index: 99 },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('entry');
    });

    it('collapses ORDER + ORDER_MATCH fills via order_action_index', () => {
        // Two ORDER_MATCH fills referencing the leader via
        // order_action_index; single-fill groups are intentionally
        // suppressed (impl historyGrouping.js:188) since collapsing
        // ORDER + one MATCH would only add an extra click.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 61, action: 'ORDER_MATCH', blockIndex: 510,
                raw: { order_action_index: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 60, action: 'ORDER_MATCH', blockIndex: 500,
                raw: { order_action_index: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 5, action: 'ORDER', blockIndex: 100,
                raw: {},
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('group');
        expect(out[0].subkind).toBe('order-fills');
        expect(out[0].summary).toBe('Limit order: 2 fills');
    });

    it('collapses ORDER fills via the canonical tx0_index reference', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 61, action: 'ORDER_MATCH',
                raw: { tx0_index: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 60, action: 'ORDER_MATCH',
                raw: { tx1_index: 5 },
            }),
            entry({ chainId: BTC, actionIndex: 5, action: 'ORDER', raw: {} }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('group');
        expect(out[0].summary).toBe('Limit order: 2 fills');
    });

    it('emits a group at the position of its newest member so recent activity stays on top', () => {
        // Two MINTs + an unrelated SEND between them and the ISSUE
        // leader. The group needs ≥2 MINTs to render (impl:188), and
        // when it does it bubbles to the newest member (MINT-30) so the
        // History feed keeps its "newest first" reading order; the
        // unrelated SEND-25 follows.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 30, action: 'MINT', blockIndex: 300,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '100' },
            }),
            entry({ chainId: BTC, actionIndex: 25, action: 'SEND', blockIndex: 250 }),
            entry({
                chainId: BTC, actionIndex: 20, action: 'MINT', blockIndex: 200,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '50' },
            }),
            entry({
                chainId: BTC, actionIndex: 10, action: 'ISSUE', blockIndex: 100,
                source: 'src1', raw: { tick: 'MYTOKEN', source: 'src1' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(2);
        expect(out[0].kind).toBe('group');
        expect(out[0].leader.actionIndex).toBe('10');
        expect(out[1].kind).toBe('entry');
        expect(out[1].entry.actionIndex).toBe('25');
    });

    it('handles uppercase ACTION names', () => {
        // Two uppercase-keyed MINTs so the group passes minMembers.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 31, action: 'MINT',
                raw: { TICK: 'MYTOKEN', SOURCE: 'src1', AMOUNT: '20' },
            }),
            entry({
                chainId: BTC, actionIndex: 30, action: 'MINT',
                raw: { TICK: 'MYTOKEN', SOURCE: 'src1', AMOUNT: '50' },
            }),
            entry({
                chainId: BTC, actionIndex: 10, action: 'ISSUE',
                source: 'src1', raw: { TICK: 'MYTOKEN', SOURCE: 'src1' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('group');
        expect(out[0].summary).toBe('Launched MYTOKEN (supply 70)');
    });

    it('collapses both sides of a cross-chain LINK into one card', () => {
        // Two SEND rows on different chains paired by the same
        // linkActionIndex; DESC so the BTC side (newer block) appears
        // first.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 100, action: 'SEND',
                blockIndex: 500,
                link: {
                    peerChainId: LTC, peerCoinTicker: 'LTC',
                    peerActionIndex: '200', linkActionIndex: 'L42',
                },
            }),
            entry({
                chainId: LTC, actionIndex: 200, action: 'SEND',
                blockIndex: 400,
                link: {
                    peerChainId: BTC, peerCoinTicker: 'BTC',
                    peerActionIndex: '100', linkActionIndex: 'L42',
                },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('group');
        expect(out[0].subkind).toBe('link-pair');
        expect(out[0].leader.chainId).toBe(LTC);
        expect(out[0].members.map((m) => m.chainId)).toEqual([BTC, LTC]);
        expect(out[0].summary).toBe('Cross-chain link: SEND ↔ SEND');
    });

    it('renders link-pair summary with asymmetric action names', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 100, action: 'LINK',
                link: {
                    peerChainId: LTC, peerCoinTicker: 'LTC',
                    peerActionIndex: '200', linkActionIndex: 'L43',
                },
            }),
            entry({
                chainId: LTC, actionIndex: 200, action: 'ISSUE',
                raw: { tick: 'XYZ', source: 'src9' },
                link: {
                    peerChainId: BTC, peerCoinTicker: 'BTC',
                    peerActionIndex: '100', linkActionIndex: 'L43',
                },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        // ISSUE-with-no-MINT survives as a plain entry so it can pair
        // up via link-pair without conflicting with issue-mint grouping.
        const linkGroup = out.find((it) => it.kind === 'group' && it.subkind === 'link-pair');
        expect(linkGroup).toBeTruthy();
        expect(linkGroup.summary).toBe('Cross-chain link: LINK ↔ ISSUE');
    });

    it('does not collapse a LINK whose peer is not in the visible window', () => {
        // Single side present (e.g. peer chain disabled in filter); no
        // collapse, the row stays a normal entry so its 🔗 badge still
        // surfaces.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 100, action: 'SEND',
                link: {
                    peerChainId: LTC, peerCoinTicker: 'LTC',
                    peerActionIndex: '200', linkActionIndex: 'L99',
                },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('entry');
    });

    it('collapses BATCH + its sub-actions via parent_batch_action_index', () => {
        // The explorer publishes parent_batch_action_index on every
        // history row (NULL on the envelope itself). DESC order, so the
        // BATCH row is oldest and lands at the bottom of the expansion.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 8, action: 'SEND', blockIndex: 700,
                raw: { parent_batch_action_index: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 7, action: 'ISSUE', blockIndex: 700,
                raw: { parent_batch_action_index: 5, tick: 'MYTOKEN', source: 'src1' },
            }),
            entry({
                chainId: BTC, actionIndex: 6, action: 'SEND', blockIndex: 700,
                raw: { parent_batch_action_index: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 5, action: 'BATCH', blockIndex: 700,
                raw: { parent_batch_action_index: null },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('group');
        expect(out[0].subkind).toBe('batch');
        expect(out[0].leader.actionIndex).toBe('5');
        expect(out[0].summary).toBe('Batch: 3 actions');
        expect(out[0].members.map((m) => m.actionIndex)).toEqual(['8', '7', '6', '5']);
    });

    it('reads the uppercase PARENT_BATCH_ACTION_INDEX key too', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 7, action: 'SEND',
                raw: { PARENT_BATCH_ACTION_INDEX: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 6, action: 'SEND',
                raw: { PARENT_BATCH_ACTION_INDEX: 5 },
            }),
            entry({ chainId: BTC, actionIndex: 5, action: 'BATCH', raw: {} }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(1);
        expect(out[0].subkind).toBe('batch');
        expect(out[0].summary).toBe('Batch: 2 actions');
    });

    it('leaves a sub-action ungrouped when its BATCH parent is not visible', () => {
        // Same orphan-free contract as the other subkinds: a filter that
        // hides the envelope must not produce a headless card.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 7, action: 'SEND',
                raw: { parent_batch_action_index: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 6, action: 'SEND',
                raw: { parent_batch_action_index: 5 },
            }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(2);
        expect(out.every((it) => it.kind === 'entry')).toBe(true);
    });

    it('does not group a sub-action under a BATCH on a different chain', () => {
        const entries = [
            entry({
                chainId: LTC, actionIndex: 7, action: 'SEND',
                raw: { parent_batch_action_index: 5 },
            }),
            entry({
                chainId: LTC, actionIndex: 6, action: 'SEND',
                raw: { parent_batch_action_index: 5 },
            }),
            entry({ chainId: BTC, actionIndex: 5, action: 'BATCH', raw: {} }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(3);
        expect(out.every((it) => it.kind === 'entry')).toBe(true);
    });

    it('keeps a one-sub-action batch flat, like the other leader-plus-children rules', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 6, action: 'SEND',
                raw: { parent_batch_action_index: 5 },
            }),
            entry({ chainId: BTC, actionIndex: 5, action: 'BATCH', raw: {} }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(2);
        expect(out.every((it) => it.kind === 'entry')).toBe(true);
    });

    it('claims a batched ISSUE for the batch card and never renders it twice', () => {
        // The ISSUE sits inside the batch; two MINTs of the same tick sit
        // outside it. Batch containment wins, so the MINTs stay flat
        // rather than pulling the ISSUE into a second card.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 30, action: 'MINT', blockIndex: 300,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '100' },
            }),
            entry({
                chainId: BTC, actionIndex: 20, action: 'MINT', blockIndex: 200,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '50' },
            }),
            entry({
                chainId: BTC, actionIndex: 7, action: 'SEND', blockIndex: 100,
                raw: { parent_batch_action_index: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 6, action: 'ISSUE', blockIndex: 100,
                source: 'src1',
                raw: { parent_batch_action_index: 5, tick: 'MYTOKEN', source: 'src1' },
            }),
            entry({ chainId: BTC, actionIndex: 5, action: 'BATCH', blockIndex: 100, raw: {} }),
        ];
        const out = groupHistoryEntries(entries, 'grouped');
        expect(out).toHaveLength(3);
        expect(out[0].kind).toBe('entry');
        expect(out[0].entry.actionIndex).toBe('30');
        expect(out[1].kind).toBe('entry');
        expect(out[1].entry.actionIndex).toBe('20');
        expect(out[2].kind).toBe('group');
        expect(out[2].subkind).toBe('batch');
        expect(out[2].members.map((m) => m.actionIndex)).toEqual(['7', '6', '5']);
        // Every action index appears exactly once across the render.
        const rendered = out.flatMap((it) => (
            it.kind === 'group' ? it.members.map((m) => m.actionIndex) : [it.entry.actionIndex]
        ));
        expect(new Set(rendered).size).toBe(rendered.length);
    });

    it('does not collapse a batch in flat mode', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 7, action: 'SEND',
                raw: { parent_batch_action_index: 5 },
            }),
            entry({
                chainId: BTC, actionIndex: 6, action: 'SEND',
                raw: { parent_batch_action_index: 5 },
            }),
            entry({ chainId: BTC, actionIndex: 5, action: 'BATCH', raw: {} }),
        ];
        const out = groupHistoryEntries(entries, 'flat');
        expect(out).toHaveLength(3);
        expect(out.every((it) => it.kind === 'entry')).toBe(true);
    });

    it('does not collapse link-pair in flat mode', () => {
        const entries = [
            entry({
                chainId: BTC, actionIndex: 100, action: 'SEND',
                link: { peerChainId: LTC, peerCoinTicker: 'LTC', peerActionIndex: '200', linkActionIndex: 'L42' },
            }),
            entry({
                chainId: LTC, actionIndex: 200, action: 'SEND',
                link: { peerChainId: BTC, peerCoinTicker: 'BTC', peerActionIndex: '100', linkActionIndex: 'L42' },
            }),
        ];
        const out = groupHistoryEntries(entries, 'flat');
        expect(out).toHaveLength(2);
        expect(out.every((it) => it.kind === 'entry')).toBe(true);
    });
});
