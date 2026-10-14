import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    clearBalanceCache,
    readBalanceCache,
    writeBalanceCache,
} from '../../../../packages/core/src/shared/utils/balanceCache.js';
import {
    clearHistoryCacheForWallet,
    readHistoryCache,
    writeHistoryCache,
} from '../../../../packages/core/src/shared/utils/historyCache.js';
import {
    FORGOT_PASSWORD_RESTORE_LANE_KEY,
    setForgotPasswordRestoreIntent,
    takeForgotPasswordRestoreLane,
} from '../../../../packages/core/src/shared/utils/forgotPasswordRecovery.js';
import { POST_DEMO_INTENT_KEY } from '../../../../packages/core/src/shared/utils/demoGraduation.js';
import {
    MSG_UNREAD_EVENT,
    readMsgRead,
    readMsgRequestDeclined,
    readMsgUnread,
    sweepMsgMemoryForWallet,
    writeMsgRead,
    writeMsgRequestDeclined,
    writeMsgUnread,
} from '../../../../packages/core/src/shared/utils/msgReadMemory.js';

beforeEach(() => localStorage.clear());

afterEach(() => vi.restoreAllMocks());

describe('balance cache defensive branches', () => {
    it('rejects invalid scope and malformed records', () => {
        expect(readBalanceCache('', 'account')).toBeNull();

        localStorage.setItem('xc:balanceCache:wallet:account', '{');
        expect(readBalanceCache('wallet', 'account')).toBeNull();

        localStorage.setItem('xc:balanceCache:wallet:account', JSON.stringify({
            walletId: 'another-wallet', accountId: 'account', balances: {}, fetchedAt: 1,
        }));
        expect(readBalanceCache('wallet', 'account')).toBeNull();

        localStorage.setItem('xc:balanceCache:wallet:account', JSON.stringify({
            walletId: 'wallet', accountId: 'account', balances: [], fetchedAt: 1,
        }));
        expect(readBalanceCache('wallet', 'account')).toBeNull();

        localStorage.setItem('xc:balanceCache:wallet:account', JSON.stringify({
            walletId: 'wallet', accountId: 'account', balances: {}, fetchedAt: -1,
        }));
        expect(readBalanceCache('wallet', 'account')).toBeNull();
    });

    it('normalizes a missing account and malformed active-chain snapshot', () => {
        writeBalanceCache('wallet-null-account', '', {
            balances: { chain: [] },
            activeByChain: [],
            fetchedAt: 0,
        });

        expect(readBalanceCache('wallet-null-account', null)).toEqual({
            balances: { chain: [] },
            activeByChain: {},
            fetchedAt: 0,
        });
    });

    it('ignores invalid writes and storage refusal', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        writeBalanceCache('', null, { balances: {}, fetchedAt: 0 });
        writeBalanceCache('wallet-invalid', null, { balances: [], fetchedAt: 0 });
        writeBalanceCache('wallet-invalid', null, { balances: {}, fetchedAt: Number.NaN });
        expect(setItem).not.toHaveBeenCalled();

        setItem.mockImplementation(() => { throw new Error('quota exceeded'); });
        expect(() => writeBalanceCache('wallet-refused', null, {
            balances: {}, fetchedAt: 0,
        })).not.toThrow();
        expect(readBalanceCache('wallet-refused', null)).toBeNull();
    });

    it('keeps a cleared wallet from being repopulated by a late write', () => {
        writeBalanceCache('wallet-cleared-edge', 'account', { balances: {}, fetchedAt: 1 });
        clearBalanceCache('wallet-cleared-edge');
        writeBalanceCache('wallet-cleared-edge', 'account', { balances: {}, fetchedAt: 2 });

        expect(readBalanceCache('wallet-cleared-edge', 'account')).toBeNull();
    });
});

describe('history cache defensive branches', () => {
    const valid = { entries: [], addressesByChain: {}, fetchedAt: 0 };

    it('rejects invalid records and returns false for unavailable storage', () => {
        expect(readHistoryCache('', null)).toBeNull();
        localStorage.setItem('xc:historyCache:v1:wallet:all', JSON.stringify({
            entries: {}, addressesByChain: {}, fetchedAt: 0,
        }));
        expect(readHistoryCache('wallet', null)).toBeNull();

        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        expect(writeHistoryCache('wallet-refused', null, valid)).toBe(false);
        expect(writeHistoryCache('', null, valid)).toBe(false);
    });

    it('clears every account for one wallet and tolerates cleanup refusal', () => {
        writeHistoryCache('wallet-history-edge', 'a', valid);
        writeHistoryCache('wallet-history-edge', 'b', valid);
        writeHistoryCache('wallet-other-edge', 'a', valid);
        clearHistoryCacheForWallet('wallet-history-edge');

        expect(readHistoryCache('wallet-history-edge', 'a')).toBeNull();
        expect(readHistoryCache('wallet-history-edge', 'b')).toBeNull();
        expect(readHistoryCache('wallet-other-edge', 'a')).toEqual(valid);

        vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
            throw new Error('enumeration blocked');
        });
        expect(() => clearHistoryCacheForWallet('wallet-other-edge')).not.toThrow();
    });
});

describe('forgot-password restore intent fallbacks', () => {
    it('rejects unknown lanes and consumes valid lanes once', () => {
        setForgotPasswordRestoreIntent('unknown');
        expect(localStorage.length).toBe(0);

        setForgotPasswordRestoreIntent('backup');
        expect(localStorage.getItem(POST_DEMO_INTENT_KEY)).toBe('import');
        expect(takeForgotPasswordRestoreLane()).toBe('backup');
        expect(takeForgotPasswordRestoreLane('mnemonic')).toBe('mnemonic');
    });

    it('removes both markers when the paired write is only partly successful', () => {
        const original = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function setItem(key, value) {
            if (key === POST_DEMO_INTENT_KEY) throw new Error('second write blocked');
            return original.call(this, key, value);
        });

        setForgotPasswordRestoreIntent('mnemonic');
        expect(localStorage.getItem(FORGOT_PASSWORD_RESTORE_LANE_KEY)).toBeNull();
        expect(localStorage.getItem(POST_DEMO_INTENT_KEY)).toBeNull();
    });

    it('uses the caller fallback when reading or removing is refused', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('read blocked');
        });
        expect(takeForgotPasswordRestoreLane('backup')).toBe('backup');
    });
});

describe('message memory defensive branches', () => {
    it('sanitizes seen ids and declined request ids', () => {
        writeMsgRead('wallet-msg-edge', null, {
            alice: ['tx-1', '', 3, 'tx-2'],
            legacy: 1234,
        });
        expect(readMsgRead('wallet-msg-edge', null)).toEqual({ alice: ['tx-1', 'tx-2'] });

        writeMsgRequestDeclined('wallet-msg-edge', null, ['req-1', '', 3, 'req-1', 'req-2']);
        expect(readMsgRequestDeclined('wallet-msg-edge', null)).toEqual(['req-1', 'req-2']);
    });

    it('clamps unread counts and emits the normalized value', () => {
        const events = [];
        window.addEventListener(MSG_UNREAD_EVENT, (event) => events.push(event.detail), { once: true });

        writeMsgUnread('wallet-msg-edge', '', 2.9);
        expect(readMsgUnread('wallet-msg-edge', null)).toBe(2);
        expect(events).toEqual([{
            walletId: 'wallet-msg-edge', accountId: 'default', count: 2,
        }]);

        writeMsgUnread('wallet-msg-edge', '', Number.NaN);
        expect(readMsgUnread('wallet-msg-edge', null)).toBe(0);
    });

    it('returns safe defaults for malformed records and refused storage', () => {
        localStorage.setItem('xc:msgRead:wallet-msg-edge:default', '{');
        localStorage.setItem('xc:msgUnread:wallet-msg-edge:default', '{');
        localStorage.setItem('xc:msgRequestDeclined:wallet-msg-edge:default', '{}');
        expect(readMsgRead('wallet-msg-edge', null)).toEqual({});
        expect(readMsgUnread('wallet-msg-edge', null)).toBe(0);
        expect(readMsgRequestDeclined('wallet-msg-edge', null)).toEqual([]);

        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('storage blocked');
        });
        expect(readMsgRead('wallet-msg-refused', null)).toEqual({});
        expect(readMsgUnread('wallet-msg-refused', null)).toBe(0);
        expect(readMsgRequestDeclined('wallet-msg-refused', null)).toEqual([]);
    });

    it('sweeps every account and message-memory namespace for one wallet', () => {
        writeMsgRead('wallet-msg-edge', 'a', { alice: ['tx-1'] });
        writeMsgUnread('wallet-msg-edge', 'b', 2);
        writeMsgRequestDeclined('wallet-msg-edge', 'c', ['req-1']);
        writeMsgUnread('wallet-msg-other', 'a', 4);

        expect(sweepMsgMemoryForWallet('wallet-msg-edge')).toBe(3);
        expect(readMsgRead('wallet-msg-edge', 'a')).toEqual({});
        expect(readMsgUnread('wallet-msg-edge', 'b')).toBe(0);
        expect(readMsgRequestDeclined('wallet-msg-edge', 'c')).toEqual([]);
        expect(readMsgUnread('wallet-msg-other', 'a')).toBe(4);
        expect(sweepMsgMemoryForWallet('')).toBe(0);
    });
});
