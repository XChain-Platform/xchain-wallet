// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
    ConfirmDecisionFooter,
    ConfirmStandard,
} from '../../../packages/core/src/shared/components/ConfirmStandard.jsx';
import { confirmStatus, confirmWarning } from '../../../packages/core/src/shared/utils/confirmStandardModel.js';

afterEach(cleanup);

describe('ConfirmStandard warning prop', () => {
    it('renders every supplied warning point in its short warning after the details', () => {
        render(
            <ConfirmStandard
                label="Confirm send"
                icon="send"
                sentence="Send 1 BTC"
                facts={[{ key: 'memo', label: 'Memo', value: 'hi' }]}
                warning={{
                    title: 'Check this send',
                    points: [
                        { key: 'balance', text: 'This sends most of the balance.' },
                        { key: 'fee', text: 'The fee is unusually high.' },
                    ],
                    overrides: [],
                    role: null,
                    state: 'irreversible',
                    testId: 'producer-warning',
                }}
            />,
        );

        const slot = screen.getByTestId('confirm-warning');
        expect(screen.getByTestId('producer-warning').closest('[data-testid="confirm-warning"]')).toBe(slot);
        expect(screen.getAllByTestId('confirm-warning-point').map((point) => point.textContent)).toEqual([
            'This sends most of the balance.',
            'The fee is unusually high.',
        ]);
        // After the facts card, in the scrolling page, never in a dock.
        const facts = screen.getByTestId('confirm-facts');
        expect(facts.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('says a failed pre-flight once in the status notice and the producer lines once in the warning', () => {
        const status = confirmStatus({
            report: {
                verdict: 'fail',
                findings: [{
                    code: 'DEST_ADDRESS_INVALID',
                    severity: 'error',
                    overridable: false,
                    message: 'The recipient is invalid.',
                }],
                unverified: [],
            },
        });
        const warning = confirmWarning({
            extraWarnings: ['The fee is unusually high.', 'The fee is unusually high.'],
            testId: 'send-unusual-warnings',
        });
        render(
            <>
                <ConfirmStandard label="Confirm" icon="send" sentence="Send 1 BTC" status={status} warning={warning} />
                <ConfirmDecisionFooter onReject={() => {}} onApprove={() => {}} />
            </>,
        );

        const modal = screen.getByTestId('confirm-modal');
        expect(modal.firstElementChild).toBe(screen.getByTestId('confirm-status-slot'));
        expect(screen.getByTestId('confirm-status').textContent).toContain('The checks found a problem with this action.');
        expect(screen.getByTestId('confirm-status').textContent).not.toContain('The recipient is invalid.');
        expect(screen.getByTestId('send-unusual-warnings').closest('[data-testid="confirm-warning"]'))
            .toBe(screen.getByTestId('confirm-warning'));
        expect(screen.getAllByText('The checks found a problem with this action.')).toHaveLength(1);
        expect(screen.getAllByText('The fee is unusually high.')).toHaveLength(1);
        // The decision footer holds only the two buttons.
        expect([...screen.getByTestId('confirm-decision').children]).toEqual([screen.getByTestId('confirm-buttons')]);
    });
});
