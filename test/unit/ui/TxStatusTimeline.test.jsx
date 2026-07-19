// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit:  / §28.3. TxStatusTimeline renders the full five-stage
// ladder (Signed, Broadcast, mempool, Confirmed, Indexed), computing each
// stage's done/pending state from the entry fields plus the optional
// chainTip / indexerWatermark props.

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TxStatusTimeline } from '../../../packages/core/src/shared/components/TxStatusTimeline.jsx';

// The component uses ● for done stages and ○ for pending. Helper: map each
// stage row (by its label text's containing <li>) to its done marker.
function markerFor(container, labelText) {
    const label = screen.getByText(labelText);
    const li = label.closest('li');
    const dot = li.querySelector('span[aria-hidden="true"]');
    return dot.textContent;
}

describe('<TxStatusTimeline>', () => {
    it('renders all five stages including Signed and Indexed', () => {
        render(<TxStatusTimeline entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }} />);
        expect(screen.getByText('Signed')).toBeInTheDocument();
        expect(screen.getByText('Broadcast')).toBeInTheDocument();
        expect(screen.getByText('Indexed')).toBeInTheDocument();
        // Confirmed stage labels its block.
        expect(screen.getByText(/Confirmed at block 100/)).toBeInTheDocument();
    });

    it('marks Signed done when a txHash is present (a broadcast tx was signed)', () => {
        const { container } = render(
            <TxStatusTimeline entry={{ txHash: 'deadbeef', blockIndex: 0, timestamp: 0 }} />,
        );
        expect(markerFor(container, 'Signed')).toBe('●');
    });

    it('marks Signed done from an explicit signedAt before any broadcast', () => {
        const { container } = render(
            <TxStatusTimeline entry={{ txHash: '', blockIndex: 0, signedAt: 1_700_000_000, timestamp: 0 }} />,
        );
        // Signed done, but Broadcast still pending (no hash yet).
        expect(markerFor(container, 'Signed')).toBe('●');
        expect(markerFor(container, 'Broadcast')).toBe('○');
    });

    it('leaves Signed pending when there is neither a hash nor a signedAt', () => {
        const { container } = render(
            <TxStatusTimeline entry={{ txHash: '', blockIndex: 0, timestamp: 0 }} />,
        );
        expect(markerFor(container, 'Signed')).toBe('○');
    });

    it('marks Indexed done when the watermark reaches the entry block', () => {
        const { container } = render(
            <TxStatusTimeline
                entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }}
                indexerWatermark={150}
            />,
        );
        expect(markerFor(container, 'Indexed')).toBe('●');
        expect(screen.getByText(/indexer at block 150/)).toBeInTheDocument();
    });

    it('leaves Indexed pending when the watermark trails the entry block', () => {
        const { container } = render(
            <TxStatusTimeline
                entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }}
                indexerWatermark={90}
            />,
        );
        expect(markerFor(container, 'Indexed')).toBe('○');
        expect(screen.getByText(/still catching up/)).toBeInTheDocument();
    });

    it('treats a confirmed row as indexed when no watermark is supplied', () => {
        const { container } = render(
            <TxStatusTimeline entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }} />,
        );
        expect(markerFor(container, 'Indexed')).toBe('●');
    });

    it('leaves Indexed pending for an unconfirmed (mempool) entry', () => {
        const { container } = render(
            <TxStatusTimeline entry={{ txHash: 'abc', blockIndex: 0, timestamp: 0 }} />,
        );
        expect(markerFor(container, 'Indexed')).toBe('○');
    });

    it('still renders a confirmation count on the confirmed row (chainTip preserved)', () => {
        render(
            <TxStatusTimeline
                entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }}
                chainTip={104}
            />,
        );
        expect(screen.getByText(/5 confirmations/)).toBeInTheDocument();
    });
});
