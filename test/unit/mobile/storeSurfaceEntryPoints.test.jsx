// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The other half of : nothing OFFERS the DEX when the build has none.
//
// `storeSurfaces.test.js` proves the route components are out of the bundle.
// That is not the same as proving a user (or an app reviewer) sees no way in,
// and the two can come apart in a specific way worth testing for: the labels
// still exist in the store bundle, because they sit in arrays inside shared
// modules that every build carries. What must be true is that NOTHING RENDERS
// them, so these tests render the real components in the state a store build
// puts them in.
//
// Rendered rather than asserted on source, because the failure this guards is a
// visible control, and because the fix it pins is specifically about how an
// absent handler renders: these surfaces used to draw a DISABLED button. A
// greyed-out "Decentralized Exchange" asks App Review exactly the question a
// working one does, and answers it worse - it says the app has an exchange and
// is hiding it.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MenuRoute } from '../../../packages/core/src/shared/routes/MenuRoute.jsx';
import { LeftNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { buildCommands } from '../../../packages/core/src/shared/commandPalette/commandRegistry.js';

const messaging = { getSettings: async () => ({ schemaVersion: 1, activeNetwork: 'mainnet' }) };

function draw(node) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>{node}</MessagingProvider>,
    );
}

afterEach(cleanup);

describe('the main menu', () => {
    it('offers the DEX rows when the shell wires them', () => {
        draw(<MenuRoute onBack={() => {}} onMarkets={() => {}} onMarketActivity={() => {}} />);
        expect(screen.queryByText('Decentralized Exchange')).toBeTruthy();
        expect(screen.queryByText('Marketplace')).toBeTruthy();
    });

    it('renders neither row when it does not', () => {
        // The store build passes no handler, because the destination is not in
        // the bundle. MenuRoute has always filtered on handler presence; this
        // pins that, since it is now load-bearing rather than tidy.
        draw(<MenuRoute onBack={() => {}} onTokens={() => {}} />);
        expect(screen.queryByText('Decentralized Exchange')).toBeNull();
        expect(screen.queryByText('Marketplace')).toBeNull();
    });
});

describe('the sidebar', () => {
    it('shows a DEX tab by default', () => {
        draw(<LeftNav currentView="home" onSelect={() => {}} />);
        expect(screen.queryByText('DEX')).toBeTruthy();
    });

    it('shows no DEX tab, disabled or otherwise, when the surface is absent', () => {
        draw(<LeftNav currentView="home" onSelect={() => {}} hasDexSurface={false} />);
        expect(screen.queryByText('DEX')).toBeNull();
        // The rest of the nav is untouched: this hides one surface, not a shell.
        expect(screen.queryByText('Home')).toBeTruthy();
        expect(screen.queryByText('Dispensers')).toBeTruthy();
    });
});

describe('the command palette', () => {
    const ids = (ctx) => buildCommands({ navigate: () => {}, ...ctx }).map((c) => c.id);

    it('carries the DEX and trade commands by default', () => {
        const list = ids({});
        for (const id of ['nav-markets', 'nav-my-orders', 'nav-my-swaps', 'trade-swap', 'trade-order', 'trade-xchain-swap']) {
            expect(list).toContain(id);
        }
    });

    it('drops exactly those when the surface is absent', () => {
        const list = ids({ hasDexSurface: false });
        for (const id of ['nav-markets', 'nav-my-orders', 'nav-my-swaps', 'trade-swap', 'trade-order', 'trade-xchain-swap']) {
            expect(list).not.toContain(id);
        }
        // Settling a match that already happened is a payment the user owes, not
        // a trade, and one seed spans shells: it stays on every build.
        expect(list).toContain('trade-coinpay');
        expect(list).toContain('nav-obligations');
        expect(list).toContain('trade-xchain-templates');
    });

    it('keeps the DEX when a shell says nothing, rather than losing it silently', () => {
        // Every shell but a surface-stripped store build passes no flag at all.
        expect(ids({ hasDexSurface: undefined })).toContain('nav-markets');
    });
});
