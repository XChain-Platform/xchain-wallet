// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-27: behavioral tests for the sandboxed gated-file viewer. The
// old viewer opened attacker bytes as a wallet-origin document via a
// declared-MIME allowlist; these tests pin the replacement's render
// decisions: sniffed bytes choose the surface, HTML/SVG never become
// live markup, and the declared type only ever contributes a label
// and a mismatch warning.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { GatedFileViewer } from '../../../packages/core/src/shared/components/GatedFileViewer.jsx';
import { MarketLifecycleTimeline } from '../../../packages/core/src/shared/components/MarketLifecycleTimeline.jsx';

const b64 = (input) => Buffer.from(input).toString('base64');
const PNG_BYTES = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('fakepixels'),
]);

beforeAll(() => {
    // jsdom ships no blob-URL support; the viewer only hands the URL
    // to <img>, so a marker string is enough to observe the wiring.
    URL.createObjectURL = vi.fn(() => 'blob:viewer-test');
    URL.revokeObjectURL = vi.fn();
});

afterEach(cleanup);

function show(props) {
    return render(
        <GatedFileViewer
            name={props.name || 'file.bin'}
            declaredType={props.declaredType}
            plaintextBase64={props.plaintextBase64}
            onClose={props.onClose || (() => {})}
        />,
    );
}

describe('GatedFileViewer render decisions', () => {
    it('renders declared-text/html script payloads as inert text, never as markup', () => {
        const payload = '<!doctype html><script>window.PWNED = 1;</script>';
        const { container } = show({ declaredType: 'text/html', plaintextBase64: b64(payload) });

        // The markup appears as TEXT inside <pre>, not as parsed elements.
        const pre = container.querySelector('pre');
        expect(pre).toBeTruthy();
        expect(pre.textContent).toContain('<script>window.PWNED = 1;</script>');
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('iframe')).toBeNull();
        expect(window.PWNED).toBeUndefined();
    });

    it('renders sniffed SVG only via <img>, never as inline SVG elements', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="window.PWNED=2"><circle r="1"/></svg>';
        const { container } = show({ declaredType: 'image/svg+xml', plaintextBase64: b64(svg) });

        const img = container.querySelector('img');
        expect(img).toBeTruthy();
        expect(img.getAttribute('src')).toBe('blob:viewer-test');
        // The attacker's SVG never becomes live DOM (UI chrome has its
        // own decorative inline SVGs, so probe for the payload markup).
        expect(container.querySelector('svg[onload]')).toBeNull();
        expect(container.querySelector('circle')).toBeNull();
        expect(window.PWNED).toBeUndefined();
        // Blob typed from the SNIFFED mime.
        const blobArg = vi.mocked(URL.createObjectURL).mock.calls.at(-1)[0];
        expect(blobArg.type).toBe('image/svg+xml');
    });

    it('renders a sniffed PNG via <img> and warns when the declared type disagrees', () => {
        const { container, getByRole } = show({
            declaredType: 'text/plain', plaintextBase64: b64(PNG_BYTES),
        });
        expect(container.querySelector('img')).toBeTruthy();
        expect(getByRole('alert').textContent).toMatch(/doesn't match/);
    });

    it('refuses to preview unidentifiable bytes declared as an image, with a mismatch warning', () => {
        const { container, getByRole, getByText } = show({
            declaredType: 'image/png',
            plaintextBase64: b64(Buffer.from([0xc3, 0x28, 0x00, 0x01, 0xff])),
        });
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('pre')).toBeNull();
        expect(getByText(/can't be previewed/)).toBeTruthy();
        expect(getByRole('alert').textContent).toMatch(/doesn't match/);
    });

    it('keeps PDF download-only', () => {
        const { container, getByText } = show({
            declaredType: 'application/pdf', plaintextBase64: b64('%PDF-1.7 x'),
        });
        expect(container.querySelector('img')).toBeNull();
        expect(getByText(/PDF preview is disabled/)).toBeTruthy();
    });

    it('always offers Download and shows the sniffed kind in the meta line', () => {
        const { getByText } = show({ declaredType: 'text/plain', plaintextBase64: b64('hello') });
        expect(getByText('Download')).toBeTruthy();
        expect(getByText(/detected: plain text/)).toBeTruthy();
    });

    it('announces invalid unlocked data as a failure and disables Download', () => {
        const { getByRole } = show({ declaredType: null, plaintextBase64: '%%%' });

        expect(getByRole('alert')).toHaveTextContent('Could not decode the unlocked file');
        expect(getByRole('button', { name: 'Download' })).toBeDisabled();
    });

    it('announces image loading and replaces a failed preview with download guidance', () => {
        const { getByRole, getByAltText, queryByAltText } = show({
            name: 'broken.png',
            declaredType: 'image/png',
            plaintextBase64: b64(PNG_BYTES),
        });

        expect(getByRole('status')).toHaveTextContent('Loading image preview');
        fireEvent.error(getByAltText('broken.png'));

        expect(getByRole('alert')).toHaveTextContent('Image preview failed to load');
        expect(queryByAltText('broken.png')).toBeNull();
        expect(getByRole('button', { name: 'Download' })).toBeEnabled();
    });

    it('does not inline-preview files larger than 5 MB and keeps Download available', () => {
        const largePng = Buffer.concat([PNG_BYTES, Buffer.alloc((5 * 1024 * 1024) + 1)]);
        const { container, getByText, getByRole } = show({
            name: 'large.png',
            declaredType: 'image/png',
            plaintextBase64: b64(largePng),
        });

        expect(container.querySelector('img')).toBeNull();
        expect(getByText(/larger than 5 MB/)).toBeTruthy();
        expect(getByRole('button', { name: 'Download' })).toBeEnabled();
    });
});

describe('MarketLifecycleTimeline states', () => {
    const baseProps = {
        kind: 'order',
        chainId: 'chain-a',
        address: 'owner-a',
        actionIndex: 7,
        createdBlock: 10,
    };

    it('announces the loading state', () => {
        const messaging = { getOrderLifecycle: vi.fn(() => new Promise(() => {})) };
        render(<MarketLifecycleTimeline {...baseProps} messaging={messaging} />);

        expect(screen.getByRole('status')).toHaveTextContent('Loading timeline');
    });

    it('shows request failures instead of silently presenting an incomplete timeline', async () => {
        const messaging = { getOrderLifecycle: vi.fn(() => Promise.reject(new Error('Lifecycle request failed.'))) };
        render(<MarketLifecycleTimeline {...baseProps} messaging={messaging} />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Lifecycle request failed.');
    });

    it('labels every lifecycle stage in text', async () => {
        const rows = {
            edits: [{ order_action_index: 7, action_index: 11, block_index: 11 }],
            matches: [{ give_action_index: 7, action_index: 12, block_index: 12, give_amount: '2', give_tick: 'XCH' }],
            expires: [{ order_action_index: 7, action_index: 13, block_index: 13 }],
            cancels: [{ order_action_index: 7, action_index: 14, block_index: 14 }],
        };
        const messaging = {
            getOrderLifecycle: vi.fn(({ kind }) => Promise.resolve({ data: rows[kind] })),
        };
        render(<MarketLifecycleTimeline {...baseProps} messaging={messaging} />);

        await waitFor(() => expect(screen.getByRole('list', { name: 'Trade lifecycle' })).toBeTruthy());
        for (const label of ['Created', 'Edited', 'Filled / matched', 'Expired', 'Cancelled']) {
            expect(screen.getByText(label)).toBeTruthy();
        }
    });
});
