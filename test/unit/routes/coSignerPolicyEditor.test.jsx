// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: CoSignerPolicyEditor draft <-> policy helpers (§22, P4 management).
// The editor UI is exercised via the routes-render smoke; here we pin the
// pure translation that turns UI-friendly rows into the stored policy shape
// and back, since that is where policy-shape bugs would hide.

import { describe, it, expect } from 'vitest';
import {
    emptyPolicyDraft,
    buildPolicyDraft,
    draftFromAccount,
} from '../../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';

const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);

describe('CoSignerPolicyEditor helpers', () => {
    it('requires at least one allowed action', () => {
        const out = buildPolicyDraft(emptyPolicyDraft());
        expect(out.error).toMatch(/allowed action/i);
    });

    it('builds a full policy, uppercasing actions and dropping empty optionals', () => {
        const draft = {
            ...emptyPolicyDraft(),
            allowedActionsText: 'send, issue send',
            maxPerAction: [{ action: 'send', tick: '*', cap: '100' }],
            windowEnabled: true,
            windowHours: '24',
            windowMaxActions: '5',
            windowPerTick: [{ tick: 'XCHAIN', cap: '1000' }],
            confirmAbove: [{ tick: 'XCHAIN', amount: '500' }],
            allowedDestinations: [{ address: 'bc1qdest' }, { address: '' }],
            allowedOutputs: [{ address: 'bc1qout', maxValue: '2000' }, { address: '', maxValue: '' }],
        };
        const out = buildPolicyDraft(draft);
        expect(out.error).toBeUndefined();
        expect(out.policy.allowedActions).toEqual(['SEND', 'ISSUE']); // deduped, uppercased
        expect(out.policy.maxPerAction).toEqual({ SEND: { '*': '100' } });
        expect(out.policy.maxPerWindow).toEqual({ hours: 24, maxActions: 5, perTick: { XCHAIN: '1000' } });
        expect(out.policy.confirmAbove).toEqual({ perTick: { XCHAIN: '500' } });
        expect(out.policy.allowedDestinations).toEqual(['bc1qdest']);
        expect(out.allowedOutputs).toEqual([{ address: 'bc1qout', maxValue: 2000 }]);
    });

    it('leaves optionals null when nothing is entered', () => {
        const out = buildPolicyDraft({ ...emptyPolicyDraft(), allowedActionsText: 'SEND' });
        expect(out.policy.maxPerAction).toBeNull();
        expect(out.policy.maxPerWindow).toBeNull();
        expect(out.policy.confirmAbove).toBeNull();
        expect(out.policy.allowedDestinations).toBeNull();
        expect(out.allowedOutputs).toEqual([]);
    });

    it('flags an incomplete per-action row and a zero-length window', () => {
        expect(buildPolicyDraft({ ...emptyPolicyDraft(), allowedActionsText: 'SEND', maxPerAction: [{ action: 'SEND', tick: '*', cap: '' }] }).error)
            .toMatch(/amount/i);
        expect(buildPolicyDraft({ ...emptyPolicyDraft(), allowedActionsText: 'SEND', windowEnabled: true, windowHours: '0' }).error)
            .toMatch(/hours/i);
    });

    it('round-trips a stored account back into a draft', () => {
        const account = createCoSignerAccount({
            walletId: 'w1',
            chainId: 'bitcoin-regtest',
            aggregateAddress: 'bcrt1pagg',
            agentPubkey: AGENT,
            daemonPubkey: DAEMON,
            daemonDerivationPath: "m/86'/0'/0'/0/0",
            publicKeyOrder: [AGENT.toLowerCase(), DAEMON.toLowerCase()],
            policy: {
                allowedActions: ['SEND', 'ISSUE'],
                allowedDestinations: ['bc1qdest'],
                maxPerAction: { SEND: { '*': '100' } },
                maxPerWindow: { hours: 24, maxActions: 5 },
                confirmAbove: { perTick: { XCHAIN: '500' } },
            },
            allowedOutputs: [{ address: 'bc1qout', maxValue: 2000 }],
        });

        const draft = draftFromAccount(account);
        const rebuilt = buildPolicyDraft(draft);
        expect(rebuilt.error).toBeUndefined();
        expect(rebuilt.policy.allowedActions).toEqual(account.policy.allowedActions);
        expect(rebuilt.policy.maxPerAction).toEqual(account.policy.maxPerAction);
        expect(rebuilt.policy.maxPerWindow).toEqual(account.policy.maxPerWindow);
        expect(rebuilt.policy.confirmAbove).toEqual(account.policy.confirmAbove);
        expect(rebuilt.policy.allowedDestinations).toEqual(account.policy.allowedDestinations);
        expect(rebuilt.allowedOutputs).toEqual(account.allowedOutputs);
    });
});
