// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CreateOrderForm's wrap() helper is a bare Screen. The load error, the
// loading line and the broadcast panel reach the page through FormPage like
// the form and review stages do, so no state draws straight into the Screen
// content box and every state keeps the form's page edge and rhythm.

import React from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// One messaging object for every render, so effects keyed on it run once.
const state = vi.hoisted(() => ({
    loadError: null,
    hook: {
        messaging: {
            getSettings: async () => ({ preflightPrivacy: 'report' }),
            getAutopayExposure: async () => ({ total: 0 }),
            getWalletBalances: async () => ({}),
            getSignerStatus: async () => ({ status: 'unlocked' }),
        },
        shell: 'web',
    },
}));

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => state.hook,
    screenVariantFor: () => 'web',
}));

vi.mock('../../../packages/core/src/shared/hooks/useWalletMode.js', () => ({
    useWalletMode: () => ({ isWatcherMode: false }),
}));

// Every page-state case renders before the addresses load, so the hook
// result is the same object on every render.
const EMPTY_CHAINS = [];
const NOOP = () => {};
const actionForm = {
    addressesByChain: null,
    chainId: null,
    setChainId: NOOP,
    chainsWithAddresses: EMPTY_CHAINS,
    fromAddress: null,
    setFromAddressId: NOOP,
    descriptor: null,
    signerReady: true,
    isHwSource: false,
    hwStatus: 'available',
    onHwStatusChange: NOOP,
    buildFrom: () => null,
    submit: async () => ({}),
};
vi.mock('../../../packages/core/src/shared/hooks/useActionForm.js', () => ({
    useActionForm: () => ({ ...actionForm, loadError: state.loadError }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: { preflightPrivacy: 'report' } }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', () => ({
    useConfirmAction: () => ({ phase: 'idle', composing: false, confirm: () => {} }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useSignerInfo.js', () => ({
    useSignerInfo: () => null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useNativeFee.js', () => ({
    useNativeFee: () => ({
        flag: undefined,
        mandatory: false,
        toggleProps: { checked: false, onChange: () => {}, mandatory: false },
    }),
}));

import { CreateOrderForm } from '../../../packages/core/src/shared/routes/CreateOrderForm.jsx';

const routePath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../packages/core/src/shared/routes/CreateOrderForm.jsx',
);

function wrapCallArgs() {
    const tree = parse(readFileSync(routePath, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    const calls = [];
    const visit = (node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'wrap') {
            calls.push(node.arguments[0]);
        }
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    };
    visit(tree.program);
    return calls;
}

const rootName = (arg) => (arg?.type === 'JSXElement' && arg.openingElement.name.type === 'JSXIdentifier'
    ? arg.openingElement.name.name
    : (arg?.type || 'none'));

const hasDescendant = (node, test) => {
    if (!node || typeof node !== 'object') return false;
    if (test(node)) return true;
    return Object.values(node).some((value) => (Array.isArray(value)
        ? value.some((item) => hasDescendant(item, test))
        : (value && typeof value === 'object' ? hasDescendant(value, test) : false)));
};

beforeEach(() => {
    state.loadError = null;
});

afterEach(() => cleanup());

describe('CreateOrderForm: the load error, loading line and broadcast panel render inside FormPage', () => {
    it('lays out the load error in the FormPage status region as an alert', () => {
        state.loadError = 'Address store unavailable';
        const { container } = render(<CreateOrderForm walletId="wallet-1" onBack={() => {}} />);
        const error = screen.getByText('Address store unavailable');
        expect(error.closest('[role="alert"]'), 'inside a role=alert StatusMessage').not.toBeNull();
        expect(error.closest('[data-form-status]'), 'inside the FormPage status region').not.toBeNull();
        expect(container.querySelector('form[aria-label="Create order"]'), 'a FormPage root').not.toBeNull();
    });

    it('lays out the loading line inside a FormPage root', () => {
        render(<CreateOrderForm walletId="wallet-1" onBack={() => {}} />);
        const loading = screen.getByText('Loading…');
        const page = screen.getByRole('group', { name: 'Create order' });
        expect(page).toContainElement(loading);
    });

    it('passes FormPage or ResultScreen to every wrap() call, the broadcast panel included', () => {
        const calls = wrapCallArgs();
        expect(calls.length).toBeGreaterThanOrEqual(5);
        const faults = calls
            .filter((arg) => !['FormPage', 'ResultScreen'].includes(rootName(arg)))
            .map((arg) => `CreateOrderForm.jsx:${arg?.loc?.start.line} wrap(${rootName(arg)})`);
        expect(faults).toEqual([]);
        const broadcast = calls.filter((arg) => hasDescendant(arg, (node) => node.type === 'JSXText'
            && node.value.includes('Order broadcast')));
        expect(broadcast.map(rootName)).toEqual(['FormPage']);
    });
});
