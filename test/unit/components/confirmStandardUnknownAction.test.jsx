// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConfirmActionModal } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';
import {
    confirmHeadline,
    decodedFacts,
} from '../../../packages/core/src/shared/utils/confirmStandardModel.js';

const PASS = {
    verdict: 'pass',
    restricted: false,
    findings: [{ code: 'DRYRUN_VALID', severity: 'info', source: 'dryrun', message: 'ok', data: {} }],
    unverified: [],
    stateHeight: 100,
};

const REGISTER = {
    summary: 'Sign Register on Bitcoin',
    details: [
        { label: 'Name', value: 'dankest.btc' },
        { label: 'Duration', value: '1 year' },
    ],
    warnings: ['No plain-English summary is available for "Register" yet.'],
};

afterEach(cleanup);

describe('Confirm Standard unknown action fallback', () => {
    it('uses an honest headline, a generic action icon, and only names an asset when decoded', () => {
        const unknown = confirmHeadline({
            actionName: 'REGISTER',
            decoded: REGISTER,
            chainName: 'Bitcoin',
        });
        expect(unknown).toMatchObject({
            kind: 'other',
            actionCode: 'REGISTER',
            icon: 'action',
            sentence: 'Unknown action',
            heroTick: '',
            address: null,
            showSource: false,
        });

        const namedAsset = confirmHeadline({
            actionName: 'REGISTER',
            decoded: { ...REGISTER, details: [...REGISTER.details, { label: 'Tick', value: 'DANK' }] },
            chainName: 'Bitcoin',
        });
        expect(namedAsset.heroTick).toBe('DANK');
    });

    it('keeps every decoded parameter as its raw key and value', () => {
        expect(decodedFacts({
            decoded: {
                ...REGISTER,
                details: [...REGISTER.details, { label: 'Empty value', value: '' }],
            },
            sentence: 'Unknown action',
            kind: 'other',
        })).toEqual([
            expect.objectContaining({ label: 'NAME', value: 'dankest.btc' }),
            expect.objectContaining({ label: 'DURATION', value: '1 year' }),
            expect.objectContaining({ label: 'EMPTY_VALUE', value: '' }),
        ]);
    });

    it('is red even after a passing check and puts the action code before raw parameters', () => {
        render(<ConfirmActionModal
            phase="ready"
            composed={{ psbt: 'cHNidP8B', action: 'REGISTER' }}
            report={PASS}
            reportLoading={false}
            acknowledged={new Set()}
            onAcknowledge={vi.fn()}
            canApprove
            onApprove={vi.fn()}
            onReject={vi.fn()}
            decoded={REGISTER}
            simulation={null}
            chainLabel="Bitcoin"
            credentials={<input aria-label="Password" />}
            credentialsReady
            variant="action"
            signingWallet={{ id: 'wallet-1', name: 'Daily wallet' }}
            networkFee={{ amount: '0.00001', ticker: 'BTC', fiat: '$0.70' }}
            nativeTicker="BTC"
        />);

        expect(screen.getByTestId('confirm-sentence')).toHaveTextContent(/^Unknown action$/);
        expect(screen.queryByText('Sign Register')).toBeNull();

        const status = screen.getByTestId('confirm-status');
        expect(status).toHaveAttribute('data-tone', 'danger');
        expect(status).toHaveTextContent('Unknown action');
        expect(status).toHaveTextContent("This wallet can't explain what this action does. Only approve it if you trust where it came from.");
        expect(status).not.toHaveTextContent('Checked: this will go through.');

        const facts = screen.getByTestId('confirm-facts');
        const labels = [...facts.querySelectorAll('dt')].map((node) => node.textContent);
        expect(labels.slice(0, 3)).toEqual(['Action code', 'NAME', 'DURATION']);
        expect(screen.getByTestId('confirm-action-code')).toHaveTextContent('REGISTER');
        expect(screen.getAllByTestId('confirm-raw-parameter').map((node) => node.textContent))
            .toEqual(['dankest.btc', '1 year']);
        expect(labels).toContain('Network');
        expect(screen.getByTestId('confirm-signing-wallet')).toHaveTextContent('Daily wallet');
        expect(screen.getByTestId('confirm-fee-network')).toHaveTextContent('0.00001 BTC ($0.70)');

        const approve = screen.getByTestId('confirm-approve');
        expect(approve).not.toBeDisabled();
        expect(approve.className).toContain('success');
    });
});
