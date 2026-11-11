// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Onboarding } from '../../../packages/core/src/shared/routes/Onboarding.jsx';
import { LICENSE_VERSION } from '../../../packages/core/src/buildInfo.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import onboardingStyles from '../../../packages/core/src/shared/routes/Onboarding.module.css';

describe('FormPage onboarding layout', () => {
    it('keeps progress, title, status, body, and equal action stack in shared order', () => {
        const { container } = render(
            <FormPage
                label="Create wallet"
                progress={<span aria-current="step">Step 1 of 3</span>}
                topAction={<button type="button">Skip</button>}
                title="Create a new wallet"
                description="Encrypt this wallet on this device."
                status={<p>Ready</p>}
                actions={(
                    <>
                        <button type="button">Back</button>
                        <button type="submit">Next</button>
                    </>
                )}
                stackedActions
            >
                <input aria-label="Password" />
            </FormPage>,
        );

        const form = screen.getByRole('form', { name: 'Create wallet' });
        const children = [...form.children];
        expect(children[0]).toContainElement(screen.getByText('Step 1 of 3'));
        expect(children[0]).toContainElement(screen.getByRole('button', { name: 'Skip' }));
        expect(children[1]).toContainElement(screen.getByRole('heading', { name: 'Create a new wallet' }));
        expect(children[1]).toHaveTextContent('Encrypt this wallet on this device.');
        expect(children[2]).toHaveTextContent('Ready');
        expect(children[3]).toContainElement(screen.getByLabelText('Password'));
        expect(children[4]).toContainElement(screen.getByRole('button', { name: 'Back' }));
        expect(children[4]).toContainElement(screen.getByRole('button', { name: 'Next' }));
        expect(children[4].className.split(' ')).toHaveLength(2);
        expect(container.querySelectorAll('h1')).toHaveLength(1);
    });

    it('leads the content with a notice when the form sits under the screen page header', () => {
        render(
            <FormPage
                label="Send"
                status={<p>Enter a recipient address.</p>}
                actions={<button type="submit">Send</button>}
            >
                <input aria-label="To" />
            </FormPage>,
        );

        const form = screen.getByRole('form', { name: 'Send' });
        // The notice sits above the form card, not inside it, so a wide card never nests a box.
        expect(form.previousElementSibling).toHaveTextContent('Enter a recipient address.');
        expect(form).not.toHaveTextContent('Enter a recipient address.');
        const children = [...form.children];
        expect(children[0]).toContainElement(screen.getByLabelText('To'));
        expect(children[1]).toContainElement(screen.getByRole('button', { name: 'Send' }));
    });

    it('lifts the demo-wallet note above the form card', () => {
        render(
            <FormPage
                label="Send"
                demoGuard={{ blocked: true, note: <p>Demo wallets cannot move funds.</p>, dialog: null }}
                actions={<button type="submit">Send</button>}
            >
                <input aria-label="To" />
            </FormPage>,
        );

        const form = screen.getByRole('form', { name: 'Send' });
        expect(form.previousElementSibling).toHaveTextContent('Demo wallets cannot move funds.');
        expect(form).not.toHaveTextContent('Demo wallets cannot move funds.');
    });

    it('keeps the Welcome offline signer choice slate instead of promoting it to success', () => {
        localStorage.setItem('xc:licenseAcceptedAt', new Date().toISOString());
        localStorage.setItem('xc:licenseAcceptedVersion', LICENSE_VERSION);
        localStorage.setItem('xc:onboardingExplainerSeenAt', new Date().toISOString());

        render(
            <MessagingProvider shell="web" messaging={{}}>
                <Onboarding
                    onCreate={() => {}}
                    onImport={() => {}}
                    onImportFromFreeWallet={() => {}}
                    onPairPartner={() => {}}
                />
            </MessagingProvider>,
        );
        localStorage.clear();

        const pair = screen.getByRole('button', { name: 'Pair an offline signer' });
        expect(pair).toHaveClass(buttonStyles.primary);
        expect(pair).toHaveClass(onboardingStyles.pairSignerButton);
        expect(pair).not.toHaveClass(buttonStyles.success);
    });
});
