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
function messagingFor({ getAddressesByChain, built = { txid: 'market-txid' } } = {}) {
    const target = {
        getAddressesByChain: getAddressesByChain || (() => Promise.resolve({ [CHAIN]: [HD_ADDRESS] })),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        betProjectFeedCreateFee: () => Promise.resolve({
            durationSeconds: 3801600, days: 44, billableDays: 0, free: true, fee: '0.00000000',
        }),
        buildBetActionPsbtRequest: () => Promise.resolve(built),
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
        typeIn('What is being bet on', 'Who wins the final?');
        typeIn('Outcome 0', 'Home');
        typeIn('Outcome 1', 'Away');
        typeIn('Betting closes', DEADLINE_LOCAL);
        await drain();
    });
    const submit = Array.from(utils.container.querySelectorAll('button'))
        .find((b) => /Create unsigned transaction/.test(b.textContent || ''));
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
        const summary = byText(utils.container, 'p', 'Market submitted');
        expectInsideTemplate(summary);
        const page = summary.closest(templateSelector());
        expect(page.textContent).toContain('Transaction ID');
        expect(page.textContent).toContain('market-txid');
        expectInsideTemplate(byText(page, 'button', 'Done'));
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
        expect(roots.filter(({ name }) => name !== 'FormPage' && name !== 'ListPage')
            .map(({ line, name }) => `CreateBetFeedForm.jsx:${line} wrap(${name})`)).toEqual([]);
    });
});
