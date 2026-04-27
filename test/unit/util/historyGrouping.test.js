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
        // Newest member first, leader (oldest) last.
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
        const entries = [
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
        expect(out[0].summary).toMatch(/Dispenser at bc1qab…rxyz — 2 dispenses/);
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
        const entries = [
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
        expect(out[0].summary).toBe('Limit order — 1 fill');
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
        expect(out[0].summary).toBe('Limit order — 2 fills');
    });

    it('emits a group at the position of its newest member so recent activity stays on top', () => {
        // Unrelated SEND between MINTs and ISSUE — the group bubbles to
        // the newest member (MINT-30) so the History feed keeps its
        // "newest first" reading order; the SEND-25 follows.
        const entries = [
            entry({
                chainId: BTC, actionIndex: 30, action: 'MINT', blockIndex: 300,
                raw: { tick: 'MYTOKEN', source: 'src1', amount: '100' },
            }),
            entry({ chainId: BTC, actionIndex: 25, action: 'SEND', blockIndex: 250 }),
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
        const entries = [
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
        expect(out[0].summary).toBe('Launched MYTOKEN (supply 50)');
    });
});
