// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: signer capability for Taproot envelope reveals ( §6, ).
//
// The asymmetry is the whole point. A false negative costs the user the envelope
// and falls back to P2WSH at roughly 2x the bytes. A false POSITIVE funds a
// one-time P2TR commit whose reveal cannot be signed, which §6 calls a
// stranded-funds event rather than an error message. So the tests that matter
// most here are the ones proving unknown inputs answer NO.

import { describe, it, expect } from 'vitest';
import {
    signerSupportsTapscript,
    encoderSignerOptions,
    TAPSCRIPT_CAPABLE_SOURCES,
} from '../../../packages/core/src/flows/signerCapability.js';

describe('signerSupportsTapscript', () => {
    it('accepts the two sources that actually hand over a private key', () => {
        expect(signerSupportsTapscript({ source: 'hd' })).toBe(true);
        expect(signerSupportsTapscript({ source: 'imported-wif' })).toBe(true);
    });

    it('refuses hardware and watch-only', () => {
        // no shipping firmware signs a tapscript path through this integration,
        // and watch-only has no key at all
        expect(signerSupportsTapscript({ source: 'trezor' })).toBe(false);
        expect(signerSupportsTapscript({ source: 'ledger' })).toBe(false);
        expect(signerSupportsTapscript({ source: 'watch-only' })).toBe(false);
    });

    it('FAILS CLOSED on anything it has never heard of', () => {
        // a future source must default to "cannot sign", because the cost of the
        // wrong answer in this direction is the user's coin
        for (const source of ['airgap', 'multisig', 'ledger-v2', 'HD', 'hd ', '', 'musig2'])
            expect(signerSupportsTapscript({ source })).toBe(false);
    });

    it('FAILS CLOSED on malformed or missing input', () => {
        for (const bad of [null, undefined, {}, { source: null }, { source: 42 },
                           { source: ['hd'] }, 'hd', 42, []])
            expect(signerSupportsTapscript(bad)).toBe(false);
    });

    it('returns a real boolean, never a truthy value the caller might mis-read', () => {
        expect(signerSupportsTapscript({ source: 'hd' })).toStrictEqual(true);
        expect(signerSupportsTapscript({ source: 'trezor' })).toStrictEqual(false);
    });

    it('the allow-list is frozen, so a stray push cannot widen it at runtime', () => {
        expect(() => TAPSCRIPT_CAPABLE_SOURCES.push('trezor')).toThrow();
        expect(signerSupportsTapscript({ source: 'trezor' })).toBe(false);
    });
});

describe('encoderSignerOptions', () => {
    it('spells the SDK key exactly, because a typo silently disables the envelope', () => {
        expect(encoderSignerOptions({ source: 'hd' })).toEqual({ signerSupportsTapscript: true });
        expect(Object.keys(encoderSignerOptions({ source: 'hd' }))).toEqual(['signerSupportsTapscript']);
    });

    it('asserts nothing for an account that cannot sign', () => {
        expect(encoderSignerOptions({ source: 'trezor' })).toEqual({ signerSupportsTapscript: false });
        expect(encoderSignerOptions(null)).toEqual({ signerSupportsTapscript: false });
    });
});
