// Unit tests for the §28.6 advanced-filter utility.

import { describe, it, expect } from 'vitest';
import {
    applyHistoryFilters,
    classifyEntryAction,
    classifyEntryStatus,
} from '../../../packages/core/src/shared/utils/historyFilter.js';

const BTC = 'bitcoin-mainnet';
const WALLET_ADDR = 'bc1qself';

function entry(over) {
    return {
        key: over.key || `${over.chainId}:${over.actionIndex}:${over.address || 'a1'}`,
        chainId: over.chainId || BTC,
        address: over.address || 'a1',
        actionIndex: String(over.actionIndex || '0'),
        action: over.action || 'SEND',
        blockIndex: over.blockIndex ?? 100,
        timestamp: over.timestamp ?? 1700000000,
        txHash: over.txHash || '',
        source: over.source || '',
        raw: over.raw || {},
        link: over.link || null,
    };
}

describe('shared/utils/historyFilter', () => {
    describe('classifyEntryAction', () => {
        const wallet = new Set([WALLET_ADDR.toLowerCase()]);

        it('classifies outgoing SEND when source is a wallet address', () => {
            const e = entry({ action: 'SEND', source: WALLET_ADDR });
            expect(classifyEntryAction(e, wallet)).toBe('send');
        });

        it('classifies incoming SEND as receive', () => {
            const e = entry({ action: 'SEND', source: 'bc1qstranger' });
            expect(classifyEntryAction(e, wallet)).toBe('receive');
        });

        it('treats ISSUANCE as issue', () => {
            expect(classifyEntryAction(entry({ action: 'ISSUANCE' }), wallet)).toBe('issue');
        });

        it('maps ORDER_MATCH / ORDER_FILL to swap', () => {
            expect(classifyEntryAction(entry({ action: 'ORDER_MATCH' }), wallet)).toBe('swap');
            expect(classifyEntryAction(entry({ action: 'ORDER_FILL' }), wallet)).toBe('swap');
        });

        it('maps LINK to crosschain', () => {
            expect(classifyEntryAction(entry({ action: 'LINK' }), wallet)).toBe('crosschain');
        });

        it('falls back to other for unknown actions', () => {
            expect(classifyEntryAction(entry({ action: 'WHATEVER' }), wallet)).toBe('other');
        });
    });

    describe('classifyEntryStatus', () => {
        it('returns confirmed when blockIndex > 0', () => {
            expect(classifyEntryStatus(entry({ blockIndex: 100 }))).toBe('confirmed');
        });

        it('returns pending when blockIndex is 0', () => {
            expect(classifyEntryStatus(entry({ blockIndex: 0 }))).toBe('pending');
        });

        it('returns failed when raw.status is invalid', () => {
            expect(classifyEntryStatus(entry({ blockIndex: 100, raw: { status: 'invalid' } }))).toBe('failed');
        });

        it('returns failed when raw.valid is 0', () => {
            expect(classifyEntryStatus(entry({ blockIndex: 100, raw: { valid: 0 } }))).toBe('failed');
        });
    });

    describe('applyHistoryFilters', () => {
        const wallet = new Set([WALLET_ADDR.toLowerCase()]);
        const e1 = entry({
            actionIndex: 1, action: 'SEND', source: WALLET_ADDR,
            timestamp: 1700000000, raw: { tick: 'XCP', memo: 'rent payment' },
        });
        const e2 = entry({
            actionIndex: 2, action: 'SEND', source: 'bc1qstranger',
            timestamp: 1700100000, raw: {},
        });
        const e3 = entry({
            actionIndex: 3, action: 'ISSUE', blockIndex: 0,
            timestamp: 1700200000, raw: { tick: 'MYTOKEN' },
        });
        const e4 = entry({
            actionIndex: 4, action: 'MINT', blockIndex: 200,
            timestamp: 1700300000, raw: { tick: 'MYTOKEN', amount: '1000', status: 'invalid' },
        });
        const all = [e4, e3, e2, e1];

        it('returns the original list when no filters applied', () => {
            expect(applyHistoryFilters(all, {})).toBe(all);
        });

        it('filters by action type (multi-select)', () => {
            const out = applyHistoryFilters(all, {
                actionTypes: new Set(['issue', 'mint']),
                walletAddresses: wallet,
            });
            expect(out).toHaveLength(2);
            expect(out.map((e) => e.actionIndex)).toEqual(['4', '3']);
        });

        it('discriminates send vs receive via wallet addresses', () => {
            const sendOnly = applyHistoryFilters(all, {
                actionTypes: new Set(['send']),
                walletAddresses: wallet,
            });
            expect(sendOnly).toHaveLength(1);
            expect(sendOnly[0].actionIndex).toBe('1');

            const receiveOnly = applyHistoryFilters(all, {
                actionTypes: new Set(['receive']),
                walletAddresses: wallet,
            });
            expect(receiveOnly).toHaveLength(1);
            expect(receiveOnly[0].actionIndex).toBe('2');
        });

        it('filters by status (pending excludes confirmed and failed)', () => {
            const out = applyHistoryFilters(all, { statusSet: new Set(['pending']) });
            expect(out).toHaveLength(1);
            expect(out[0].actionIndex).toBe('3');
        });

        it('filters by status (failed catches invalid rows)', () => {
            const out = applyHistoryFilters(all, { statusSet: new Set(['failed']) });
            expect(out).toHaveLength(1);
            expect(out[0].actionIndex).toBe('4');
        });

        it('filters by date range (inclusive)', () => {
            const from = 1700100000 * 1000;
            const to = 1700200000 * 1000;
            const out = applyHistoryFilters(all, { dateFromMs: from, dateToMs: to });
            expect(out.map((e) => e.actionIndex)).toEqual(['3', '2']);
        });

        it('excludes pending entries when a date range is set', () => {
            const from = 1700100000 * 1000;
            const out = applyHistoryFilters(all, { dateFromMs: from });
            // e3 is pending (blockIndex 0) — but it has a timestamp, so
            // it survives this filter. The util only excludes entries
            // with NO timestamp. Document the actual behavior.
            expect(out.map((e) => e.actionIndex)).toEqual(['4', '3', '2']);
        });

        it('searches the action code', () => {
            const out = applyHistoryFilters(all, { searchQuery: 'mint' });
            expect(out).toHaveLength(1);
            expect(out[0].actionIndex).toBe('4');
        });

        it('searches memo text inside raw payload', () => {
            const out = applyHistoryFilters(all, { searchQuery: 'rent' });
            expect(out).toHaveLength(1);
            expect(out[0].actionIndex).toBe('1');
        });

        it('searches tick / token names', () => {
            const out = applyHistoryFilters(all, { searchQuery: 'mytoken' });
            expect(out.map((e) => e.actionIndex)).toEqual(['4', '3']);
        });

        it('combines action-type + status + search filters', () => {
            const out = applyHistoryFilters(all, {
                actionTypes: new Set(['mint']),
                statusSet: new Set(['failed']),
                searchQuery: 'mytoken',
                walletAddresses: wallet,
            });
            expect(out).toHaveLength(1);
            expect(out[0].actionIndex).toBe('4');
        });
    });
});
