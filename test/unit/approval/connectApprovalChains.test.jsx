// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The connect prompt's chain checklist, mounted for real (§9.7 / §43.3).
//
// The approval window is its own MV3 realm with its own defaultRegistry(),
// so a chain the operator added in Developer Mode reaches it only through
// the settings record. The window boots against a locked vault, the boot
// read races the window's own request fetch, and a connect prompt carries
// no password gate, so the surface has to install the persisted chains
// itself and re-render when they land: a list and a pre-selection derived
// once in the component body offer bundled chains only for the life of the
// window, and a dApp that asked for the operator's chain gets a prompt that
// cannot grant it.
//
// The sibling smoke reads this file's TEXT. These cases render it.

import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { defaultRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

const shim = vi.hoisted(() => ({ getSettings: async () => ({}) }));
vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    getSettings: (...args) => shim.getSettings(...args),
    resolveApproval: async () => ({ approved: true }),
}));

const { ConnectApproval } = await import(
    '../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);

const template = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const bundled = BUNDLED_DESCRIPTORS[0];
const label = (d) => `Allow ${d.displayName} ${d.networkKind}`;
const custom = (id, displayName) => ({ ...template, id, displayName });

function mount(requestedChains) {
    return render(
        <ConnectApproval
            id="req-1"
            payload={{ origin: 'https://dapp.test', appName: 'Test dApp', requestedChains }}
            onReject={() => {}}
        />,
    );
}

afterEach(() => {
    cleanup();
    shim.getSettings = async () => ({});
});

describe('ConnectApproval chain checklist', () => {
    it('offers and pre-selects a user-added chain that arrives with the settings read', async () => {
        const added = custom('operator-connect', 'Operator Connect');
        shim.getSettings = async () => ({ customChains: [added] });

        mount([added.id]);

        const box = await screen.findByLabelText(label(added));
        expect(box.checked).toBe(true);
        expect(screen.getByRole('button', { name: 'Connect' }).disabled).toBe(false);
        expect(defaultRegistry().has(added.id)).toBe(true);
    });

    it('still renders the bundled chains when the settings read fails on a locked vault', async () => {
        shim.getSettings = async () => { throw new Error('vault is locked'); };

        mount([bundled.id]);

        const box = await screen.findByLabelText(label(bundled));
        expect(box.checked).toBe(true);
    });

    it('leaves a chain the user unchecked unchecked when hydration lands after it', async () => {
        const added = custom('operator-connect-late', 'Operator Late');
        let release = () => {};
        shim.getSettings = () => new Promise((resolve) => {
            release = () => resolve({ customChains: [added] });
        });

        mount([bundled.id, added.id]);

        const bundledBox = await screen.findByLabelText(label(bundled));
        expect(bundledBox.checked).toBe(true);
        fireEvent.click(bundledBox);
        expect(bundledBox.checked).toBe(false);

        await act(async () => { release(); await Promise.resolve(); });

        expect((await screen.findByLabelText(label(added))).checked).toBe(true);
        expect(screen.getByLabelText(label(bundled)).checked).toBe(false);
    });
});
