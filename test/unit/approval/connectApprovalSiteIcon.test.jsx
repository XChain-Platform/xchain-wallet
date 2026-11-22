// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The connect prompt shows the requesting site's own icon (captured in its
// page at connect time) or its coloured initials. The icon is re-checked in
// the prompt, so a URL or non-PNG value never becomes an <img src> the
// approval window would fetch.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { pngDataUrl } from '../../helpers/siteIconFixtures.js';

vi.mock('../../../packages/core/src/shared/approval/index.js', () => ({
    getSettings: async () => ({}),
    resolveApproval: async () => ({ approved: true }),
}));

const { ConnectApproval } = await import(
    '../../../packages/core/src/shared/approval/ConnectApproval.jsx'
);

function mount(payload) {
    return render(<ConnectApproval id="req-icon" payload={payload} onReject={() => {}} />);
}

afterEach(() => cleanup());

describe('ConnectApproval site icon', () => {
    it('shows the captured icon as a data-URL image', () => {
        const icon = pngDataUrl(64, 64);
        const { container } = mount({ origin: 'https://dapp.example', appName: 'Example dApp', icon });
        const holder = screen.getByTestId('site-icon');
        expect(holder.getAttribute('data-site-icon')).toBe('image');
        const img = holder.querySelector('img');
        expect(img.getAttribute('src')).toBe(icon);
        expect(img.getAttribute('alt')).toBe('');
        expect(holder.textContent).toBe('');
        // The origin block is still the identity the user reads.
        expect(container.textContent).toContain('https://dapp.example');
    });

    it('falls back to coloured initials with no icon', () => {
        mount({ origin: 'https://app.uniswap.org', appName: 'https://app.uniswap.org', icon: null });
        const holder = screen.getByTestId('site-icon');
        expect(holder.getAttribute('data-site-icon')).toBe('initials');
        expect(holder.querySelector('img')).toBeNull();
        expect(holder.textContent).toBe('UN');
    });

    it('uses the declared name for initials', () => {
        mount({ origin: 'https://dapp.example', appName: 'Example dApp' });
        expect(screen.getByTestId('site-icon').textContent).toBe('ED');
    });

    it('never renders a URL, SVG or markup icon as an image', () => {
        for (const icon of [
            'https://tracker.example/pixel.png',
            'data:image/svg+xml,<svg onload=alert(1)>',
            '"><img src=x onerror=alert(1)>',
        ]) {
            const { unmount } = mount({ origin: 'https://dapp.example', appName: 'Example dApp', icon });
            const holder = screen.getByTestId('site-icon');
            expect(holder.querySelector('img')).toBeNull();
            expect(holder.textContent).toBe('ED');
            unmount();
        }
    });

    it('shows no icon for an invalid request', () => {
        mount({ origin: 'null', appName: 'x', icon: pngDataUrl() });
        expect(screen.queryByTestId('site-icon')).toBeNull();
    });
});
