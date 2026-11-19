// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Issue Token form's Subtoken template with its Parent token selector
// loaded: the field filled from a token, the field when the wallet owns no
// token, and the Parent token picker page listing the owned tokens. The route
// sweep renders the wizard with a messaging stub that never answers, so the
// selector itself is scanned here.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const CHAIN = 'bitcoin-regtest';
const OWNER = {
    id: 'addr-1',
    address: 'bcrt1qexampleexampleexampleexampleexample0',
    publicKey: '02ab',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
};

function makeMessaging(owned) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: OWNER }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'regtest' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getOwnedTokens: vi.fn().mockResolvedValue(owned.map((tick) => ({ tick }))),
        getTokenInfo: vi.fn().mockResolvedValue({}),
    };
}

function mount(owned, props = {}) {
    return render(
        <MessagingProvider shell="web" messaging={makeMessaging(owned)}>
            <TokenWizard walletId="w-a11y-parent" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

let savedGlobals;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    savedGlobals = {
        ResizeObserver: globalThis.ResizeObserver,
        IntersectionObserver: globalThis.IntersectionObserver,
        matchMedia: globalThis.matchMedia,
    };
    globalThis.ResizeObserver = StubObserver;
    globalThis.IntersectionObserver = StubObserver;
    globalThis.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

afterAll(() => {
    globalThis.ResizeObserver = savedGlobals.ResizeObserver;
    globalThis.IntersectionObserver = savedGlobals.IntersectionObserver;
    globalThis.matchMedia = savedGlobals.matchMedia;
});

describe('Issue Token Parent token accessibility', () => {
    it('scans the Subtoken template opened from a token', async () => {
        const { container } = mount(['PARENT'], { initialChainId: CHAIN, initialParentTick: 'PARENT' });
        await screen.findByRole('button', { name: /^Parent token: PARENT on / });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the Parent token field when the wallet owns no token', async () => {
        const { container } = mount([], { initialChainId: CHAIN, initialParentTick: '' });
        fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
        fireEvent.click(screen.getByRole('option', { name: /Subtoken/ }));
        await screen.findByRole('button', { name: 'Parent token: A subtoken needs a token you own' });
        await expectNoSeriousAxeViolations(container);
    });

    it('scans the Parent token picker page', async () => {
        const { container } = mount(['PARENT', 'PARENT.KID'], { initialChainId: CHAIN, initialParentTick: 'PARENT' });
        fireEvent.click(await screen.findByRole('button', { name: /^Parent token: PARENT on / }));
        await screen.findByRole('button', { name: /^Select PARENT\.KID on / });
        await expectNoSeriousAxeViolations(container);
    });
});
