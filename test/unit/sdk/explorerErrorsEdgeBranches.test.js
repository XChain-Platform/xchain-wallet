// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    explorerErrorCode,
    explorerErrorMessage,
    explorerReadFailure,
    isExplorerError,
    rateLimitRetryAfterSeconds,
} from '../../../packages/core/src/sdk/explorerErrors.js';

const coded = (code, message = 'sdk explorer failure') => Object.assign(new Error(message), {
    name: 'SDKExplorerError',
    code,
});

describe('explorer error edge branches', () => {
    it('keeps typed legacy codes and supplies a safe code when the type has none', () => {
        expect(explorerErrorCode(coded('LEGACY_EXPLORER_CODE'))).toBe('LEGACY_EXPLORER_CODE');
        expect(explorerErrorCode(Object.assign(new Error('new wording'), { name: 'SDKExplorerError' })))
            .toBe('EXPLORER_UNKNOWN');
        expect(isExplorerError(coded('EXPLORER_TIMEOUT'))).toBe(true);
        expect(isExplorerError(new Error('socket failed'))).toBe(false);
    });

    it('reads the serialized millisecond wait and rounds it up', () => {
        expect(rateLimitRetryAfterSeconds({ retryAfterMs: 1_001 })).toBe(2);
        expect(rateLimitRetryAfterSeconds({ retryAfterSeconds: -1, retryAfterMs: 0 })).toBe(0);
        expect(rateLimitRetryAfterSeconds({ retryAfterMs: -1 })).toBeNull();
    });

    it('maps every non-HTTP read refusal to its actionable cause', () => {
        const cases = [
            ['COIN_DATA_STALE', 'backend_behind', /catching up/],
            ['INVALID_NETWORK', 'unknown', /supported network/],
            ['INVALID_ADDRESSES', 'unknown', /addresses/],
            ['EXPLORER_BATCH_UNSUPPORTED', 'unknown', /does not support/],
            ['WS_CONNECTION_CLOSED', 'network', /live connection/],
            ['WS_CONNECTION_FAILED', 'network', /live connection/],
            ['WS_TIMEOUT', 'network', /live connection/],
            ['EXPLORER_FUTURE_FAILURE', 'backend_behind', /could not answer/],
        ];

        for (const [code, cause, wording] of cases) {
            const result = explorerReadFailure(coded(code), 'load activity');
            expect(result).toMatchObject({ cause });
            expect(result.message).toMatch(wording);
            expect(result.message).toMatch(/^Couldn't load activity\./);
        }
    });

    it('keeps websocket and validation failures out of generic submit copy', () => {
        expect(explorerErrorMessage(coded('COIN_DATA_STALE'))).toMatch(/still catching up/);
        expect(explorerErrorMessage(coded('INVALID_NETWORK'))).toMatch(/Settings/);
        expect(explorerErrorMessage(coded('INVALID_ADDRESSES'))).toMatch(/Check the addresses/);
        expect(explorerErrorMessage(coded('EXPLORER_BATCH_UNSUPPORTED'))).toMatch(/Update the wallet/);
        expect(explorerErrorMessage(coded('WS_TIMEOUT'))).toMatch(/lost its live connection/);
    });
});
