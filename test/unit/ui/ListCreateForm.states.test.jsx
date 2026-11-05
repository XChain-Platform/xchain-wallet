// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Every state of the create-list screen lays out through a page template,
// the same as its form and review stages: the address-load error, the
// no-addresses error, the loading line and each done-stage result sit inside
// ListPage, so the page edge and rhythm match the form on every shell. No
// call to the screen's wrap() hands Screen a bare child.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import listPageStyles from '../../../packages/core/src/ui/ListPage.module.css';

const SOURCE_PATH = 'packages/core/src/shared/routes/ListCreateForm.jsx';

const { runConfirm } = vi.hoisted(() => ({ runConfirm: vi.fn() }));

vi.mock('../../../packages/core/src/shared/hooks/useActionConfirmFlow.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useActionConfirmFlow: () => ({
            open: false,
            composing: false,
            confirmAction: {},
            run: runConfirm,
        }),
    };
});

const BTC = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'btc-source',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const MEMBER = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function mount({ getAddressesByChain } = {}) {
    const base = {
        getAddressesByChain: getAddressesByChain || vi.fn().mockResolvedValue({ [BTC]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        isListTickCoinActive: vi.fn().mockResolvedValue(false),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListCreateForm walletId="wallet-1" chainId={BTC} initialType="2" onBack={() => {}} />
        </MessagingProvider>,
    );
}

/** The closest ListPage container around a node, or null. */
function listPageOf(node) {
    return node.closest(`.${listPageStyles.page}`);
}

/** Fills one valid member and publishes through the mocked confirm flow. */
async function publish() {
    await screen.findByLabelText('From');
    fireEvent.change(screen.getByLabelText('Addresses'), { target: { value: MEMBER } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish list' }));
    await waitFor(() => expect(runConfirm).toHaveBeenCalled());
}

beforeEach(() => {
    __clearTokenInfoCache();
    runConfirm.mockReset();
});

afterEach(cleanup);

describe('ListCreateForm lays out every page state through a template', () => {
    it('puts the address-load error inside ListPage', async () => {
        mount({ getAddressesByChain: vi.fn().mockRejectedValue(new Error('Address store unavailable')) });
        const error = await screen.findByText('Address store unavailable');
        expect(listPageOf(error)).not.toBeNull();
    });

    it('puts the no-addresses error inside ListPage', async () => {
        mount({ getAddressesByChain: vi.fn().mockResolvedValue({}) });
        const error = await screen.findByText(/No addresses on any network yet/);
        expect(listPageOf(error)).not.toBeNull();
    });

    it('puts the loading line inside ListPage', () => {
        mount({ getAddressesByChain: () => new Promise(() => {}) });
        const loading = screen.getByText('Loading…');
        expect(listPageOf(loading)).not.toBeNull();
    });

    it('puts the published result, its transaction id and Done inside ListPage', async () => {
        runConfirm.mockResolvedValue({ txid: 'list-txid' });
        const { container } = mount();
        await publish();
        const title = await screen.findByText('List published');
        const page = listPageOf(title);
        expect(page).not.toBeNull();
        expect(page.textContent).toContain('list-txid');
        expect(page.querySelector('button')?.textContent).toBe('Done');
        expect(container.querySelectorAll('h2')).toHaveLength(1);
    });

    it.each([
        ['an unsigned PSBT', { psbtHex: '70736274ff' }],
        ['queued for broadcast', { queued: true, txid: 'queued-txid' }],
    ])('renders the result screen for %s inside ListPage', async (_label, built) => {
        runConfirm.mockResolvedValue(built);
        const { container } = mount();
        await publish();
        await waitFor(() => expect(container.querySelector('[data-testid="result-screen-notice"]')).not.toBeNull());
        const notice = container.querySelector('[data-testid="result-screen-notice"]');
        expect(listPageOf(notice)).not.toBeNull();
    });

    it('hands wrap() only a template, never a bare child', () => {
        const source = readFileSync(join(process.cwd(), SOURCE_PATH), 'utf8');
        const start = source.indexOf('export function ListCreateForm');
        const end = source.indexOf('function ContactAddressPickerScreen');
        const body = source.slice(start, end);
        const calls = [...body.matchAll(/\bwrap\(\s*<\s*([A-Za-z]*)/g)].map((match) => match[1]);
        expect(calls.length).toBeGreaterThan(0);
        const bare = calls.filter((tag) => tag !== 'ListPage' && tag !== 'FormPage');
        expect(bare).toEqual([]);
    });
});
