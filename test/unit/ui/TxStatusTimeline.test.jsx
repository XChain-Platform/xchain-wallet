// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Unit: §28.3. TxStatusTimeline renders the full five-stage
// ladder (Signed, Broadcast, mempool, Confirmed, Processed), computing each
// stage's done/pending state from the entry fields plus the optional
// chainTip / indexerWatermark props.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TxStatusTimeline } from '../../../packages/core/src/shared/components/TxStatusTimeline.jsx';
import { QueuedResultPanel } from '../../../packages/core/src/shared/components/QueuedResultPanel.jsx';

const timelineCss = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/TxStatusTimeline.module.css',
), 'utf8');
const queuedCss = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/QueuedResultPanel.module.css',
), 'utf8');

// The component uses ● for done stages and ○ for pending. Helper: map each
// stage row (by its label text's containing <li>) to its done marker.
function markerFor(container, labelText) {
    const label = screen.getByText(labelText);
    const li = label.closest('li');
    const dot = li.querySelector('span[aria-hidden="true"]');
    return dot.textContent;
}

describe('<TxStatusTimeline>', () => {
    it('renders all five stages including Signed and Processed', () => {
        render(<TxStatusTimeline entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }} />);
        expect(screen.getByText('Signed')).toBeInTheDocument();
        expect(screen.getByText('Broadcast')).toBeInTheDocument();
        expect(screen.getByText('Processed')).toBeInTheDocument();
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

    it('marks Processed done when the watermark reaches the entry block', () => {
        const { container } = render(
            <TxStatusTimeline
                entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }}
                indexerWatermark={150}
            />,
        );
        expect(markerFor(container, 'Processed')).toBe('●');
        expect(screen.getByText(/the service has reached block 150/)).toBeInTheDocument();
    });

    it('leaves Processed pending when the watermark trails the entry block', () => {
        const { container } = render(
            <TxStatusTimeline
                entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }}
                indexerWatermark={90}
            />,
        );
        expect(markerFor(container, 'Processed')).toBe('○');
        expect(screen.getByText(/still catching up/)).toBeInTheDocument();
    });

    it('treats a confirmed row as indexed when no watermark is supplied', () => {
        const { container } = render(
            <TxStatusTimeline entry={{ txHash: 'abc', blockIndex: 100, timestamp: 0 }} />,
        );
        expect(markerFor(container, 'Processed')).toBe('●');
    });

    it('leaves Processed pending for an unconfirmed (mempool) entry', () => {
        const { container } = render(
            <TxStatusTimeline entry={{ txHash: 'abc', blockIndex: 0, timestamp: 0 }} />,
        );
        expect(markerFor(container, 'Processed')).toBe('○');
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

    it('labels every step state in words and marks the current step semantically', () => {
        render(<TxStatusTimeline entry={{ txHash: 'abc', blockIndex: 0, timestamp: 0 }} />);
        const timeline = screen.getByRole('list', { name: 'Transaction status' });
        expect(within(timeline).getAllByText('Complete')).toHaveLength(2);
        expect(within(timeline).getByText('Current stage')).toBeInTheDocument();
        expect(within(timeline).getAllByText('Not started')).toHaveLength(2);
        expect(timeline.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
        expect(timeline.querySelector('[aria-current="step"]')).toHaveTextContent('Broadcast, awaiting network');
    });

    it('makes a failed step current and gives a direct next step', () => {
        render(<TxStatusTimeline entry={{
            txHash: '',
            blockIndex: 0,
            timestamp: 0,
            pending: { failed: true },
        }} />);
        const current = screen.getByText('Current stage: Failed').closest('li');
        expect(current).toHaveAttribute('aria-current', 'step');
        expect(current).toHaveTextContent('Failed');
        expect(current).toHaveTextContent(
            "Review the failure reason in this transaction's details, correct the problem, and try again",
        );
    });

    it('states the queued current step and its required next action', () => {
        render(<QueuedResultPanel onDone={vi.fn()} />);
        expect(screen.getByText('Current stage: Waiting to broadcast')).toBeInTheDocument();
        expect(screen.getByText(/only goes out when you broadcast it from there/i)).toBeInTheDocument();
    });

    it('keeps both status surfaces shrinkable at a 320px viewport', () => {
        expect(timelineCss).toMatch(/grid-template-columns:\s*20px minmax\(0, 1fr\)/);
        expect(timelineCss).toMatch(/@media \(max-width: 360px\)/);
        expect(timelineCss).toMatch(/overflow-wrap:\s*anywhere/);
        expect(queuedCss).toMatch(/box-sizing:\s*border-box/);
        expect(queuedCss).toMatch(/width:\s*100%/);
        expect(queuedCss).toMatch(/@media \(max-width: 360px\)/);
        expect(queuedCss).toMatch(/overflow-wrap:\s*anywhere/);
    });
});
