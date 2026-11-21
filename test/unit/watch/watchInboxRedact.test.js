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
import { redactAddresses } from '../../../packages/core/src/watch/buildWatchInbox.js';

describe('redactAddresses', () => {
    const replacement = '[redacted]';

    it('redacts a mainnet bech32 address', () => {
        expect(redactAddresses(
            'Send to bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh now',
            replacement,
        )).toBe('Send to [redacted] now');
    });

    it('redacts a testnet legacy address while preserving its full stop', () => {
        expect(redactAddresses(
            'Send to mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn.',
            replacement,
        )).toBe('Send to [redacted].');
    });

    it('redacts a validator-accepted address below the fallback length', () => {
        expect(redactAddresses('Send to 1devmock now', replacement))
            .toBe('Send to [redacted] now');
    });

    it('redacts a 26-character ASCII alphanumeric run', () => {
        expect(redactAddresses('Token abcdefghijklmnopqrstuvwxyz.', replacement))
            .toBe('Token [redacted].');
    });

    it('leaves a 25-character ASCII alphanumeric run unchanged', () => {
        expect(redactAddresses('Token abcdefghijklmnopqrstuvwxy.', replacement))
            .toBe('Token abcdefghijklmnopqrstuvwxy.');
    });

    it('leaves text without an address unchanged', () => {
        expect(redactAddresses('Nothing sensitive here.', replacement))
            .toBe('Nothing sensitive here.');
    });
});
