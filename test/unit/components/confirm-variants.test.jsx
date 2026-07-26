// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  §5.5: the two NON-action confirm variants.
//
// The action variant confirms something the wallet composed, so its intent
// summary is authoritative. Neither of these is that:
//
//   PSBT variant    - the wallet did not build these bytes. What a hostile
//                     PSBT steals with is the OUTPUT SET, so the full
//                     input/output enumeration is the foregrounded content,
//                     pre-flight is report-only (nothing to rebuild), and a
//                     wallet-spending PSBT whose action will not decode is
//                     REFUSED outright rather than warned about.
//   message variant - nothing is broadcast and no coins move. The signed
//                     bytes are the text itself, so the text is shown
//                     verbatim and the transaction-shaped furniture
//                     (deltas, pre-flight, the hardware-outputs caveat)
//                     is absent, not empty.

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { PsbtIntentPanel } from '../../../packages/core/src/shared/components/PsbtIntentPanel.jsx';
import { psbtRefusalReason } from '../../../packages/core/src/shared/components/PsbtConfirmScreen.jsx';
import { isUnreadableActionReason } from '../../../packages/core/src/shared/components/psbtDecodeReasons.js';
import { canApproveWithReport, toggleAcknowledged } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

const OWN = 'bc1qownownownownownownownownownownownowno';
const OTHER = 'bc1qotherotherotherotherotherotherotherx';
const THIRD = 'bc1qthirdthirdthirdthirdthirdthirdthirdxx';

const DECOMPOSED = Object.freeze({
    inputs: [
        { address: OWN, value: 100000 },
        { address: THIRD, value: 50000 },
    ],
    outputs: [
        { address: OTHER, value: 120000 },
        { address: OWN, value: 25000 },
        { address: null, value: 0 },
    ],
});

function modalProps(overrides = {}) {
    return {
        phase: 'ready',
        composed: {},
        report: null,
        reportLoading: false,
        acknowledged: new Set(),
        onAcknowledge() {},
        canApprove: true,
        onApprove: vi.fn(),
        onReject: vi.fn(),
        decoded: null,
        chainLabel: 'Bitcoin',
        credentials: React.createElement('div', { 'data-testid': 'creds' }, 'creds'),
        credentialsReady: true,
        ...overrides,
    };
}

describe('§5.5 PsbtIntentPanel: the output set is the foregrounded content', () => {
    it('enumerates every input and output, marking own vs external and which key signs', () => {
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: DECOMPOSED,
            ownAddresses: new Set([OWN]),
            signingAddress: OWN,
            decodedAction: { summary: 'Carries an XChain SEND action (v0)' },
        }));
        const text = utils.container.textContent;

        // Every input and output is accounted for, not just totals.
        expect(text).toContain('Inputs (2)');
        expect(text).toContain('Outputs (3)');
        expect(text).toContain('Signs with your key');
        expect(text).toContain('Other signer');
        expect(text).toContain('Recipient');
        expect(text).toContain('Change (back to you)');
        // A non-address output is named, never silently dropped.
        expect(text).toContain('(data / non-address output)');
    });

    it('computes the fee from inputs minus outputs and states what leaves the wallet', () => {
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: DECOMPOSED,
            ownAddresses: new Set([OWN]),
            signingAddress: OWN,
            decodedAction: { summary: 'x' },
        }));
        const text = utils.container.textContent;
        // 150,000 in - 145,000 out = 5,000 fee. Only the external output (and
        // the valueless data output) count as leaving; change does not.
        expect(text).toContain('5,000 sats');
        expect(text).toContain('120,000 sats');
    });

    it('reports an unavailable fee instead of guessing when an input value is missing', () => {
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: {
                inputs: [{ address: OWN }],
                outputs: [{ address: OTHER, value: 1000 }],
            },
            ownAddresses: new Set([OWN]),
            decodedAction: { summary: 'x' },
        }));
        const text = utils.container.textContent;
        expect(text).toContain('amount unknown');
        expect(text).toContain('unavailable');
    });

    it('fails LOUD when the action data is present but cannot be read', () => {
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: DECOMPOSED,
            ownAddresses: new Set([OWN]),
            decodedAction: null,
            decodeError: 'P2SH_P2WSH_UNSUPPORTED',
        }));
        const alert = utils.getByTestId('psbt-action-undecoded');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toContain('P2SH_P2WSH_UNSUPPORTED');
        // The output set is still enumerated: an unreadable action is exactly
        // when the user most needs to see where the coins go.
        expect(utils.container.textContent).toContain('Outputs (3)');
    });

    it('states an ordinary payment plainly instead of crying wolf', () => {
        // NO_OP_RETURN means there is no XChain action at all. Alerting here
        // would train the user to click through the warnings that DO matter.
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: DECOMPOSED,
            ownAddresses: new Set([OWN]),
            decodedAction: null,
            decodeError: 'NO_OP_RETURN',
        }));
        expect(utils.queryByTestId('psbt-action-undecoded')).toBe(null);
        expect(utils.getByTestId('psbt-action-none').textContent).toMatch(/ordinary payment/i);
        expect(utils.container.querySelectorAll('[role="alert"]').length).toBe(0);
    });

    it('fails LOUD when the transaction will not decompose at all', () => {
        const utils = render(React.createElement(PsbtIntentPanel, { decomposed: null }));
        expect(utils.getByTestId('psbt-undecodable').getAttribute('role')).toBe('alert');
    });
});

describe('§5.5 fail-closed refusal rule', () => {
    it('refuses a wallet-spending PSBT that carries an UNREADABLE action', () => {
        expect(psbtRefusalReason({
            spendsOwnInputs: true,
            actionDecoded: false,
            decodeReason: 'P2SH_P2WSH_UNSUPPORTED',
            developerMode: false,
        })).toMatch(/will not sign/i);
    });

    it('allows it once the action decodes', () => {
        expect(psbtRefusalReason({
            spendsOwnInputs: true, actionDecoded: true, developerMode: false,
        })).toBe(null);
    });

    it('does not refuse when the PSBT spends none of our inputs', () => {
        // Nothing of ours is at risk, so an unreadable action is the caller's
        // problem, not a reason to block.
        expect(psbtRefusalReason({
            spendsOwnInputs: false,
            actionDecoded: false,
            decodeReason: 'P2SH_P2WSH_UNSUPPORTED',
            developerMode: false,
        })).toBe(null);
    });

    it('yields to developer mode, the documented inspect-and-sign escape hatch', () => {
        expect(psbtRefusalReason({
            spendsOwnInputs: true,
            actionDecoded: false,
            decodeReason: 'P2SH_P2WSH_UNSUPPORTED',
            developerMode: true,
        })).toBe(null);
    });

    // The false-block invariant (§4.2) applied to the refusal. An ordinary
    // payment PSBT has no XChain action AT ALL, which decodeActionFromPsbt
    // reports the same way it reports a punt: as `ok: false`. Refusing on that
    // would block the most common thing a PSBT signing surface does.
    it('does NOT refuse an ordinary payment that spends our own inputs', () => {
        for (const reason of ['NO_OP_RETURN', 'NO_MAGIC_WORD']) {
            expect(psbtRefusalReason({
                spendsOwnInputs: true,
                actionDecoded: false,
                decodeReason: reason,
                developerMode: false,
            }), `reason ${reason} must not refuse`).toBe(null);
        }
    });

    it('does not refuse when no reason was reported at all', () => {
        // Absence of information is not evidence an action is hidden; refusing
        // here would block every signing on a host that reports no reason.
        expect(psbtRefusalReason({
            spendsOwnInputs: true, actionDecoded: false, decodeReason: null, developerMode: false,
        })).toBe(null);
    });

    it('classifies present-but-unreadable reasons apart from absent ones', () => {
        expect(isUnreadableActionReason('NO_OP_RETURN')).toBe(false);
        expect(isUnreadableActionReason('NO_MAGIC_WORD')).toBe(false);
        expect(isUnreadableActionReason(null)).toBe(false);
        for (const reason of [
            'P2SH_P2WSH_UNSUPPORTED', 'MULTI_OP_RETURN', 'DEOBFUSCATION_FAILED',
            'OVERSIZED', 'NOT_UTF8', 'UNKNOWN_ACTION', 'REST_FIELD_UNSUPPORTED',
            'MULTI_LEG_UNSUPPORTED', 'FIELD_COUNT_MISMATCH',
        ]) {
            expect(isUnreadableActionReason(reason), reason).toBe(true);
        }
    });
});

// §5.2.5: the fee section shows what the composed PSBT actually pays. The
// caller's feeText is a rate-table estimate and must lose to the exact value.
describe('§5.2.5 exact fee beats the caller estimate', () => {
    function screenProps(composed) {
        return {
            confirmAction: {
                phase: 'ready',
                composed,
                report: null,
                acknowledged: new Set(),
                acknowledge() {},
                canApprove: true,
                approve() {},
                reject() {},
                error: null,
            },
            decoded: { summary: 'Send 1 JDOG', details: [], warnings: [] },
            chainLabel: 'Bitcoin',
            signerReady: true,
            password: '',
            onPasswordChange() {},
        };
    }

    it('renders the PSBT fee, converted from sats, with the chain ticker', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({ networkFeeSats: 5900, chainId: 'bitcoin-mainnet' }),
            feeText: 'Network fee: 0.00042 BTC (estimate)',
        }));
        expect(utils.getByTestId('confirm-fee').textContent).toBe('Network fee: 0.000059 BTC');
        // The estimate must not also appear; two fee numbers is worse than one.
        expect(utils.container.textContent).not.toContain('0.00042');
    });

    it('falls back to the caller estimate when the exact fee is unknowable', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({ networkFeeSats: null, chainId: 'bitcoin-mainnet' }),
            feeText: 'Network fee: 0.00042 BTC',
        }));
        expect(utils.getByTestId('confirm-fee').textContent).toBe('Network fee: 0.00042 BTC');
    });

    it('resolves the ticker from the envelope chain, not the caller', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({ networkFeeSats: 100000000, chainId: 'dogecoin-mainnet' }),
        }));
        expect(utils.getByTestId('confirm-fee').textContent).toBe('Network fee: 1 DOGE');
    });
});

describe('§4.2 Approve gate is ONE predicate across surfaces', () => {
    const err = (over) => ({ code: 'X', severity: 'error', overridable: over });

    it('allows when there is no report', () => {
        expect(canApproveWithReport(null, new Set())).toBe(true);
    });

    it('hard-blocks a non-overridable error regardless of acknowledgement', () => {
        const report = { findings: [err(false)] };
        expect(canApproveWithReport(report, new Set())).toBe(false);
        expect(canApproveWithReport(report, new Set(['X']))).toBe(false);
    });

    it('blocks a network-sourced error until that exact code is acknowledged', () => {
        const report = { findings: [err(true)] };
        expect(canApproveWithReport(report, new Set())).toBe(false);
        expect(canApproveWithReport(report, new Set(['Y']))).toBe(false);
        expect(canApproveWithReport(report, new Set(['X']))).toBe(true);
    });

    it('ignores warnings and info', () => {
        const report = {
            findings: [
                { code: 'W', severity: 'warning' },
                { code: 'I', severity: 'info' },
            ],
        };
        expect(canApproveWithReport(report, new Set())).toBe(true);
    });

    // Found by driving the real gate on regtest: an over-balance token send
    // produces TWO overridable errors (Tier-1 DRYRUN_INVALID and Tier-2
    // BALANCE_INSUFFICIENT, which constants.js registers as `network` because
    // it is only as trustworthy as the explorer balance it read).
    it('requires EVERY overridable error to be acknowledged, not just one', () => {
        const report = {
            findings: [
                { code: 'DRYRUN_INVALID', severity: 'error', overridable: true },
                { code: 'BALANCE_INSUFFICIENT', severity: 'error', overridable: true },
            ],
        };
        expect(canApproveWithReport(report, new Set(['DRYRUN_INVALID']))).toBe(false);
        expect(canApproveWithReport(report, new Set(['BALANCE_INSUFFICIENT']))).toBe(false);
        expect(canApproveWithReport(report,
            new Set(['DRYRUN_INVALID', 'BALANCE_INSUFFICIENT']))).toBe(true);
    });
});

// The override is rendered as a CHECKBOX, and both surfaces used to add to the
// acknowledged set without ever removing from it - so a stray click on "Sign
// anyway", beside a finding saying the network expects this to fail, could
// never be withdrawn. Caught by the regtest gate walk.
describe('§4.2 acknowledgement is reversible', () => {
    it('toggles a code in and out of the set', () => {
        const once = toggleAcknowledged(new Set(), 'DRYRUN_INVALID');
        expect(once.has('DRYRUN_INVALID')).toBe(true);
        expect(toggleAcknowledged(once, 'DRYRUN_INVALID').has('DRYRUN_INVALID')).toBe(false);
    });

    it('leaves other acknowledgements alone and does not mutate the input', () => {
        const prev = new Set(['A', 'B']);
        const next = toggleAcknowledged(prev, 'A');
        expect([...next]).toEqual(['B']);
        expect([...prev]).toEqual(['A', 'B']);
    });

    it('un-acknowledging re-blocks Approve', () => {
        const report = { findings: [{ code: 'A', severity: 'error', overridable: true }] };
        const acked = toggleAcknowledged(new Set(), 'A');
        expect(canApproveWithReport(report, acked)).toBe(true);
        expect(canApproveWithReport(report, toggleAcknowledged(acked, 'A'))).toBe(false);
    });
});

describe('§5.5 ConfirmActionModal: PSBT variant', () => {
    it('foregrounds the supplied PSBT panel and still shows the report', () => {
        const utils = render(React.createElement(ConfirmActionModal, modalProps({
            variant: 'psbt',
            headline: 'Sign transaction',
            psbtPanel: React.createElement('div', { 'data-testid': 'the-panel' }, 'panel'),
            report: { verdict: 'warn', findings: [], unverified: [] },
        })));
        expect(utils.getByTestId('the-panel')).toBeTruthy();
        // Report-only means visible-but-not-blocking, not hidden.
        expect(utils.getByTestId('confirm-approve').disabled).toBe(false);
    });

    it('a refusal blocks Approve, hides the credentials, and cannot be clicked through', () => {
        const onApprove = vi.fn();
        const utils = render(React.createElement(ConfirmActionModal, modalProps({
            variant: 'psbt',
            onApprove,
            refusal: 'The wallet will not sign what it cannot show you.',
            psbtPanel: React.createElement('div', null, 'panel'),
        })));
        const refusal = utils.getByTestId('confirm-refusal');
        expect(refusal.getAttribute('role')).toBe('alert');
        // No credentials block at all: there is nothing to sign with.
        expect(utils.queryByTestId('creds')).toBe(null);
        const approve = utils.getByTestId('confirm-approve');
        expect(approve.disabled).toBe(true);
        fireEvent.click(approve);
        expect(onApprove).not.toHaveBeenCalled();
        // Reject stays reachable: a refusal must never trap the user.
        expect(utils.getByTestId('confirm-reject').disabled).toBe(false);
    });
});

describe('§5.5 ConfirmActionModal: message variant', () => {
    const MESSAGE = 'I control this address.\n  Nonce: 12345';

    it('shows the full text verbatim and omits the transaction furniture', () => {
        const utils = render(React.createElement(ConfirmActionModal, modalProps({
            variant: 'message',
            headline: 'Sign this message',
            messageText: MESSAGE,
        })));
        // Verbatim: newlines and leading whitespace survive (pre-wrap), because
        // the signature covers these exact bytes.
        expect(utils.getByTestId('confirm-message-text').textContent).toBe(MESSAGE);
        // No pre-flight panel (no chain state to check, nothing to broadcast)
        // and no hardware-outputs caveat (there are no outputs).
        expect(utils.container.textContent).not.toMatch(/verifies native outputs/i);
        expect(utils.getByTestId('confirm-approve')).toBeTruthy();
        expect(utils.getByTestId('confirm-reject')).toBeTruthy();
    });

    it('keeps the headline when there is no decoded action to draw one from', () => {
        const utils = render(React.createElement(ConfirmActionModal, modalProps({
            variant: 'message',
            headline: 'Sign this message',
            messageText: 'hi',
        })));
        expect(utils.container.textContent).toContain('Sign this message');
        expect(utils.getByTestId('confirm-modal').getAttribute('aria-label'))
            .toBe('Confirm Sign this message');
    });
});
