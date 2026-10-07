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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
    emptyPolicyDraft,
    buildPolicyDraft,
    draftFromAccount,
    CoSignerPolicyEditor,
} from '../../../packages/core/src/shared/routes/CoSignerPolicyEditor.jsx';
import { createCoSignerAccount } from '../../../packages/core/src/schemas/coSignerAccount.js';
import { BITCOIN_ACTIONS } from '../../../packages/core/src/registry/actions.js';
import { actionDisplayLabel } from '../../../packages/core/src/shared/utils/actionDisplayLabel.js';

const AGENT = '02' + 'a'.repeat(64);
const DAEMON = '02' + 'b'.repeat(64);

afterEach(() => cleanup());

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

    it('case-folds ticker cap keys without losing prototype-shaped names', () => {
        const out = buildPolicyDraft({
            ...emptyPolicyDraft(),
            allowedActionsText: 'SEND',
            maxPerAction: [{ action: 'SEND', tick: 'mixed', cap: '1' }],
            windowEnabled: true,
            windowHours: '24',
            windowPerTick: [{ tick: '__proto__', cap: '2' }],
            confirmAbove: [{ tick: 'c#', amount: '3' }],
        });

        expect(out.policy.maxPerAction.SEND.MIXED).toBe('1');
        expect(out.policy.maxPerWindow.perTick.__PROTO__).toBe('2');
        expect(out.policy.confirmAbove.perTick['C#']).toBe('3');
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

// The stored keys are protocol wire names and stay that way, but the owner
// must be able to connect what they type here to what CoSignerAccountDetail
// shows them ("Send, Issue"). These pin the echo, not the storage.
describe('CoSignerPolicyEditor allowed-actions vocabulary', () => {
    const draftWith = (allowedActionsText) => ({ ...emptyPolicyDraft(), allowedActionsText });

    it('echoes the typed actions in the words the account detail screen uses', () => {
        render(<CoSignerPolicyEditor value={draftWith('SEND, ISSUE')} onChange={() => {}} />);
        const preview = screen.getByTestId('allowed-actions-preview');
        expect(preview.textContent).toContain('Send, Issue');
        expect(preview.textContent).not.toContain('not a known action');
    });

    it('names a protocol action the user would otherwise have to know by opcode', () => {
        render(<CoSignerPolicyEditor value={draftWith('COINPAY')} onChange={() => {}} />);
        expect(screen.getByTestId('allowed-actions-preview').textContent).toContain('Coin payment');
    });

    it('marks an unrecognized name instead of humanizing it into a plausible label', () => {
        render(<CoSignerPolicyEditor value={draftWith('SEND, SENDD')} onChange={() => {}} />);
        const preview = screen.getByTestId('allowed-actions-preview');
        expect(preview.textContent).toContain('SENDD (not a known action)');
        expect(preview.textContent).not.toContain('Sendd,');
    });

    it('renders no echo at all until something is typed', () => {
        render(<CoSignerPolicyEditor value={emptyPolicyDraft()} onChange={() => {}} />);
        expect(screen.queryByTestId('allowed-actions-preview')).toBeNull();
    });

    it('asks the owner to tick labelled actions instead of typing protocol codes', () => {
        const { container } = render(<CoSignerPolicyEditor value={emptyPolicyDraft()} onChange={() => {}} />);
        const fieldset = container.querySelector('fieldset');
        expect(fieldset.querySelector('legend').textContent).toBe('Allowed actions');
        expect(fieldset.querySelector('textarea')).toBeNull();
        expect(fieldset.textContent).not.toContain('SEND for');
        expect(fieldset.textContent).not.toContain('SEND, ISSUE');
    });

    it('still stores the raw protocol key, never the display label', () => {
        const out = buildPolicyDraft(draftWith('SEND, COINPAY'));
        expect(out.policy.allowedActions).toEqual(['SEND', 'COINPAY']);
    });
});

// A per-action limit keyed on a name the agent may not sign never binds (the
// co-signer matches caps by exact name), so the row is a picker over the
// allowed list and a stray key blocks save instead of saving as a dead cap.
describe('CoSignerPolicyEditor per-action limit actions', () => {
    const withLimit = (allowedActionsText, action) => ({
        ...emptyPolicyDraft(),
        allowedActionsText,
        maxPerAction: [{ action, tick: '*', cap: '100' }],
    });

    it('refuses a limit on a mistyped action name', () => {
        expect(buildPolicyDraft(withLimit('SEND', 'SENDD')).error).toMatch(/SENDD.*allowed action/);
    });

    it('refuses a limit on a real action the agent is not allowed to sign', () => {
        expect(buildPolicyDraft(withLimit('SEND', 'ISSUE')).error).toMatch(/ISSUE.*allowed action/);
    });

    it('keeps the protocol name as the stored limit key', () => {
        const out = buildPolicyDraft({ ...withLimit('SEND, COINPAY', 'COINPAY'), maxPerAction: [{ action: 'COINPAY', tick: '*', cap: '1' }] });
        expect(out.error).toBeUndefined();
        expect(out.policy.maxPerAction).toEqual({ COINPAY: { '*': '1' } });
    });

    it('offers the allowed actions in words, valued by protocol name', () => {
        render(<CoSignerPolicyEditor value={withLimit('SEND, ISSUE', '')} onChange={() => {}} />);
        const select = screen.getByLabelText('Action');
        expect(select.tagName).toBe('SELECT');
        expect([...select.options].map((o) => o.value)).toEqual(['', 'SEND', 'ISSUE']);
        expect([...select.options].map((o) => o.textContent)).toEqual(['Choose an action', 'Send', 'Issue']);
    });

    it('shows a stored stray key as flagged rather than silently as another option', () => {
        render(<CoSignerPolicyEditor value={withLimit('SEND', 'SENDD')} onChange={() => {}} />);
        const select = screen.getByLabelText('Action');
        expect(select.value).toBe('SENDD');
        expect(document.body.textContent).toContain('SENDD (not in the allowed actions above)');
        expect(screen.getByRole('alert').textContent).toMatch(/won't apply/);
    });

    it('writes the chosen protocol name back into the draft', () => {
        const onChange = vi.fn();
        render(<CoSignerPolicyEditor value={withLimit('SEND, ISSUE', '')} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'ISSUE' } });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0].maxPerAction[0].action).toBe('ISSUE');
    });
});

// The picker writes raw protocol keys into allowedActionsText, so the stored
// policy is byte-identical to what typing produced; these pin every toggle path.
describe('CoSignerPolicyEditor allowed-actions picker', () => {
    const draftWith = (allowedActionsText) => ({ ...emptyPolicyDraft(), allowedActionsText });
    const allowedAfter = (onChange) => buildPolicyDraft(onChange.mock.calls[0][0]).policy.allowedActions;

    it('renders one checkbox per known action, each named by its display label', () => {
        render(<CoSignerPolicyEditor value={emptyPolicyDraft()} onChange={() => {}} />);
        for (const key of BITCOIN_ACTIONS) {
            const box = screen.getByRole('checkbox', { name: actionDisplayLabel(key) });
            expect(box.checked).toBe(false);
        }
        expect(screen.getByRole('checkbox', { name: 'Coin payment' })).toBeTruthy();
    });

    it('ticking an action appends its raw key', () => {
        const onChange = vi.fn();
        render(<CoSignerPolicyEditor value={draftWith('SEND')} onChange={onChange} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Issue' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(allowedAfter(onChange)).toEqual(['SEND', 'ISSUE']);
    });

    it('unticking an action removes only that key and keeps an unknown one in place', () => {
        const onChange = vi.fn();
        render(<CoSignerPolicyEditor value={draftWith('SEND, SENDD, ISSUE')} onChange={onChange} />);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Issue' }));
        expect(allowedAfter(onChange)).toEqual(['SEND', 'SENDD']);
    });

    it('flags an unknown stored key with its own Remove button that drops only it', () => {
        const onChange = vi.fn();
        render(<CoSignerPolicyEditor value={draftWith('SEND, SENDD')} onChange={onChange} />);
        expect(screen.getByTestId('allowed-actions-preview').textContent).toContain('SENDD (not a known action)');
        fireEvent.click(screen.getByRole('button', { name: 'Remove SENDD' }));
        expect(allowedAfter(onChange)).toEqual(['SEND']);
    });

    it('pre-ticks exactly the stored actions of an existing account', () => {
        const account = createCoSignerAccount({
            walletId: 'w1',
            chainId: 'bitcoin-regtest',
            aggregateAddress: 'bcrt1pagg',
            agentPubkey: AGENT,
            daemonPubkey: DAEMON,
            daemonDerivationPath: "m/86'/0'/0'/0/0",
            publicKeyOrder: [AGENT.toLowerCase(), DAEMON.toLowerCase()],
            policy: { allowedActions: ['SEND', 'ISSUE'] },
        });
        render(<CoSignerPolicyEditor value={draftFromAccount(account)} onChange={() => {}} />);
        const ticked = screen.getAllByRole('checkbox').filter((b) => b.checked);
        expect(ticked.map((b) => b.getAttribute('value')).sort()).toEqual(['ISSUE', 'SEND']);
    });

    it('keeps a lowercase typed key ticked under its canonical name', () => {
        const onChange = vi.fn();
        render(<CoSignerPolicyEditor value={draftWith('send')} onChange={onChange} />);
        expect(screen.getByRole('checkbox', { name: 'Send' }).checked).toBe(true);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Send' }));
        expect(onChange.mock.calls[0][0].allowedActionsText).toBe('');
    });
});
