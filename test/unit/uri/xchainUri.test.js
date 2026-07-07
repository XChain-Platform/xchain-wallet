// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: xchain: URI parser, focused on the `execute` action (explorer
// Write-tab deep links, protocol/XChain_URI_Scheme.md) and the
// chainRegistry-dependent coin-code resolution both shells rely on.

import { describe, it, expect } from 'vitest';
import { parseXchainUri, describeXchainIntent } from '../../../packages/core/src/uri/xchainUri.js';

// Minimal registry stub satisfying chainIdForCoinCode's contract.
const chainRegistry = {
    chainIdFor: (coin, networkKind) => `${coin}-${networkKind}`,
};

describe('parseXchainUri execute action', () => {

    it('parses contract, method, params, and gas from an execute URI', () => {
        const intent = parseXchainUri(
            'xchain:RBTC/execute?contract=362&method=fund&params=alice%7C1000&gas=75000',
            { chainRegistry },
        );
        expect(intent.kind).toBe('execute');
        expect(intent.chainId).toBe('bitcoin-regtest');
        expect(intent.contractActionIndex).toBe('362');
        expect(intent.method).toBe('fund');
        expect(intent.executeParams).toBe('alice|1000');
        expect(intent.gasLimit).toBe('75000');
    });

    it('round-trips pipe separators through percent-encoding', () => {
        const params = 'a|b c|{"j":1}';
        const intent = parseXchainUri(
            `xchain:TBTC/execute?contract=5&method=m&params=${encodeURIComponent(params)}`,
            { chainRegistry },
        );
        expect(intent.executeParams).toBe(params);
    });

    it('still parses (kind execute) without contract=; callers must guard', () => {
        const intent = parseXchainUri('xchain:RBTC/execute?method=fund', { chainRegistry });
        expect(intent.kind).toBe('execute');
        expect(intent.contractActionIndex).toBeUndefined();
    });

    it('resolves chainId only when a registry is supplied (both shells must pass one)', () => {
        const withReg = parseXchainUri('xchain:TDOGE/execute?contract=1&method=m', { chainRegistry });
        expect(withReg.chainId).toBe('dogecoin-testnet');
        const withoutReg = parseXchainUri('xchain:TDOGE/execute?contract=1&method=m');
        expect(withoutReg.chainId).toBeUndefined();
    });

    it('leaves send/receive routing untouched', () => {
        expect(parseXchainUri('xchain:TBTC/send?to=x&amount=1', { chainRegistry }).kind).toBe('send');
        expect(parseXchainUri('xchain:TBTC/receive', { chainRegistry }).kind).toBe('receive');
    });

    it('does not leak send-shaped fields (tick/to/amount/memo) into an execute intent', () => {
        const intent = parseXchainUri(
            'xchain:RBTC/execute?contract=9&method=m&tick=PEPECREATURE&to=bcrt1qattacker&amount=99&memo=hi',
            { chainRegistry },
        );
        expect(intent.kind).toBe('execute');
        expect(intent.tick).toBeUndefined();
        expect(intent.address).toBeUndefined();
        expect(intent.amount).toBeUndefined();
        expect(intent.memo).toBeUndefined();
        expect(intent.contractActionIndex).toBe('9');
    });

    it('drops a non-numeric contract index and gas limit (falls back to the manual form)', () => {
        const intent = parseXchainUri(
            'xchain:RBTC/execute?contract=<script>&method=m&gas=lots',
            { chainRegistry },
        );
        expect(intent.kind).toBe('execute');
        expect(intent.contractActionIndex).toBeUndefined();
        expect(intent.gasLimit).toBeUndefined();
    });

    it('drops a malformed raw chainId from legacy path-style and BIP21 chain= input', () => {
        const pathStyle = parseXchainUri('xchain://not a chain id!/PEPECREATURE?amount=1');
        expect(pathStyle.kind).toBe('send');
        expect(pathStyle.chainId).toBeUndefined();
        const legacyOk = parseXchainUri('xchain://bitcoin-regtest/PEPECREATURE?amount=1');
        expect(legacyOk.chainId).toBe('bitcoin-regtest');
    });

    it('describes execute intents for confirmation copy', () => {
        const t = (key, vars) => `${key}:${JSON.stringify(vars || {})}`;
        const withMethod = parseXchainUri('xchain:RBTC/execute?contract=7&method=claim', { chainRegistry });
        expect(describeXchainIntent(withMethod, { i18n: { t } }))
            .toBe('uri.intent.executeMethod:{"contract":"7","method":"claim"}');
        const noMethod = parseXchainUri('xchain:RBTC/execute?contract=7', { chainRegistry });
        expect(describeXchainIntent(noMethod, { i18n: { t } }))
            .toBe('uri.intent.execute:{"contract":"7"}');
        const noContract = parseXchainUri('xchain:RBTC/execute', { chainRegistry });
        expect(describeXchainIntent(noContract, { i18n: { t } }))
            .toBe('uri.intent.unknown:{}');
    });
});
