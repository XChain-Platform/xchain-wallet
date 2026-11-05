// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the oracle price screen lays out through the FormPage
// template: the address-load error leads the page as FormPage's status, the
// loading line and the broadcast result sit inside the form, and the unsigned
// and queued result screens render inside a FormPage too. None of them draws
// straight into the bare Screen.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleForm } from '../../../packages/core/src/shared/routes/OracleForm.jsx';

const SOURCE_PATH = 'packages/core/src/shared/routes/OracleForm.jsx';

const BTC_ADDRESS = Object.freeze({
    id: 'addr-btc-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

/**
 * Watcher-mode messaging: Preview opens the local review and the build call
 * returns `built`, so the done stage shows that result.
 */
function messagingFor({ getAddressesByChain, built = { txid: 'oracle-txid' } } = {}) {
    const target = {
        getAddressesByChain: getAddressesByChain || (() => Promise.resolve({ 'bitcoin-mainnet': [BTC_ADDRESS] })),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        oracleFeeds: () => Promise.resolve([]),
        oracleConsumers: () => Promise.resolve({ supported: true, dispensers: [] }),
        buildActionPsbtRequest: () => Promise.resolve(built),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
        has: (t, prop) => prop in t,
    });
}

async function mount(opts) {
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messagingFor(opts)}>
                <OracleForm walletId="w" onBack={() => {}} initialChainId="bitcoin-mainnet" />
            </MessagingProvider>,
        );
        await drainMicrotasks();
    });
    return utils;
}

async function step(fn) {
    await domAct(async () => { fn(); await drainMicrotasks(); });
}

/** Fills the form, opens the watcher review and builds the transaction. */
async function publish(utils) {
    await step(() => fireEvent.change(utils.getByLabelText(/^Token ticker/), { target: { value: 'PEPECASH' } }));
    await step(() => fireEvent.change(utils.getByLabelText(/^Price of one/), { target: { value: '0.05' } }));
    await step(() => fireEvent.click(utils.getByRole('button', { name: 'Preview' })));
    const build = utils.getByRole('button', { name: 'Create unsigned transaction' });
    await step(() => fireEvent.submit(build.closest('form')));
}

/** The element whose text matches, searched among the given tags. */
function byText(container, selector, text) {
    return Array.from(container.querySelectorAll(selector)).find((node) => node.textContent.includes(text)) || null;
}

describe('OracleForm lays out every page state through FormPage', () => {
    it('shows the address-load error as the FormPage status', async () => {
        const { container } = await mount({
            getAddressesByChain: () => Promise.reject(new Error('Address store unavailable')),
        });
        const status = container.querySelector('[data-form-status]');
        expect(status).not.toBeNull();
        expect(status.textContent).toContain('Address store unavailable');
        expect(container.querySelector('form')).not.toBeNull();
    });

    it('puts the loading line inside the FormPage form', async () => {
        const { container } = await mount({ getAddressesByChain: () => new Promise(() => {}) });
        const loading = byText(container, 'p', 'Loading');
        expect(loading).not.toBeNull();
        expect(loading.closest('form')).not.toBeNull();
    });

    it('puts the broadcast result and its actions inside the FormPage form', async () => {
        const utils = await mount();
        await publish(utils);
        const title = byText(utils.container, 'h2', 'Price publish broadcast');
        expect(title).not.toBeNull();
        const form = title.closest('form');
        expect(form).not.toBeNull();
        expect(form.textContent).toContain('oracle-txid');
        expect(byText(form, 'button', 'Publish another')).not.toBeNull();
        expect(byText(form, 'button', 'Done')).not.toBeNull();
        expect(utils.container.querySelectorAll('h2')).toHaveLength(1);
    });

    it.each([
        ['an unsigned PSBT', { psbtHex: '70736274ff' }],
        ['queued for broadcast', { queued: true, txid: 'queued-txid' }],
    ])('renders the result screen for %s inside a FormPage form', async (_label, built) => {
        const utils = await mount({ built });
        await publish(utils);
        const notice = utils.container.querySelector('[data-testid="result-screen-notice"]');
        expect(notice).not.toBeNull();
        expect(notice.closest('form')).not.toBeNull();
    });

    it('hands every Screen state to a page template in the source', () => {
        const source = readFileSync(SOURCE_PATH, 'utf8');
        const roots = [...source.matchAll(/\bwrap\(\s*<(\w*)/g)].map((match) => match[1]);
        expect(roots.length).toBeGreaterThan(0);
        expect(roots.filter((root) => root !== 'FormPage' && root !== 'ListPage')).toEqual([]);
    });
});
