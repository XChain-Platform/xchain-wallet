// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings holds device data, so the shell's reachability notice stays off
// it, except on Network & endpoints, where a user fixes reachability: there it
// is the one message at the top of the page.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { Settings } from '../../../packages/core/src/shared/routes/Settings.jsx';

const noop = () => {};
const OFFLINE = { overall: 'offline', failedFast: true, perChain: [{ chainId: 'bitcoin-mainnet', mode: 'offline', services: {} }] };

function messaging() {
    const fixed = {
        getSettings: () => Promise.resolve({ ...createDefaultSettings(), developerMode: true }),
        listWallets: () => Promise.resolve([]),
        checkReachabilityRequest: () => Promise.resolve(OFFLINE),
    };
    return new Proxy({}, {
        get(target, property) {
            if (typeof property !== 'string' || property === 'then') return undefined;
            if (fixed[property]) return fixed[property];
            return /^(on|subscribe|add.*Listener)/.test(property) ? () => noop : () => Promise.resolve([]);
        },
    });
}

async function mount(initialSubpageId) {
    const view = render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <FullLayoutWithNav routeKey="settings:1" notices={<ReachabilityBanner startupGraceMs={0} confirmMs={0} intervalMs={600_000} />}>
                <Settings initialSubpageId={initialSubpageId} onBack={noop} />
            </FullLayoutWithNav>
        </MessagingProvider>,
    );
    await act(() => new Promise((resolve) => { setTimeout(resolve, 200); }));
    return view;
}

function notices(container) {
    const all = [...container.querySelectorAll('[data-variant]')];
    return all.filter((el) => /out of date/.test(el.textContent));
}

let saved;
beforeAll(() => {
    class Stub { observe() {} unobserve() {} disconnect() {} }
    saved = { ro: globalThis.ResizeObserver, io: globalThis.IntersectionObserver };
    globalThis.ResizeObserver = Stub;
    globalThis.IntersectionObserver = Stub;
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
});
afterAll(() => {
    globalThis.ResizeObserver = saved.ro;
    globalThis.IntersectionObserver = saved.io;
    vi.restoreAllMocks();
});
afterEach(cleanup);

describe('the shell reachability notice on Settings', () => {
    it('shows once on Network & endpoints, above the section', async () => {
        const { container } = await mount('network-endpoints');
        const shown = notices(container);
        expect(container.querySelector('[data-settings-page-template="subpage"]')).not.toBeNull();
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveTextContent('Try again');
        const main = container.querySelector('main');
        expect(main.firstElementChild.contains(shown[0])).toBe(true);
    });

    it.each(['keyboard', 'about'])('stays off the %s page', async (id) => {
        const { container } = await mount(id);
        expect(container.querySelector('[data-settings-page-template="subpage"]')).not.toBeNull();
        expect(notices(container)).toHaveLength(0);
    });
});
