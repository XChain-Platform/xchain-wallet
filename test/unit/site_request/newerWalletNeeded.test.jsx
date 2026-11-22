// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@xchain-wallet/core/ui', () => ({
    Screen: ({ header, children, variant }) => (
        <main data-variant={variant}>{header}{children}</main>
    ),
    PageHeader: ({ onBack }) => (
        <header><button type="button" onClick={onBack}>Back</button></header>
    ),
    EmptyState: ({ title, body, actionLabel, onAction }) => (
        <section>
            <h2>{title}</h2>
            <p>{body}</p>
            {actionLabel && onAction
                ? <button type="button" onClick={onAction}>{actionLabel}</button>
                : null}
        </section>
    ),
}));

import { NewerWalletNeeded } from '../../../packages/core/src/shared/routes/NewerWalletNeeded.jsx';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('NewerWalletNeeded', () => {
    it('shows update guidance and no request action', () => {
        const onBack = vi.fn();
        render(<NewerWalletNeeded variant="full" onBack={onBack} />);

        expect(screen.getByRole('heading', { name: 'This request needs a newer wallet' }))
            .toBeInTheDocument();
        expect(screen.getByText('Update XChain Wallet, then ask the site to try again.'))
            .toBeInTheDocument();
        expect(screen.queryByRole('link')).toBeNull();
        expect(screen.getAllByRole('button')).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(onBack).toHaveBeenCalledOnce();
    });
});
