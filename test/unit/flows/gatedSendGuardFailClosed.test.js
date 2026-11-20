// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Security item 18909: the unlock-threshold split must fail closed. When the
// recipient's balance or the send amount cannot be read exactly, the old split
// answered "every pack required" and the send attached every pack key to a
// recipient who may sit below the publisher's threshold. The keys go out
// ECIES-encrypted on chain and cannot be taken back, so the send is refused
// instead, with copy the wallet already has: the explorer's own error keeps
// the explorer sentence, and anything else falls to the generic send line.
// The Send form's readiness probe keeps every pack for display and never throws.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

import {
    prepareGatedSend,
    gatedSendReadiness,
    splitGroupsByThreshold,
    clearGatedGroupsCache,
} from '../../../packages/core/src/flows/gatedSendGuard.js';
import { clearGatedContentCaches } from '../../../packages/core/src/flows/gatedContent.js';
import { createGatedKey } from '../../../packages/core/src/schemas/gatedKey.js';
import { submitFailureMessage } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { encoderFieldError } from '../../../packages/core/src/sdk/encoderFieldErrors.js';

const KEY_A = Buffer.alloc(32, 1);
const HASH_A = createHash('sha256').update(KEY_A).digest('hex');
const RECIPIENT = 'bcrt1qrecipient';
const RECIPIENT_PUBKEY = '02'.padEnd(66, 'cd');
const GENERIC_SEND = "Couldn't send. Something went wrong. Try again.";

// The SDK explorer client's own error shape (SDKExplorerError).
function explorerError(code, message) {
    const err = new Error(message);
    err.name = 'SDKExplorerError';
    err.code = code;
    return err;
}

// What reaches the popup after MessageHost.serializeError: name and message only.
function acrossBoundary(err) {
    const out = new Error(err.message);
    out.name = err.name;
    return out;
}

function thresholdRow(gateMin) {
    return {
        gate_ticker: 'GATED', key_hash: HASH_A, action_index: '100', name: 'f100',
        encryption_method: 1, gate_min_amount: gateMin,
    };
}

function makeSdk(getBalances) {
    return {
        getFiles: vi.fn(async () => [thresholdRow('100')]),
        getBalances: vi.fn(getBalances),
        getPublicKey: vi.fn(async () => RECIPIENT_PUBKEY),
        gatedFile: {
            verifyKey: vi.fn((key, hash) => key.equals(KEY_A) && String(hash).toLowerCase() === HASH_A),
            serializeKeyPayload: vi.fn((keys) => Buffer.concat([Buffer.from([0x01]), ...Object.values(keys)])),
        },
        messaging: { eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'ec1e5c1pher' })) },
        actions: {
            createAction: vi.fn(({ action, params }) => ({
                actionString: [action, ...Object.values(params)].join('|'), action,
            })),
        },
        wallet: { deriveAddress: vi.fn((pk) => (pk === RECIPIENT_PUBKEY ? RECIPIENT : 'bcrt1qother')) },
    };
}

function makeVaultWithKey() {
    const store = new Map();
    const record = createGatedKey({
        walletId: 'w1', chainId: 'btc-regtest', gateTicker: 'GATED',
        keyHash: HASH_A, keyHex: KEY_A.toString('hex'), source: 'recovered',
    });
    store.set(record.id, record);
    return { gatedKeys: { get: vi.fn(async (id) => store.get(id) || null) } };
}

function args(sdk, overrides = {}) {
    return {
        sdkRegistry: { get: () => sdk },
        chainRegistry: { get: () => ({ coin: 'bitcoin', addressTypes: ['p2wpkh'] }) },
        vault: makeVaultWithKey(),
        walletId: 'w1',
        chainId: 'btc-regtest',
        source: { address: 'bcrt1qsender' },
        sourceAddress: 'bcrt1qsender',
        to: RECIPIENT,
        tick: 'GATED',
        amount: '5',
        ...overrides,
    };
}

// The Send form's two mappers, in the order its confirm catch runs them.
function sendFormCopy(err) {
    expect(encoderFieldError(err, { coinTicker: 'BTC' })).toBeNull();
    return submitFailureMessage(err, { verb: 'send', coinTicker: 'BTC' });
}

beforeEach(() => {
    clearGatedGroupsCache();
    clearGatedContentCaches();
});

describe('18909: a failed balance read refuses the send with the explorer error', () => {
    const cases = [
        ['EXPLORER_NETWORK', 'Explorer request failed: fetch failed',
            'The wallet could not reach the service that reads the chain, but nothing was signed or sent, '
            + 'and nothing was spent. Check your connection and try again.'],
        ['EXPLORER_TIMEOUT', 'Explorer request timed out: /RBTC/api/balances/bcrt1qrecipient',
            'The service that reads the chain did not answer in time, so the wallet could not check this action, '
            + 'but nothing was signed or sent, and nothing was spent. Try again in a moment.'],
        ['EXPLORER_HTTP_502', 'Explorer returned HTTP 502 for /RBTC/api/balances/bcrt1qrecipient',
            'The service that reads the chain is temporarily unavailable (error 502), but nothing was signed '
            + 'or sent, and nothing was spent. Try again in a moment.'],
    ];

    for (const [code, message, sentence] of cases) {
        it(`${code}: rethrows the explorer error unchanged and attaches no key`, async () => {
            const thrown = explorerError(code, message);
            const sdk = makeSdk(async () => { throw thrown; });
            const err = await prepareGatedSend(args(sdk)).catch((e) => e);
            expect(err).toBe(thrown);
            expect(sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
            expect(sdk.gatedFile.serializeKeyPayload).not.toHaveBeenCalled();
            expect(sendFormCopy(err)).toBe(sentence);
            expect(sendFormCopy(acrossBoundary(err))).toBe(sentence);
        });
    }

    it('a rate-limited balance read keeps the existing rate-limit line', async () => {
        const thrown = explorerError('RATE_LIMITED',
            'Explorer returned HTTP 429 for /RBTC/api/balances/bcrt1qrecipient; retry after 30 seconds');
        thrown.name = 'SDKRateLimitedError';
        const sdk = makeSdk(async () => { throw thrown; });
        const err = await prepareGatedSend(args(sdk)).catch((e) => e);
        expect(err).toBe(thrown);
        expect(sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
        const copy = sendFormCopy(err);
        expect(copy).toMatch(/^The service asked the wallet to slow down for 30 seconds/);
        expect(copy).toMatch(/Nothing was signed or sent, so nothing was spent\.$/);
        expect(sendFormCopy(acrossBoundary(err))).toBe(copy);
    });
});

describe('18909: an unreadable balance row or amount refuses the send with the generic line', () => {
    it('a fractional atomic quantity (BigInt cannot parse it) refuses, no key attached', async () => {
        const sdk = makeSdk(async () => ({ data: [{ tick: 'GATED', quantity: '12.5', divisibility: 8 }] }));
        const err = await prepareGatedSend(args(sdk)).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('Error');
        expect(sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
        expect(sendFormCopy(err)).toBe(GENERIC_SEND);
        expect(sendFormCopy(acrossBoundary(err))).toBe(GENERIC_SEND);
    });

    it('an unreadable human amount refuses, no key attached', async () => {
        const sdk = makeSdk(async () => ({ data: [{ tick: 'GATED', amount: 'garbage', decimals: 8 }] }));
        const err = await prepareGatedSend(args(sdk)).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
        expect(sendFormCopy(err)).toBe(GENERIC_SEND);
    });

    it('a bad divisibility refuses, no key attached', async () => {
        const sdk = makeSdk(async () => ({ data: [{ tick: 'GATED', quantity: '125', divisibility: -1 }] }));
        const err = await prepareGatedSend(args(sdk)).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
        expect(sendFormCopy(err)).toBe(GENERIC_SEND);
    });

    it('a send amount that is not a plain decimal refuses before any balance read', async () => {
        const sdk = makeSdk(async () => ({ data: [] }));
        for (const amount of ['1e-8', '-5', '0.0000000000000000001']) {
            clearGatedGroupsCache();
            const err = await prepareGatedSend(args(sdk, { amount })).catch((e) => e);
            expect(err).toBeInstanceOf(Error);
            expect(sendFormCopy(err)).toBe(GENERIC_SEND);
        }
        expect(sdk.getBalances).not.toHaveBeenCalled();
        expect(sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
    });

    it('splitGroupsByThreshold itself never answers all-required on a read failure', async () => {
        const groups = [{ keyHash: HASH_A, files: [{ actionIndex: '100', gateMinAmount: '100' }] }];
        const thrown = explorerError('EXPLORER_NETWORK', 'Explorer request failed: fetch failed');
        const sdk = { getBalances: vi.fn(async () => { throw thrown; }) };
        await expect(splitGroupsByThreshold({ sdk, to: RECIPIENT, tick: 'GATED', amount: '5', groups }))
            .rejects.toBe(thrown);
    });
});

describe('18909: a fractional human balance below the threshold withholds the key', () => {
    it('12.5 held + 5 sent stays under 100, so the send goes out plain', async () => {
        const sdk = makeSdk(async () => ({ data: [{ tick: 'GATED', amount: '12.5', decimals: 8 }] }));
        const plan = await prepareGatedSend(args(sdk));
        expect(plan).toBeNull();
        expect(sdk.messaging.eciesEncryptBytes).not.toHaveBeenCalled();
    });
});

describe('18909: the Send form readiness probe still answers when the split refuses', () => {
    it('a failed balance read keeps every pack for display and does not throw', async () => {
        const sdk = makeSdk(async () => { throw explorerError('EXPLORER_NETWORK', 'Explorer request failed: x'); });
        const report = await gatedSendReadiness(args(sdk));
        expect(report.state).toBe('ready');
        expect(report.groups.map((g) => g.keyHash)).toEqual([HASH_A]);
        expect(report).not.toHaveProperty('belowThresholdCount');
    });

    it('a half-typed amount keeps every pack for display and does not throw', async () => {
        const sdk = makeSdk(async () => ({ data: [] }));
        for (const amount of ['12.', '.5', '1e-8']) {
            clearGatedGroupsCache();
            const report = await gatedSendReadiness(args(sdk, { amount }));
            expect(report.state).toBe('ready');
            expect(report.groups).toHaveLength(1);
        }
    });

    it('an unreadable balance row keeps every pack for display and does not throw', async () => {
        const sdk = makeSdk(async () => ({ data: [{ tick: 'GATED', quantity: '12.5', divisibility: 8 }] }));
        const report = await gatedSendReadiness(args(sdk));
        expect(report.state).toBe('ready');
        expect(report.groups).toHaveLength(1);
    });
});
