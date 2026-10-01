// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
    consensusRefusalDetail,
    consensusRefusalMessage,
    isHardPreflightFinding,
} from '../../../packages/core/src/shared/utils/preflightFindingKey.js';

function refusal(status) {
    return { severity: 'error', data: { status } };
}

describe('consensusRefusalMessage', () => {
    it('maps the current price-batch trailing-data refusal', () => {
        const raw = 'invalid: trailing data after batch signatures';
        const finding = refusal(raw);
        expect(consensusRefusalMessage(finding))
            .toBe('The network refused this price batch because it contains extra data after its signatures.');
        expect(consensusRefusalMessage(finding)).not.toContain('trailing data');
    });

    it('keeps an unknown refusal out of display copy and exposes it as details', () => {
        const raw = 'invalid: future internal consensus wording';
        const finding = refusal(raw);
        expect(consensusRefusalMessage(finding))
            .toBe('The network refused this action for a reason the wallet could not explain.');
        expect(consensusRefusalDetail(finding)).toBe('future internal consensus wording');
    });

    it('hides the encoder service\'s uninformative internal error', () => {
        const finding = refusal('invalid: Internal encoder error');
        expect(consensusRefusalMessage(finding))
            .toBe('The network refused this action for a reason the wallet could not explain.');
        expect(consensusRefusalDetail(finding)).toBe('Internal encoder error');
    });

    it('keeps addresses and access-list numbers in a specific refusal', () => {
        const reason = 'address tb1qexample is not on allow-list #42';
        expect(consensusRefusalMessage(refusal(`invalid: ${reason}`)))
            .toBe('The network refused this action: Address tb1qexample is not on allow-list #42.');
    });
});

describe('isHardPreflightFinding', () => {
    const invalid = (extra) => ({ severity: 'error', ...extra });

    it('honours an explicit producer override policy either way', () => {
        expect(isHardPreflightFinding(invalid({ overridable: false }))).toBe(true);
        expect(isHardPreflightFinding(invalid({ overridable: true, data: { status: 'invalid: x' } })))
            .toBe(false);
    });

    // Sub-commands are recognised by commandIndex, never by an SDK code name,
    // so a renamed code on a per-command refusal stays acknowledgeable.
    it('keeps an unmarked per-command refusal soft whatever its code is named', () => {
        const f = invalid({ code: 'SOME_RENAMED_CODE', data: { commandIndex: 2, status: 'invalid: TICK (unknown)' } });
        expect(isHardPreflightFinding(f)).toBe(false);
    });

    it('counts batch position 0 as a sub-command', () => {
        expect(isHardPreflightFinding(invalid({ data: { commandIndex: 0, status: 'invalid: x' } }))).toBe(false);
    });

    // With no commandIndex the refusal is of the whole action, so it blocks.
    it('hard-blocks an unmarked whole-action consensus refusal', () => {
        expect(isHardPreflightFinding(invalid({ data: { status: 'invalid: x' } }))).toBe(true);
        expect(isHardPreflightFinding(invalid({
            code: 'DRYRUN_SUBCOMMAND_INVALID', data: { status: 'invalid: x' },
        }))).toBe(true);
    });

    it('never hard-blocks a non-error finding', () => {
        expect(isHardPreflightFinding({ severity: 'warning', overridable: false })).toBe(false);
    });
});
