// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The hardware sign page (hw-3 layout 2, trimmed): it shows only for sign
// ops, draws the four steps, has no failure action or Cancel, and its Back
// takes the shared Confirm page back with nothing signed and no error.

import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HardwareSignPage, signSteps } from '../../../packages/core/src/shared/components/HardwareSignPage.jsx';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';
import {
    begin, end, fail, runSignOp, step,
} from '../../../packages/core/src/signers/hardwareSession.js';

const info = { signerId: 's1', vendor: 'trezor', model: 'Safe 3', op: 'signPsbt' };

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('<HardwareSignPage>', () => {
    it('renders nothing with no op, and nothing for a status poll', () => {
        const { container } = render(<HardwareSignPage />);
        expect(container).toBeEmptyDOMElement();
        let id;
        act(() => { id = begin({ ...info, op: 'status' }); });
        expect(container).toBeEmptyDOMElement();
        act(() => end(id));
    });

    it('shows the app and page toolbars, device, heading and four steps for a sign op', () => {
        render(<HardwareSignPage />);
        let id;
        act(() => { id = begin(info); });
        expect(screen.getByRole('dialog', { name: 'Sign on Trezor' })).toBeInTheDocument();
        const appHeader = screen.getByRole('region', { name: 'App header' });
        expect(appHeader).toBeInTheDocument();
        expect(appHeader.querySelector('img')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Confirm on your Trezor' })).toBeInTheDocument();
        expect(screen.getByText('Check the amount and address on its screen')).toBeInTheDocument();
        const line = screen.getByRole('list', { name: 'Signing progress' });
        expect([...line.querySelectorAll('li')].map((li) => li.getAttribute('data-state')))
            .toEqual(['active', 'todo', 'todo', 'todo']);
        expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
        // The signing content itself has only Back; the other control belongs to the app bar.
        expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') || b.textContent))
            .toEqual(['Open menu', 'Back to Confirm']);

        act(() => { step(id, 'connected'); step(id, 'unlocked'); });
        expect([...line.querySelectorAll('li')].map((li) => li.getAttribute('data-state')))
            .toEqual(['done', 'done', 'active', 'todo']);
        act(() => end(id));
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('words a message signature as a message check', () => {
        render(<HardwareSignPage />);
        let id;
        act(() => { id = begin({ ...info, vendor: 'ledger', op: 'signMessage' }); });
        expect(screen.getByRole('heading', { name: 'Confirm on your Ledger' })).toBeInTheDocument();
        expect(screen.getByText('Check the message on its screen')).toBeInTheDocument();
        act(() => end(id));
    });

    it('shows a rejected notice with no Try Again action', () => {
        render(<HardwareSignPage />);
        let id;
        act(() => { id = begin(info); step(id, 'connected'); });
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
        act(() => fail(id, { kind: 'rejected' }));
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Signing was rejected on your Trezor. Nothing was signed.');
        expect(document.querySelector('[data-hardware-sign-page]').firstElementChild).toBe(alert);
        const line = screen.getByRole('list', { name: 'Signing progress' });
        expect([...line.querySelectorAll('li')].map((li) => li.getAttribute('data-state')))
            .toEqual(['done', 'failed', 'todo', 'todo']);
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
        act(() => end(id));
    });

    it('maps each failure kind to its own sentence', () => {
        expect(signSteps({ steps: ['connected'], failure: { kind: 'timeout' } }).map((s) => s.state))
            .toEqual(['done', 'failed', 'todo', 'todo']);
        render(<HardwareSignPage />);
        let id;
        act(() => { id = begin(info); fail(id, { kind: 'unplugged' }); });
        const text = screen.getByRole('alert').textContent;
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
        act(() => end(id));
        expect(text).toContain("Your Trezor isn't connected. Plug it in and unlock it.");
    });
});

const COMPOSED = {
    actionString: 'SEND|0|JDOG|1|destination',
    action: 'SEND',
    version: 0,
    psbt: 'mock-psbt',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
    tamperVerified: true,
};

// A form's Confirm page over the shared confirm hook, with the sign page
// mounted beside it the way a shell mounts it.
function ConfirmWithSignPage({ approve, onRejectSeen }) {
    const confirmation = useConfirmAction();
    const [done, setDone] = useState(false);
    if (done) return <p>Signed</p>;
    return (
        <>
            {confirmation.phase === 'idle' ? (
                <button
                    type="button"
                    onClick={() => {
                        confirmation.confirm({
                            chainId: 'bitcoin-mainnet',
                            compose: async () => COMPOSED,
                            preflight: async () => ({ verdict: 'pass', findings: [], unverified: [] }),
                            onApprove: () => approve(),
                        // Unmounting at the end of a test rejects a confirm still open.
                        }).then(() => setDone(true), () => {});
                    }}
                >
                    Review
                </button>
            ) : (
                <ConfirmActionModal
                    phase={confirmation.phase}
                    composed={confirmation.composed}
                    report={confirmation.report}
                    reportLoading={confirmation.phase === 'preflighting'}
                    acknowledged={confirmation.acknowledged}
                    onAcknowledge={confirmation.acknowledge}
                    canApprove={confirmation.canApprove}
                    onApprove={confirmation.approve}
                    onReject={() => { onRejectSeen?.(); confirmation.reject(); }}
                    decoded={{ summary: 'Send with hardware wallet', details: [], warnings: [] }}
                    chainLabel="Bitcoin"
                    credentials={<p>Hardware wallet ready</p>}
                    credentialsReady
                    error={confirmation.error}
                />
            )}
            <HardwareSignPage />
        </>
    );
}

describe('Back on the sign page returns to the Confirm page', () => {
    it('returns from a rejected notice with the Confirm state intact', async () => {
        const device = vi.fn(async () => {
            throw new Error('rejected by user');
        });
        const approve = () => runSignOp(info, () => device()).catch((err) => {
            throw new Error(`signPsbt failed: ${err.message}`);
        });
        render(<ConfirmWithSignPage approve={approve} />);

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Signing was rejected on your Trezor. Nothing was signed.',
        );
        expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Back to Confirm' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByTestId('confirm-notice')).toBeNull();
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).toBeEnabled());
        expect(device).toHaveBeenCalledOnce();
    });

    it('keeps Confirm open with no error, and a second Approve signs', async () => {
        let finish = null;
        // The device call: the first never answers (Back ends it), the second signs.
        const device = vi.fn()
            .mockImplementationOnce(() => new Promise(() => {}))
            .mockImplementationOnce(() => new Promise((r) => { finish = r; }));
        // The background sees the renderer error only as "<op> failed: <message>".
        const approve = () => runSignOp(info, () => device()).catch((err) => {
            throw new Error(`signPsbt failed: ${err.message}`);
        });
        render(<ConfirmWithSignPage approve={approve} />);

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        expect(await screen.findByRole('dialog', { name: 'Sign on Trezor' })).toBeInTheDocument();
        // The Confirm page stays mounted underneath.
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Back to Confirm' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByTestId('confirm-notice')).toBeNull();
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).toBeEnabled());

        fireEvent.click(screen.getByTestId('confirm-approve'));
        await screen.findByRole('dialog', { name: 'Sign on Trezor' });
        await act(async () => { finish({ txid: 'tx' }); });
        expect(await screen.findByText('Signed')).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(device).toHaveBeenCalledTimes(2);
    });

    it('Escape acts as Back: it cancels the op once and leaves Confirm open', async () => {
        const rejected = vi.fn();
        const device = vi.fn(() => new Promise(() => {}));
        const approve = () => runSignOp(info, () => device()).catch((err) => {
            throw new Error(`signPsbt failed: ${err.message}`);
        });
        render(<ConfirmWithSignPage approve={approve} onRejectSeen={rejected} />);

        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        fireEvent.click(await screen.findByTestId('confirm-approve'));
        await screen.findByRole('dialog', { name: 'Sign on Trezor' });

        fireEvent.keyDown(document.body, { key: 'Escape' });

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        // The Confirm page's own Escape (reject) never ran.
        expect(rejected).not.toHaveBeenCalled();
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Review' })).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).toBeEnabled());
    });
});
