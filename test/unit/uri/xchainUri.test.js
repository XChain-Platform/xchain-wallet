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
import {
    parseXchainUri,
    describeXchainIntent,
    hardenUriIntentText,
} from '../../../packages/core/src/uri/xchainUri.js';
import { BIDI_PLACEHOLDER } from '../../../packages/core/src/shared/utils/textHardening.js';

const RLO = String.fromCharCode(0x202E); // RIGHT-TO-LEFT OVERRIDE
const NUL = String.fromCharCode(0x0000);

// Minimal registry stub satisfying chainIdForCoinCode's contract.
const chainRegistry = {
    chainIdFor: (coin, networkKind) => `${coin}-${networkKind}`,
};

describe('parseXchainUri BIP21 req- enforcement', () => {
    // BIP21: a req- param the wallet does not implement invalidates the whole
    // URI. XChain implements none, so any req- rejects (kind:'unknown')
    // rather than silently dropping the required directive and paying a plain
    // send / applying the value as an ordinary param.
    it('rejects a coin-code URI carrying a req- param', () => {
        expect(
            parseXchainUri('xchain:TBTC/send?to=addr&amount=1&req-orderbind=42', { chainRegistry }).kind,
        ).toBe('unknown');
    });

    it('rejects a path-style URI carrying a req- param', () => {
        expect(
            parseXchainUri('xchain://bitcoin-regtest/BTC?amount=1&req-pj=https://x', { chainRegistry }).kind,
        ).toBe('unknown');
    });

    it('rejects a BIP21-style xchain: address URI carrying a req- param', () => {
        expect(
            parseXchainUri('xchain:bc1qexample?amount=1&req-somethingcritical=1', { chainRegistry }).kind,
        ).toBe('unknown');
    });

    it('still parses the same URIs without the req- param', () => {
        expect(parseXchainUri('xchain:TBTC/send?to=addr&amount=1', { chainRegistry }).kind).toBe('send');
    });
});

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

//  §3.6 finding 1: the extension QA checklist's deep-link audit found
// that memo/tick/method/params reach an editable form field carrying
// whatever a link put there - U+202E and a CRLF survive into memo, a NUL
// survives into tick. `hardenUriIntentText` is the fix, applied by every
// shell at the boundary where a parsed intent becomes prefill state
// (App.jsx boot effects, ScanRoute, Send's smart-paste), never inside
// `parseXchainUri` itself.
describe('hardenUriIntentText', () => {
    it('neutralizes a bidi override in memo rather than letting it reorder the field', () => {
        const intent = parseXchainUri(
            `xchain:TBTC/send?to=addr&amount=1&memo=${encodeURIComponent(`Pay${RLO}rent`)}`,
            { chainRegistry },
        );
        expect(intent.memo).toContain(RLO);
        const hardened = hardenUriIntentText(intent);
        expect(hardened.memo).not.toContain(RLO);
        expect(hardened.memo).toContain(BIDI_PLACEHOLDER);
    });

    it('collapses a CRLF in memo instead of letting it fake a second line', () => {
        const intent = parseXchainUri(
            `xchain:TBTC/send?to=addr&amount=1&memo=${encodeURIComponent('rent\r\nAmount: 999')}`,
            { chainRegistry },
        );
        expect(intent.memo).toContain('\r\n');
        const hardened = hardenUriIntentText(intent);
        expect(hardened.memo).not.toContain('\r');
        expect(hardened.memo).not.toContain('\n');
        expect(hardened.memo).toBe('rent Amount: 999');
    });

    it('drops a NUL from tick', () => {
        const intent = parseXchainUri(
            `xchain:TBTC/send?to=addr&amount=1&tick=${encodeURIComponent(`PEPE${NUL}COIN`)}`,
            { chainRegistry },
        );
        expect(intent.tick).toContain(NUL);
        const hardened = hardenUriIntentText(intent);
        expect(hardened.tick).not.toContain(NUL);
    });

    it('neutralizes EXECUTE method and params the same way', () => {
        const intent = parseXchainUri(
            `xchain:RBTC/execute?contract=1&method=${encodeURIComponent(`fund${RLO}evil`)}&params=${encodeURIComponent(`a${NUL}b`)}`,
            { chainRegistry },
        );
        const hardened = hardenUriIntentText(intent);
        expect(hardened.method).not.toContain(RLO);
        expect(hardened.method).toContain(BIDI_PLACEHOLDER);
        expect(hardened.executeParams).not.toContain(NUL);
    });

    it('never touches address: a hostile character stays exactly as the link sent it', () => {
        // The field is deliberately NOT neutralized - see the function's own
        // comment. A destination is validated by its own checksum before
        // signing, and mangling it here risks corrupting one that was fine.
        const hostileAddress = `bc1q${RLO}attacker`;
        const intent = parseXchainUri(
            `xchain:TBTC/send?to=${encodeURIComponent(hostileAddress)}&amount=1`,
            { chainRegistry },
        );
        const hardened = hardenUriIntentText(intent);
        expect(hardened.address).toBe(hostileAddress);
    });

    it('never touches amount: downstream decimal parsing already rejects tampering', () => {
        const hostileAmount = `1${RLO}0000`;
        const intent = parseXchainUri(
            `xchain:TBTC/send?to=addr&amount=${encodeURIComponent(hostileAmount)}`,
            { chainRegistry },
        );
        const hardened = hardenUriIntentText(intent);
        expect(hardened.amount).toBe(hostileAmount);
    });

    it('does not mutate the intent object it was given', () => {
        const intent = parseXchainUri(
            `xchain:TBTC/send?to=addr&amount=1&memo=${encodeURIComponent(`Pay${RLO}rent`)}`,
            { chainRegistry },
        );
        const before = { ...intent };
        hardenUriIntentText(intent);
        expect(intent).toEqual(before);
    });

    it('passes through kind/chainId/action untouched and leaves absent fields absent', () => {
        const intent = parseXchainUri('xchain:TBTC/receive', { chainRegistry });
        const hardened = hardenUriIntentText(intent);
        expect(hardened.kind).toBe('receive');
        expect(hardened.chainId).toBe(intent.chainId);
        expect(hardened.memo).toBeUndefined();
        expect(hardened.tick).toBeUndefined();
    });

    it('tolerates a falsy intent (defensive: callers should never pass one)', () => {
        expect(hardenUriIntentText(null)).toBe(null);
        expect(hardenUriIntentText(undefined)).toBe(undefined);
    });
});
