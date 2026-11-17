// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

const messaging = vi.hoisted(() => ({
    getSettings: vi.fn(),
    resolveApproval: vi.fn(),
}));

vi.mock('../../../packages/extension/src/approval/messaging.js', () => messaging);

const { ConnectApproval, CONNECT_PICKER_MAX_ICONS, connectPickerPresentation } = await import(
    '../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);

const chain = BUNDLED_DESCRIPTORS[0];
const accounts = Array.from({ length: 13 }, (_, index) => ({
    id: `account-${index + 1}`,
    name: index === 0 ? 'Main' : `Account ${index + 1}`,
}));

function mount(accountOptions = accounts.slice(0, 2)) {
    return render(
        <ConnectApproval
            id="picker-fields"
            payload={{
                origin: 'https://picker.test',
                appName: 'Picker Site',
                requestedChains: [chain.id],
                accountOptions,
            }}
            onReject={() => {}}
        />,
    );
}

function openAccounts() {
    fireEvent.click(screen.getByRole('button', { name: /^Accounts it can see/ }));
}

function back() {
    fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
}

beforeEach(() => {
    vi.clearAllMocks();
    messaging.getSettings.mockResolvedValue({});
    messaging.resolveApproval.mockResolvedValue({ approved: true });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('Connect approval picker fields', () => {
    it('shows names that fit and updates both picker pages on Back', () => {
        mount([
            { id: 'main', name: 'Main' },
            { id: 'trading', name: 'Trading' },
        ]);

        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        expect(screen.getByRole('heading', { name: 'Choose Networks' })).toBeVisible();
        expect(screen.getByLabelText(`Allow ${chain.displayName}`)).toBeChecked();
        back();

        openAccounts();
        expect(screen.getByRole('heading', { name: 'Choose Accounts' })).toBeVisible();
        expect(screen.getByText('trading')).toBeVisible();
        fireEvent.click(screen.getByLabelText('Share Trading'));
        back();

        const field = screen.getByRole('button', { name: /^Accounts it can see/ });
        expect(field).toHaveTextContent('Main, Trading');
        expect(field.querySelectorAll('[data-picker-icon]')).toHaveLength(2);
    });

    it('caps the icon stack at five and counts every remaining choice', () => {
        expect(CONNECT_PICKER_MAX_ICONS).toBe(5);
        expect(connectPickerPresentation(accounts.map((account) => account.name)))
            .toMatchObject({ shown: 5, more: 8, text: '+8 more' });
        mount(accounts);
        openAccounts();
        for (const account of accounts.slice(1)) {
            fireEvent.click(screen.getByLabelText(`Share ${account.name}`));
        }
        back();

        const field = screen.getByRole('button', { name: /^Accounts it can see/ });
        expect(field.querySelectorAll('[data-picker-icon]')).toHaveLength(5);
        expect(field.querySelector('[data-picker-more="8"]')).toHaveTextContent('+8 more');
    });

    it('places one info notice directly after the Accounts field', () => {
        mount();
        const accountsField = document.querySelector('[data-picker-field="connect-accounts"]');
        const notice = accountsField.nextElementSibling;

        expect(notice).toHaveAttribute('data-connect-permissions');
        expect(notice).toHaveTextContent('See the addresses and balances of the accounts you share');
        expect(notice).toHaveTextContent('Ask you each time it wants a signature');
    });

    it('keeps both actions enabled and sends nothing when a missing choice is submitted', async () => {
        mount([{ id: 'main', name: 'Main' }]);
        openAccounts();
        fireEvent.click(screen.getByLabelText('Share Main'));
        back();

        const approve = screen.getByRole('button', { name: 'Approve' });
        const reject = screen.getByRole('button', { name: 'Reject' });
        const scrollArea = document.querySelector('main');
        scrollArea.scrollTop = 120;
        scrollArea.scrollTo = vi.fn();

        expect(approve).not.toBeDisabled();
        expect(reject).not.toBeDisabled();
        fireEvent.click(approve);

        const summary = await screen.findByTestId('connect-error-summary');
        const summaryFocusTarget = summary.parentElement;
        await waitFor(() => expect(document.activeElement).toBe(summaryFocusTarget));
        expect(summary).toHaveTextContent('Fix 1 thing to continue');
        expect(summary).toHaveTextContent('Pick at least one account to share.');
        expect(scrollArea.scrollTo).toHaveBeenCalledWith({ top: 0 });
        expect(scrollArea.scrollTop).toBe(0);
        expect(screen.getByRole('button', { name: /^Accounts it can see/ }))
            .toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByText('Pick at least one account to share.', { selector: '[role="alert"]' }))
            .toBeVisible();
        expect(messaging.resolveApproval).not.toHaveBeenCalled();
    });
});

describe('Connect approval dock geometry', () => {
    it('uses eight pixels at the sides, between buttons, and above and below', () => {
        const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        const screenCss = readFileSync('packages/core/src/ui/Screen.module.css', 'utf8');
        const approvalCss = readFileSync('packages/extension/src/approval/approval.module.css', 'utf8');

        expect(tokens).toMatch(/--xc-space-1:\s*4px/);
        expect(tokens).toMatch(/--xc-space-2:\s*8px/);
        expect(tokens).toMatch(/--xc-space-3:\s*12px/);
        expect(tokens).toMatch(/--xc-page-gutter:\s*var\(--xc-space-2\)/);
        expect(screenCss).toMatch(/\.footer\s*\{[^}]*padding-block:\s*var\(--xc-space-3\)[^}]*padding-inline:\s*var\(--xc-page-gutter\)/s);
        expect(approvalCss).toMatch(/\.footer\s*\{[^}]*gap:\s*var\(--xc-space-2\)/s);
        expect(approvalCss).toMatch(/\.connectFooter\s*\{[^}]*margin-block:\s*calc\(-1 \* var\(--xc-space-1\)\)/s);
    });
});
