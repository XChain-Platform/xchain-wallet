// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Every state of the Publish file screen lays out through a page template:
// the address-load error, the loading line and the done-stage panels sit in
// ListPage, and the review stage sits in FormPage, so none of them draws
// straight into the bare Screen box that wrap() builds.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from '@babel/parser';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { ListPage } from '../../../packages/core/src/ui/ListPage.jsx';
import { FormPage } from '../../../packages/core/src/ui/FormPage.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qpublishpublishpublishpublishpublishpub',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(cleanup);

// Walk up from the cwd: under jsdom import.meta.url is an http: URL.
function routeSource() {
    let dir = process.cwd();
    while (!existsSync(join(dir, 'packages', 'core', 'src', 'shared', 'routes'))) {
        const up = dirname(dir);
        if (up === dir) throw new Error('packages/core/src/shared/routes not found above the cwd');
        dir = up;
    }
    return readFileSync(join(dir, 'packages', 'core', 'src', 'shared', 'routes', 'PublishFileForm.jsx'), 'utf8');
}

/** The root element name of the first argument of every wrap(...) call. */
function wrapCallRoots() {
    const tree = parse(routeSource(), { sourceType: 'module', plugins: ['jsx'] });
    const roots = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
            const arg = node.arguments[0];
            let name = arg?.type || 'none';
            if (arg?.type === 'JSXElement') name = arg.openingElement.name.name;
            if (arg?.type === 'JSXFragment') name = 'Fragment';
            roots.push({ line: node.loc.start.line, name });
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    };
    visit(tree.program);
    return roots;
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

function mount(getAddressesByChain) {
    const selector = templateSelector();
    const messaging = {
        getAddressesByChain,
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
        </MessagingProvider>,
    );
    return selector;
}

describe('PublishFileForm lays out every page state through a template', () => {
    it('passes a ListPage or FormPage to every wrap() call, the done-stage panels included', () => {
        const roots = wrapCallRoots();
        expect(roots.length).toBeGreaterThanOrEqual(6);
        const faults = roots
            .filter(({ name }) => !['ListPage', 'FormPage'].includes(name))
            .map(({ line, name }) => `PublishFileForm.jsx:${line} wrap(${name})`);
        expect(faults).toEqual([]);
    });

    it('lays out the address-load error inside a template', async () => {
        const selector = mount(vi.fn().mockRejectedValue(new Error('Address store unavailable')));
        const status = await screen.findByText('Address store unavailable');
        expect(status.closest(selector), 'inside ListPage or FormPage').not.toBeNull();
    });

    it('lays out the loading line inside a template', () => {
        const selector = mount(vi.fn(() => new Promise(() => {})));
        const loading = screen.getByText('Loading wallet…');
        expect(loading.closest(selector), 'inside ListPage or FormPage').not.toBeNull();
    });
});
