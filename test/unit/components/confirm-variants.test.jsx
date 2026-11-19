// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The two NON-action confirm variants.
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
import { MessageConfirmScreen } from '../../../packages/core/src/shared/components/MessageConfirmScreen.jsx';
import { PsbtIntentPanel } from '../../../packages/core/src/shared/components/PsbtIntentPanel.jsx';
import {
    PsbtConfirmScreen,
    psbtRefusalReason,
} from '../../../packages/core/src/shared/components/PsbtConfirmScreen.jsx';
import {
    describeUnreadableReason,
    isUnreadableActionReason,
} from '../../../packages/core/src/shared/components/psbtDecodeReasons.js';
import { canApproveWithReport, toggleAcknowledged } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import { messageText } from '../helpers/messageText.js';

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

function confirmState(overrides = {}) {
    return {
        phase: 'ready',
        composed: {},
        report: null,
        acknowledged: new Set(),
        acknowledge() {},
        canApprove: true,
        approve: vi.fn(),
        reject: vi.fn(),
        error: null,
        ...overrides,
    };
}

describe('request provenance across the shared confirmation adapters', () => {
    const requestOrigin = 'https://shop.example';

    it('threads the requesting site through action, message, and transaction screens', () => {
        const cases = [
            <ActionConfirmScreen
                key="action"
                confirmAction={confirmState({
                    composed: {
                        decoded: { summary: 'Send 1 TOKEN', details: [], warnings: [] },
                    },
                })}
                requestOrigin={requestOrigin}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={() => {}}
            />,
            <MessageConfirmScreen
                key="message"
                confirmAction={confirmState()}
                requestOrigin={requestOrigin}
                message="Approve this message"
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={() => {}}
            />,
            <PsbtConfirmScreen
                key="psbt"
                confirmAction={confirmState()}
                requestOrigin={requestOrigin}
                decomposed={{ inputs: [], outputs: [] }}
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={() => {}}
            />,
        ];

        for (const element of cases) {
            const utils = render(element);
            expect(utils.getByTestId('confirm-request-origin').textContent).toContain(requestOrigin);
            utils.unmount();
        }
    });

    it('foregrounds the end of a long hostname before showing the complete origin', () => {
        const longOrigin = 'https://wallet.example.com.login.account.security.attacker.test';
        const utils = render(
            <MessageConfirmScreen
                confirmAction={confirmState()}
                requestOrigin={longOrigin}
                message="Approve this message"
                chainLabel="Bitcoin"
                signerReady
                password=""
                onPasswordChange={() => {}}
            />,
        );

        const identity = utils.getByTestId('confirm-request-origin');
        const ending = utils.getByTestId('request-origin-host-ending');
        const full = utils.getByTestId('request-origin-full');
        expect(ending.textContent).toBe('security.attacker.test');
        expect(full.textContent).toBe(longOrigin);
        expect(identity.textContent.indexOf(ending.textContent))
            .toBeLessThan(identity.textContent.indexOf(full.textContent));
        utils.unmount();
    });
});

describe('§5.5 PsbtIntentPanel: shared confirmation intent', () => {
    it('foregrounds the decoded action without rebuilding a second raw transaction review', () => {
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: DECOMPOSED,
            ownAddresses: new Set([OWN]),
            signingAddress: OWN,
            decodedAction: { summary: 'Carries an XChain Send action' },
        }));
        const text = utils.container.textContent;

        expect(text).toBe('Carries an XChain Send action');
        expect(utils.getByTestId('psbt-action-intent')).toBeTruthy();
        expect(text).not.toContain('Inputs');
        expect(text).not.toContain('Outputs');
    });

    it('does not duplicate fee and outgoing totals already owned by shared confirmation', () => {
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: DECOMPOSED,
            ownAddresses: new Set([OWN]),
            signingAddress: OWN,
            decodedAction: { summary: 'x' },
        }));
        const text = utils.container.textContent;
        expect(text).toBe('x');
        expect(text).not.toContain('5,000 sats');
        expect(text).not.toContain('120,000 sats');
    });

    it('does not infer an unavailable fee from incomplete raw inputs', () => {
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: {
                inputs: [{ address: OWN }],
                outputs: [{ address: OTHER, value: 1000 }],
            },
            ownAddresses: new Set([OWN]),
            decodedAction: { summary: 'x' },
        }));
        const text = utils.container.textContent;
        expect(text).toBe('x');
        expect(text).not.toContain('amount unknown');
        expect(text).not.toContain('unavailable');
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
        // The signer reads plain words; the raw decoder code sits in the
        // collapsed technical details beside the alert, not inside it.
        expect(alert.textContent).not.toContain('P2SH_P2WSH_UNSUPPORTED');
        expect(alert.textContent).toContain('cannot read yet');
        const details = utils.getByTestId('psbt-action-undecoded-details');
        expect(details.textContent).toContain('P2SH_P2WSH_UNSUPPORTED');
        expect(alert.contains(details)).toBe(false);
        expect(utils.container.textContent).not.toContain('Outputs (3)');
    });

    it('keeps exception text and unmapped codes out of the alert sentence', () => {
        for (const decodeError of [
            "Cannot read properties of undefined (reading 'x')",
            'DECODE_FAILED',
        ]) {
            const utils = render(React.createElement(PsbtIntentPanel, {
                decomposed: DECOMPOSED,
                ownAddresses: new Set([OWN]),
                decodedAction: null,
                decodeError,
            }));
            const alert = utils.getByTestId('psbt-action-undecoded');
            expect(alert.getAttribute('role')).toBe('alert');
            expect(messageText(alert)).toMatch(
                /^The XChain action inside this transaction could not be read\.$/,
            );
            expect(alert.textContent).not.toContain(decodeError);
            expect(utils.getByTestId('psbt-action-undecoded-details').textContent).toContain(decodeError);
            utils.unmount();
        }
    });

    it('describes every unreadable code in words, never by echoing the code', () => {
        for (const reason of [
            'P2SH_P2WSH_UNSUPPORTED', 'MULTI_OP_RETURN', 'DEOBFUSCATION_FAILED',
            'OVERSIZED', 'NOT_UTF8', 'UNKNOWN_ACTION', 'REST_FIELD_UNSUPPORTED',
            'MULTI_LEG_UNSUPPORTED', 'FIELD_COUNT_MISMATCH',
        ]) {
            const why = describeUnreadableReason(reason);
            expect(typeof why, reason).toBe('string');
            expect(why, reason).not.toMatch(/[A-Z_]{4,}/);
        }
        expect(describeUnreadableReason('DECODE_FAILED')).toBe(null);
        expect(describeUnreadableReason('toString')).toBe(null);
        expect(describeUnreadableReason(null)).toBe(null);
    });

    it('leaves an ordinary payment to the shared native-send presentation', () => {
        // NO_OP_RETURN means there is no XChain action at all. Alerting here
        // would train the user to click through the warnings that DO matter.
        const utils = render(React.createElement(PsbtIntentPanel, {
            decomposed: DECOMPOSED,
            ownAddresses: new Set([OWN]),
            decodedAction: null,
            decodeError: 'NO_OP_RETURN',
        }));
        expect(utils.queryByTestId('psbt-action-undecoded')).toBe(null);
        expect(utils.queryByTestId('psbt-action-none')).toBe(null);
        expect(utils.container.textContent).toBe('');
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
            feeEstimate: { coinAmount: '0.00042' },
        }));
        expect(utils.getByTestId('confirm-fee-network').textContent).toBe('0.000059 BTC');
        expect(utils.getByTestId('confirm-fee-network').closest('[data-testid="confirm-facts"]')).not.toBeNull();
        // The estimate must not also appear; two fee numbers is worse than one.
        expect(utils.container.textContent).not.toContain('0.00042');
    });

    it('falls back to the caller estimate when the exact fee is unknowable', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({ networkFeeSats: null, chainId: 'bitcoin-mainnet' }),
            feeEstimate: { coinAmount: '0.00042' },
        }));
        expect(utils.getByTestId('confirm-fee-network').textContent).toBe('0.00042 BTC');
        expect(utils.getByTestId('confirm-facts').querySelector('[data-testid="confirm-fee-network"]')).not.toBeNull();
    });

    it('shows the caller fee once, as the network fee row', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({ networkFeeSats: null, chainId: 'bitcoin-mainnet' }),
            feeEstimate: { coinAmount: '0.00042' },
        }));
        expect(utils.container.textContent.match(/0\.00042 BTC/g)).toHaveLength(1);
    });

    // §1.1 / §5.2.2: the intent states what was COMPOSED. The caller's
    // `decoded` is built from its own form params, which is the "renders from
    // form state" §1 forbids; the host derives its version from the parsed
    // composed action string. When they disagree, the composed one is the one
    // that describes the bytes about to be signed.
    it('renders the host intent over the caller form-param intent', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({
                networkFeeSats: 5900,
                chainId: 'bitcoin-mainnet',
                decoded: { summary: 'Send 42 REALTICK', details: [], warnings: [] },
            }),
        }));
        expect(utils.container.textContent).toContain('Send 42 REALTICK');
        expect(utils.container.textContent).not.toContain('Send 1 JDOG');
    });

    // There is no caller fallback any more. An action the host could
    // not describe shows NO intent line, rather than one built from form
    // state: a visible absence beats a plausible substitute on the screen
    // whose job is saying what will broadcast. (The psbt and message variants
    // compose nothing and have their own screens, so they are unaffected.)
    it('shows no intent at all when the host described nothing', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({ networkFeeSats: 5900, chainId: 'bitcoin-mainnet', decoded: null }),
        }));
        expect(utils.container.textContent).not.toContain('Send 1 JDOG');
    });

    it('resolves the ticker from the envelope chain, not the caller', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({ networkFeeSats: 100000000, chainId: 'dogecoin-mainnet' }),
        }));
        expect(utils.getByTestId('confirm-fee-network').textContent).toBe('1 DOGE');
    });

    it('discloses when sub-dust change is included in the exact fee', () => {
        const utils = render(React.createElement(ActionConfirmScreen, {
            ...screenProps({
                networkFeeSats: 1000,
                dustChangeLimitSats: 546,
                chainId: 'bitcoin-mainnet',
            }),
        }));
        expect(utils.getByTestId('confirm-fee-network').textContent).toBe('0.00001 BTC');
        expect(utils.getByTestId('confirm-dust-change').textContent).toBe(
            'None, under 0.00000546 BTC goes to the fee',
        );
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
    it('gives the shared PSBT adapter a plain-language headline', () => {
        const utils = render(<PsbtConfirmScreen
            confirmAction={confirmState()}
            decomposed={{ inputs: [], outputs: [] }}
            chainLabel="Bitcoin"
            signerReady
            password=""
            onPasswordChange={() => {}}
        />);
        // The sentence says it in plain words; the footer verb stays the bare Approve.
        expect(utils.getByTestId('confirm-modal')).toHaveAttribute('aria-label', 'Confirm Sign transaction');
        expect(utils.getByTestId('confirm-sentence')).toHaveTextContent(/^Sign this transaction$/);
        expect(utils.getByTestId('confirm-approve')).toHaveTextContent(/^Approve$/);
        expect(utils.getByRole('button', { name: 'Approve' })).toBeTruthy();
        expect(utils.queryByRole('button', { name: 'Sign transaction' })).toBeNull();
    });

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

    it('a refusal holds Approve, hides the credentials, and cannot be clicked through', () => {
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
        // G130: Approve keeps its colour; the tap repeats the refusal at the
        // top of the page and signs nothing.
        const approve = utils.getByTestId('confirm-approve');
        expect(approve.disabled).toBe(false);
        fireEvent.click(approve);
        expect(onApprove).not.toHaveBeenCalled();
        expect(utils.getByTestId('confirm-blocked').textContent).toBe('The wallet will not sign what it cannot show you.');
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
        expect(utils.getByTestId('confirm-message-text').tagName).toBe('P');
        expect(utils.getByTestId('confirm-message-text').textContent).toBe(MESSAGE);
        expect(utils.getByLabelText('Message to sign')).toBeTruthy();
        // No pre-flight panel (no chain state to check, nothing to broadcast)
        // and no hardware-outputs caveat (there are no outputs).
        expect(utils.container.textContent).not.toMatch(/verifies native outputs/i);
        expect(utils.getByTestId('confirm-approve')).toBeTruthy();
        expect(utils.getByTestId('confirm-reject')).toBeTruthy();
    });

    it('shows the full signing address with a plain-language label', () => {
        const utils = render(React.createElement(ConfirmActionModal, modalProps({
            variant: 'message',
            headline: 'Sign this message',
            messageText: 'hi',
            sourceAddress: OWN,
        })));
        const row = utils.getByTestId('confirm-address');
        expect(row.previousElementSibling.textContent).toBe('Address');
        expect(row.closest('[data-testid="confirm-facts"]')).not.toBeNull();
        // Whole where it fits, cut in the middle where it does not; the
        // title always carries all of it (jsdom measures nothing).
        expect(row.querySelector('[title]')?.getAttribute('title')).toBe(OWN);
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
