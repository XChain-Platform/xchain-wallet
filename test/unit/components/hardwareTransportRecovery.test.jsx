// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import { useConfirmAction } from '../../../packages/core/src/shared/hooks/useConfirmAction.js';

const COMPOSED = {
    actionString: 'SEND|0|JDOG|1|destination',
    action: 'SEND',
    version: 0,
    psbt: 'mock-psbt',
    expectedOutputs: { addressed: [], encoding: 'OP_RETURN' },
    tamperVerified: true,
};

function HardwareConfirmHarness({ transport }) {
    const confirmation = useConfirmAction();
    const [complete, setComplete] = useState(false);

    if (complete) return <p>Signed without reloading</p>;
    if (confirmation.phase === 'idle') {
        return (
            <button
                type="button"
                onClick={() => {
                    confirmation.confirm({
                        chainId: 'bitcoin-mainnet',
                        compose: async () => COMPOSED,
                        preflight: async () => ({ verdict: 'pass', findings: [], unverified: [] }),
                        onApprove: () => transport(),
                    }).then(() => setComplete(true));
                }}
            >
                Review hardware send
            </button>
        );
    }

    return (
        <ConfirmActionModal
            phase={confirmation.phase}
            composed={confirmation.composed}
            report={confirmation.report}
            reportLoading={confirmation.phase === 'preflighting'}
            acknowledged={confirmation.acknowledged}
            onAcknowledge={confirmation.acknowledge}
            canApprove={confirmation.canApprove}
            onApprove={confirmation.approve}
            onReject={confirmation.reject}
            decoded={{ summary: 'Send with hardware wallet', details: [], warnings: [] }}
            chainLabel="Bitcoin"
            credentials={<p>Hardware wallet ready</p>}
            credentialsReady
            error={confirmation.error}
        />
    );
}

function signerStatusError(status, detail) {
    return Object.assign(
        new Error(`Signer "mock-ledger" is in status "${status}": ${detail}`),
        { name: 'SignerStatusError', status },
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('hardware transport recovery', () => {
    it.each([
        [
            'device locked',
            signerStatusError('locked', 'device locked'),
            'Your hardware wallet is locked. Unlock it, then select Approve again.',
        ],
        [
            'wrong app open',
            signerStatusError('wrong-app', 'The Litecoin app is open'),
            'The wrong app is open on your hardware wallet. Open the app for this network, then select Approve again.',
        ],
        [
            'user rejected',
            Object.assign(new Error('device declined'), { name: 'UserRejectedError' }),
            'Signing was rejected on your hardware wallet. Review the details, then select Approve again when you are ready.',
        ],
        [
            'disconnected mid-sign',
            new Error('signer bridge disconnected'),
            'Your hardware wallet disconnected before signing finished. Reconnect and unlock it, then select Approve again.',
        ],
        [
            'firmware too old',
            signerStatusError('error', 'Device firmware is too old'),
            'Your hardware wallet firmware is too old. Update it with the vendor app, reconnect and unlock the device, then select Approve again.',
        ],
    ])('shows a next step and retries the same screen after %s', async (_case, failure, advice) => {
        const transport = vi.fn()
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce({ txid: 'signed-txid' });
        render(<HardwareConfirmHarness transport={transport} />);

        fireEvent.click(screen.getByRole('button', { name: 'Review hardware send' }));
        const approve = await screen.findByTestId('confirm-approve');
        fireEvent.click(approve);

        expect(await screen.findByRole('alert')).toHaveTextContent(advice);
        expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('confirm-approve')).toBeEnabled());

        fireEvent.click(screen.getByTestId('confirm-approve'));

        expect(await screen.findByText('Signed without reloading')).toBeInTheDocument();
        expect(transport).toHaveBeenCalledTimes(2);
    });
});
