// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Capability revoke is DELEGATE v2 (VERSION|SIGNING_PUBKEY). DELEGATE v0 is the
// rotate format and has no SIGNING_PUBKEY slot, so a revoke pinned to v0 is
// refused by the SDK before signing. The revoke composer pins v2 whatever
// VERSION its caller passed; these tests hold that, and hold it against the
// real SDK format selector rather than a copy of its table.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'tx' })),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { revokeDelegationAction, delegateAction } from '../../../packages/core/src/flows/delegateRevokeActions.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

// Resolve the SDK by its package name; a missing SDK fails the suite instead of skipping it.
const FormatSelector = createRequire(import.meta.url)('xchain-sdk/src/formatSelector.js');

const PK = 'e'.repeat(64);
const base = {
    chainRegistry: defaultRegistry(),
    chainId: 'bitcoin-regtest',
    walletId: 'w',
    from: { address: 'bcrt1qsource', publicKey: '02' + 'a'.repeat(64), derivationPath: "m/84'/1'/0'/0/0" },
};

// Pin the way the SDK's action serializer does: VERSION leaves the fields and becomes the explicit version.
/** @param {Record<string, string>} params */
function selectLikeSerializer(params) {
    const { VERSION, ...fields } = params;
    return FormatSelector.select('DELEGATE', fields, VERSION);
}

/** @returns {{ action: string, params: Record<string, string> }} */
function lastActionData() {
    const calls = vi.mocked(submitAction).mock.calls;
    return calls[calls.length - 1][0].actionData;
}

describe('revokeDelegationAction wire version', () => {
    beforeEach(() => { vi.mocked(submitAction).mockClear(); });

    it('sends DELEGATE v2 when the caller passed a stale VERSION 0', async () => {
        await revokeDelegationAction({ ...base, params: { VERSION: '0', SIGNING_PUBKEY: PK } });
        expect(lastActionData()).toEqual({ action: 'DELEGATE', params: { VERSION: '2', SIGNING_PUBKEY: PK } });
    });

    it('sends DELEGATE v2 when the caller passed no VERSION', async () => {
        await revokeDelegationAction({ ...base, params: { SIGNING_PUBKEY: PK } });
        expect(lastActionData().params.VERSION).toBe('2');
    });

    it('leaves the rotate composer on DELEGATE v0', async () => {
        await delegateAction({ ...base, params: { VERSION: '0', NEW_SIGNING_PUBKEY: PK } });
        expect(lastActionData().params).toMatchObject({ VERSION: '0', NEW_SIGNING_PUBKEY: PK });
    });
});

describe('revoke params against the real SDK format selector', () => {
    it('accepts the composed v2 revoke', async () => {
        vi.mocked(submitAction).mockClear();
        await revokeDelegationAction({ ...base, params: { VERSION: '0', SIGNING_PUBKEY: PK } });
        const { version } = selectLikeSerializer(lastActionData().params);
        expect(String(version)).toBe('2');
    });

    it('refuses a revoke pinned to v0, which is why the composer must not pass one through', () => {
        expect(() => selectLikeSerializer({ VERSION: '0', SIGNING_PUBKEY: PK }))
            .toThrow(/no slot for SIGNING_PUBKEY/);
    });
});
