// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { base58check, bech32 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import {
    detectAddressChain,
    isValidAddressForChain,
} from '../../../packages/core/src/shared/utils/addressValidation.js';
import {
    encodeBip21Uri,
    InvalidBip21Error,
    normalizeBip21Amount,
    parseBip21Uri,
} from '../../../packages/core/src/uri/bip21.js';
import { detectQrContent } from '../../../packages/core/src/uri/detectQrContent.js';

const RUNS = Number(process.env.FUZZ_ITERATIONS || 200);
const MAX_INPUT_LENGTH = 2048;
const bsc = base58check(sha256);

const textArb = fc.string({ maxLength: MAX_INPUT_LENGTH });
const plainAmountArb = fc.tuple(
    fc.stringMatching(/^[0-9]{1,80}$/),
    fc.option(fc.stringMatching(/^[0-9]{0,8}$/), { nil: undefined }),
).map(([whole, fraction]) => fraction === undefined ? whole : `${whole}.${fraction}`);

function mutate(source, position, replacement, remove) {
    if (source.length === 0) return replacement;
    const index = position % source.length;
    if (remove) return source.slice(0, index) + source.slice(index + 1);
    return source.slice(0, index) + replacement + source.slice(index + 1);
}

const mutated = (sourceArb) => fc.tuple(
    sourceArb,
    fc.nat(),
    fc.string({ minLength: 1, maxLength: 2 }),
    fc.boolean(),
).map(([source, position, replacement, remove]) => (
    mutate(source, position, replacement, remove)
));

function capture(parse, input) {
    try {
        return { ok: true, value: parse(input) };
    } catch (error) {
        return { ok: false, error };
    }
}

function isPlainParserError(error) {
    return error instanceof Error
        && typeof error.name === 'string'
        && typeof error.message === 'string';
}

const COINS = new Set(['bitcoin', 'litecoin', 'dogecoin']);
const NETWORKS = new Set(['mainnet', 'testnet', 'regtest']);

function isAddressResult(value) {
    return value === null || (
        typeof value === 'object'
        && (value.coin === null || COINS.has(value.coin))
        && (value.network === null || NETWORKS.has(value.network))
        && Array.isArray(value.candidates)
        && value.candidates.length > 0
        && value.candidates.every((coin) => COINS.has(coin))
    );
}

const legacyAddressArb = fc.tuple(
    fc.constantFrom(0x00, 0x05, 0x30, 0x32, 0x1e, 0x16, 0x6f, 0x71, 0xc4),
    fc.uint8Array({ minLength: 20, maxLength: 20 }),
).map(([version, hash]) => bsc.encode(new Uint8Array([version, ...hash])));

const segwitCaseArb = fc.tuple(
    fc.constantFrom(
        { hrp: 'bc', coin: 'bitcoin', network: 'mainnet' },
        { hrp: 'tb', coin: 'bitcoin', network: 'testnet' },
        { hrp: 'bcrt', coin: 'bitcoin', network: 'regtest' },
        { hrp: 'ltc', coin: 'litecoin', network: 'mainnet' },
        { hrp: 'tltc', coin: 'litecoin', network: 'testnet' },
        { hrp: 'rltc', coin: 'litecoin', network: 'regtest' },
    ),
    fc.uint8Array({ minLength: 20, maxLength: 20 }),
).map(([descriptor, program]) => ({
    ...descriptor,
    address: bech32.encode(descriptor.hrp, [0, ...bech32.toWords(program)]),
}));

const segwitAddressArb = segwitCaseArb.map(({ address }) => address);

const addressArb = fc.oneof(legacyAddressArb, segwitAddressArb);

describe('fuzz/address-parser', () => {
    it('terminates with a valid detection or null for random and mutated input', () => {
        fc.assert(
            fc.property(fc.oneof(textArb, mutated(addressArb)), (input) => (
                isAddressResult(detectAddressChain(input))
            )),
            { numRuns: RUNS },
        );
    });

    it('parses generated addresses and rejects mixed-case bech32 mutations', () => {
        fc.assert(
            fc.property(addressArb, (address) => isAddressResult(detectAddressChain(address))
                && detectAddressChain(address) !== null),
            { numRuns: RUNS },
        );
        fc.assert(
            fc.property(segwitCaseArb, fc.nat(), ({ address, coin, network }, offset) => {
                const letterIndexes = [...address]
                    .map((character, index) => /[a-z]/.test(character) ? index : -1)
                    .filter((index) => index >= 0);
                const index = letterIndexes[offset % letterIndexes.length];
                const mixed = address.slice(0, index)
                    + address[index].toUpperCase()
                    + address.slice(index + 1);
                return detectAddressChain(mixed) === null
                    && !isValidAddressForChain(mixed, coin, network);
            }),
            { numRuns: RUNS },
        );
    });
});

function isBip21Result(value) {
    return value !== null
        && typeof value === 'object'
        && typeof value.scheme === 'string'
        && /^[a-z][a-z0-9+.-]*$/.test(value.scheme)
        && typeof value.address === 'string'
        && value.address.length > 0
        && value.params !== null
        && typeof value.params === 'object'
        && !Array.isArray(value.params)
        && Array.isArray(value.required)
        && value.required.every((item) => typeof item === 'string');
}

const paymentUriArb = fc.tuple(
    fc.constantFrom('bitcoin', 'litecoin', 'dogecoin'),
    fc.stringMatching(/^[a-zA-Z0-9]{20,90}$/),
    plainAmountArb,
    fc.string({ maxLength: 120 }),
).map(([scheme, address, amount, message]) => encodeBip21Uri({
    scheme,
    address,
    amount,
    message,
}));

describe('fuzz/payment-uri-parser', () => {
    it('terminates with valid parts or a plain parse error for random and mutated input', () => {
        fc.assert(
            fc.property(fc.oneof(textArb, mutated(paymentUriArb)), (input) => {
                const result = capture(parseBip21Uri, input);
                return result.ok
                    ? isBip21Result(result.value)
                    : result.error instanceof InvalidBip21Error
                        && isPlainParserError(result.error);
            }),
            { numRuns: RUNS },
        );
    });

    it('parses every generated payment URI', () => {
        fc.assert(
            fc.property(paymentUriArb, (uri) => isBip21Result(parseBip21Uri(uri))),
            { numRuns: RUNS },
        );
    });
});

function isNormalizedAmount(value) {
    return value === undefined || (
        typeof value === 'string'
        && /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(value)
        && (!value.includes('.') || !value.endsWith('0'))
    );
}

describe('fuzz/amount-parser', () => {
    it('terminates with a canonical decimal or a plain error for random and mutated input', () => {
        const inputArb = fc.oneof(
            textArb,
            mutated(plainAmountArb),
            fc.integer(),
            fc.double({ noNaN: false, noDefaultInfinity: false }),
            fc.constantFrom(null, undefined),
        );
        fc.assert(
            fc.property(inputArb, (input) => {
                const result = capture(normalizeBip21Amount, input);
                return result.ok
                    ? isNormalizedAmount(result.value)
                    : isPlainParserError(result.error);
            }),
            { numRuns: RUNS },
        );
    });

    it('normalizes every generated plain amount idempotently', () => {
        fc.assert(
            fc.property(plainAmountArb, (amount) => {
                const once = normalizeBip21Amount(amount);
                return isNormalizedAmount(once) && normalizeBip21Amount(once) === once;
            }),
            { numRuns: RUNS },
        );
    });
});

const QR_TYPES = new Set([
    'bip21',
    'xchain-uri',
    'psbt-hex',
    'transaction-hex',
    'xcw-chunk',
    'backup-pointer',
    'pairing-code',
    'wif',
    'mnemonic-bip39',
    'mnemonic-counterwallet',
    'address',
    'unknown',
]);

function isQrResult(value) {
    if (value === null || typeof value !== 'object' || !QR_TYPES.has(value.type)) return false;
    if (value.type === 'unknown') return Object.keys(value).length === 1;
    if (value.type === 'address') return typeof value.address === 'string';
    if (value.type === 'bip21') return isBip21Result(value.parts);
    if (value.type === 'xchain-uri') return isBip21Result(value.parts);
    return true;
}

describe('fuzz/qr-payload-parser', () => {
    it('terminates with a recognized payload for random and mutated input', () => {
        const inputArb = fc.oneof(
            textArb,
            mutated(paymentUriArb),
            mutated(addressArb),
        );
        fc.assert(
            fc.property(inputArb, (input) => isQrResult(detectQrContent(input))),
            { numRuns: RUNS },
        );
    });

    it('returns the plain unknown result for non-string input', () => {
        fc.assert(
            fc.property(fc.anything().filter((value) => typeof value !== 'string'), (input) => {
                const result = detectQrContent(input);
                return Object.getPrototypeOf(result) === Object.prototype
                    && result.type === 'unknown'
                    && Object.keys(result).length === 1;
            }),
            { numRuns: RUNS },
        );
        expect(detectQrContent(Symbol('qr'))).toEqual({ type: 'unknown' });
    });
});
