// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the open-a-market screen lays out through a page template:
// the address-load error, the loading line, the submitted-market panel and
// both ResultScreen states sit inside ListPage within the same Screen the form
// stage uses, so none of them draws straight into the bare Screen box with no
// template edge or rhythm.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';
import * as walletModes from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const SOURCE_PATH = join(__dirname, '..', '..', '..', 'packages', 'core', 'src', 'shared', 'routes', 'CreateBetFeedForm.jsx');

const CHAIN = 'bitcoin-mainnet';
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const DEADLINE_LOCAL = '2027-06-01T12:00';

beforeEach(() => {
    vi.useRealTimers();
});

afterEach(() => {
    cleanup();
    walletModes.resetWalletModes?.();
});

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
}

/**
 * Watcher-mode messaging: submit calls the build request and the form shows
 * whatever it returns as its result.
 */
function messagingFor({
    getAddressesByChain,
    built = { txid: 'market-txid' },
    buildBetActionPsbtRequest = () => Promise.resolve(built),
} = {}) {
    const target = {
        getAddressesByChain: getAddressesByChain || (() => Promise.resolve({ [CHAIN]: [HD_ADDRESS] })),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        betProjectFeedCreateFee: () => Promise.resolve({
            durationSeconds: 3801600, days: 44, billableDays: 0, free: true, fee: '0.00000000',
        }),
        buildBetActionPsbtRequest,
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
    // A wallet's mode is published by the shell from the wallet list, not read from settings.
    walletModes.publishWalletModes?.({ wallets: [{ id: 'w', walletMode: 'watcher' }], activeWalletId: 'w' });
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messagingFor(opts)}>
                <CreateBetFeedForm walletId="w" onBack={() => {}} chainId={CHAIN} presetTick="PEPECREATURE" />
            </MessagingProvider>,
        );
        await drain();
    });
    return utils;
}

/** Fills the minimum a valid market needs and builds it. */
async function buildMarket(utils) {
    await domAct(async () => {
        const typeIn = (label, value) => fireEvent.change(utils.getByLabelText(label), { target: { value } });
        typeIn('Question', 'Who wins the final?');
        typeIn('Outcome 1', 'Home');
        typeIn('Outcome 2', 'Away');
        typeIn('Closes', DEADLINE_LOCAL);
        await drain();
    });
    const submit = Array.from(utils.container.querySelectorAll('button'))
        .find((b) => /Create Unsigned Transaction/.test(b.textContent || ''));
    expect(submit).toBeTruthy();
    await domAct(async () => {
        fireEvent.click(submit);
        await drain();
    });
}

// The root class of each template, read from the component itself so the
// check follows the CSS-module naming the test run uses.
function templateSelector() {
    const list = render(<ListPage><p>x</p></ListPage>);
    const listClass = list.container.firstChild.className.split(' ')[0];
    list.unmount();
    const form = render(<FormPage onSubmit={() => {}} label="x"><p>x</p></FormPage>);
    const formClass = form.container.querySelector('form').className.split(' ')[0];
    form.unmount();
    return [listClass, formClass].map((name) => `.${CSS.escape(name)}`).join(', ');
}

function expectInsideTemplate(element) {
    expect(element, 'element rendered').toBeTruthy();
    expect(element.closest(templateSelector()), 'inside ListPage or FormPage').not.toBeNull();
}

function byText(container, selector, text) {
    return Array.from(container.querySelectorAll(selector)).find((node) => node.textContent.includes(text)) || null;
}

describe('CreateBetFeedForm lays out every page state through a template', () => {
    it('shows the address-load error through StatusMessage inside a template', async () => {
        const { container } = await mount({
            getAddressesByChain: () => Promise.reject(new Error('Address store unavailable')),
        });
        const status = byText(container, '[role="alert"], [role="status"]', 'Address store unavailable');
        expectInsideTemplate(status);
    });

    it('puts the loading line inside a template', async () => {
        const { container } = await mount({ getAddressesByChain: () => new Promise(() => {}) });
        expectInsideTemplate(byText(container, 'p', 'Loading addresses'));
    });

    it('puts the submitted-market summary, transaction id and Done inside one template', async () => {
        const utils = await mount();
        await buildMarket(utils);
        // The shared result screen: notice, a fact row, the note in a WarningCard.
        const summary = utils.container.querySelector('[data-testid="result-screen-notice"]');
        expect(summary?.textContent).toContain('Market submitted');
        expectInsideTemplate(summary);
        const page = summary.closest(templateSelector());
        expect(page.textContent).toContain('Transaction ID');
        expect(page.textContent).toContain('market-txid');
        expect(page.querySelector('[data-bet-create-permanent]')?.textContent).toContain('permanent');
        expect(page.querySelector('dt')).toBeNull();
        expectInsideTemplate(byText(page, 'button', 'Done'));
    });

    it('forwards the selected Fast fee rate to the watcher build', async () => {
        const buildBetActionPsbtRequest = vi.fn().mockResolvedValue({ txid: 'market-txid' });
        const utils = await mount({ buildBetActionPsbtRequest });
        await domAct(async () => {
            fireEvent.click(utils.container.querySelector('[data-form-section="fee"] [data-form-section-toggle]'));
            fireEvent.click(utils.container.querySelector('button[aria-label="Fast"]'));
            await drain();
        });
        expect(utils.getByRole('slider', { name: 'Network fee' })).toHaveAttribute(
            'aria-valuetext', expect.stringMatching(/^Fast: /),
        );

        await buildMarket(utils);
        expect(buildBetActionPsbtRequest).toHaveBeenCalledWith(expect.objectContaining({ feePerKb: 12_000 }));
    });

    it.each([
        ['an unsigned PSBT', { psbtHex: '70736274ff00', chainId: CHAIN }],
        ['queued for broadcast', { queued: true, txid: 'queued-txid' }],
    ])('renders the result screen for %s inside a template', async (_label, built) => {
        const utils = await mount({ built });
        await buildMarket(utils);
        expectInsideTemplate(utils.container.querySelector('[data-testid="result-screen-notice"]'));
    });

    it('hands no raw p, StatusMessage, fragment or ResultScreen to wrap() in the source', () => {
        const tree = parse(readFileSync(SOURCE_PATH, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
        const roots = [];
        const visit = (node) => {
            if (!node || typeof node !== 'object') return;
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
                const arg = node.arguments[0];
                roots.push({
                    line: node.loc.start.line,
                    name: arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier'
                        ? arg.openingElement.name.name
                        : (arg?.type || 'none'),
                });
            }
            for (const value of Object.values(node)) {
                if (Array.isArray(value)) value.forEach(visit);
                else if (value && typeof value === 'object') visit(value);
            }
        };
        visit(tree.program);
        expect(roots.length).toBeGreaterThanOrEqual(6);
        // FormFrame is the Form Standard's frame and renders FormPage.
        expect(roots.filter(({ name }) => name !== 'FormPage' && name !== 'FormFrame' && name !== 'ListPage')
            .map(({ line, name }) => `CreateBetFeedForm.jsx:${line} wrap(${name})`)).toEqual([]);
    });

    it('uses prediction market copy when a selected network is unsupported', () => {
        const source = readFileSync(SOURCE_PATH, 'utf8');
        expect(source).toContain('Prediction markets are not open on that network yet. Pick a token on another network.');
        expect(source).not.toContain('Betting markets are not open on that network yet.');
    });
});
