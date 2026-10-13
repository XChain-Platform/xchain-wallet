// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

vi.mock('../../../packages/core/src/shared/components/TickerIcon.jsx', () => ({
    TickerIcon: ({ chainId, tick }) => (
        <span
            data-testid="ticker-icon"
            data-chain-id={chainId}
            data-tick={tick}
        />
    ),
}));

vi.mock('@xchain-wallet/core/ui', () => ({
    Button: ({ children, onClick }) => <button type="button" onClick={onClick}>{children}</button>,
}));

const { LockedTokenContext } = await import(
    '../../../packages/core/src/shared/components/LockedTokenContext.jsx'
);
const { EmptyStateNudge } = await import(
    '../../../packages/core/src/shared/components/EmptyStateNudge.jsx'
);

function renderContext(overrides = {}) {
    return render(
        <LockedTokenContext chainId="unknown-chain" tick="XCP" {...overrides} />,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});
afterAll(() => {
    vi.doUnmock('../../../packages/core/src/shared/components/TickerIcon.jsx');
});

describe('LockedTokenContext', () => {
    it('renders the default label above the chip and shows the ticker', () => {
        renderContext();

        const label = screen.getByText('Token');
        const icon = screen.getByTestId('ticker-icon');
        expect(label.parentElement.firstElementChild).toBe(label);
        expect(label.nextElementSibling).toContainElement(icon);
        expect(screen.getByText('XCP')).toBeInTheDocument();
    });

    it('replaces the default label with a passed label', () => {
        renderContext({ label: 'Locked asset' });

        expect(screen.getByText('Locked asset')).toBeInTheDocument();
        expect(screen.queryByText('Token')).not.toBeInTheDocument();
    });

    it('renders no label element for an empty label', () => {
        const { container } = renderContext({ label: '' });
        const wrapper = container.firstElementChild;

        expect(screen.queryByText('Token')).not.toBeInTheDocument();
        expect(wrapper).toHaveProperty('childElementCount', 1);
    });

    it('shows a registered chain name and passes icon props through', () => {
        const descriptor = BUNDLED_DESCRIPTORS[0];
        renderContext({ chainId: descriptor.id, tick: 'PEPE' });

        expect(
            screen.getByText(`on ${descriptor.displayName || descriptor.id}`),
        ).toBeInTheDocument();
        expect(screen.getByTestId('ticker-icon')).toHaveAttribute(
            'data-chain-id', descriptor.id,
        );
        expect(screen.getByTestId('ticker-icon')).toHaveAttribute('data-tick', 'PEPE');
    });

    it('omits the chain line for an unregistered chain', () => {
        renderContext({ chainId: 'not-a-registered-chain' });

        expect(screen.queryByText(/^on /)).not.toBeInTheDocument();
    });

    it('stays role-neutral inside a parent landmark', () => {
        render(
            <main>
                <LockedTokenContext chainId="unknown-chain" tick="XCP" />
            </main>,
        );

        expect(screen.getAllByRole('main')).toHaveLength(1);
        expect(screen.getByText('Token').parentElement).not.toHaveAttribute('role');
    });
});

describe('EmptyStateNudge', () => {
    it('does not duplicate a parent status role by default', () => {
        render(
            <div role="status">
                <EmptyStateNudge title="Nothing here" body="Add an item to get started." />
            </div>,
        );

        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByText('Nothing here').parentElement).not.toHaveAttribute('role');
    });

    it('supports an explicit role when it owns the announcement', () => {
        render(<EmptyStateNudge title="Nothing here" role="status" />);

        expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
    });
});
