// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: a build that compiled the DEX surface out (the mobile store profile)
// offers no ORDER or SWAP in the generic composers, on the SDK list and the
// registry fallback alike, while every other build keeps them.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AdvancedActionsForm } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';
import {
    AUTHORABLE_ACTIONS,
    DEX_ACTIONS,
    isActionDataOfferedInBuild,
    isActionOfferedInBuild,
} from '../../../packages/core/src/registry/actions.js';

const BTC = 'bitcoin-mainnet';
const FROM = {
    id: 'address-1',
    address: 'bc1qdexsurfacefromaddress0000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const SDK_LIST = ['ORDER', 'SEND', 'SWAP', 'ISSUE'];
const DEDICATED = '(dedicated form available)';

afterEach(() => cleanup());

function messagingWith(listActions, extra = {}) {
    const target = {
        ...extra,
        getAddressesByChain: vi.fn(async () => ({ [BTC]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [BTC]: FROM })),
        getSettings: vi.fn(async () => ({ walletMode: 'full', activeNetwork: 'mainnet' })),
        signerReady: vi.fn(async () => ({ ready: true })),
        listActions,
    };
    return new Proxy(target, {
        get: (t, prop) => (prop in t ? t[prop] : () => Promise.resolve({ rows: [] })),
        has: (t, prop) => prop in t,
    });
}

function mount(element, listActions, extra) {
    render(
        <MessagingProvider shell="web" messaging={messagingWith(listActions, extra)}>
            {element}
        </MessagingProvider>,
    );
}

async function pickerValues() {
    const select = await waitFor(() => {
        const found = [...document.querySelectorAll('select')]
            .find((s) => s.querySelector('option[value="SEND"]'));
        expect(found).toBeTruthy();
        return found;
    });
    return [...select.querySelectorAll('option')].map((o) => o.value).filter(Boolean);
}

const sdkList = () => vi.fn(async () => [...SDK_LIST]);
const sdkDown = () => vi.fn(async () => { throw new Error('sdk down'); });

describe('isActionOfferedInBuild', () => {
    it('drops ORDER and SWAP, any case, only when the DEX surface is compiled out', () => {
        for (const a of ['ORDER', 'swap', 'Order']) {
            expect(isActionOfferedInBuild(a, { hasDexSurface: false })).toBe(false);
            expect(isActionOfferedInBuild(a, { hasDexSurface: true })).toBe(true);
            expect(isActionOfferedInBuild(a)).toBe(true);
        }
        expect(isActionOfferedInBuild('SEND', { hasDexSurface: false })).toBe(true);
    });

    it('names only actions the registry can author', () => {
        for (const a of DEX_ACTIONS) expect(AUTHORABLE_ACTIONS).toContain(a);
        expect(Object.isFrozen(DEX_ACTIONS)).toBe(true);
    });
});

describe('isActionDataOfferedInBuild', () => {
    const store = { hasDexSurface: false };
    const send = 'SEND|0|XCP|1|bc1qdest';

    it('refuses a BATCH carrying an ORDER or SWAP leg only when the DEX surface is compiled out', () => {
        for (const COMMAND of [
            `${send};ORDER|0|XCP|1|BTC|1`,
            'SWAP|0|XCP|1',
            `${send}; order |0|XCP|1|BTC|1`,
            'BATCH|0|ORDER|0|XCP|1|BTC|1',
            '"Swap"|0|XCP|1',
        ]) {
            expect(isActionDataOfferedInBuild({ action: 'BATCH', params: { COMMAND } }, store), COMMAND).toBe(false);
            expect(isActionDataOfferedInBuild({ action: 'batch', params: { command: COMMAND } }, store), COMMAND).toBe(false);
            expect(isActionDataOfferedInBuild({ action: 'BATCH', params: { COMMAND } }), COMMAND).toBe(true);
        }
    });

    it('keeps a BATCH whose legs are all non-DEX, and a MEMO that merely says ORDER', () => {
        const COMMAND = `${send};SEND|0|XCP|1|bc1qdest|ORDER`;
        expect(isActionDataOfferedInBuild({ action: 'BATCH', params: { COMMAND } }, store)).toBe(true);
        expect(isActionDataOfferedInBuild({ action: 'SEND', params: { MEMO: 'ORDER|0' } }, store)).toBe(true);
    });

    it('refuses a top-level ORDER or SWAP the same way isActionOfferedInBuild does', () => {
        expect(isActionDataOfferedInBuild({ action: 'ORDER', params: {} }, store)).toBe(false);
        expect(isActionDataOfferedInBuild({ action: 'SWAP' }, store)).toBe(false);
        expect(isActionDataOfferedInBuild({ action: 'ORDER' })).toBe(true);
    });
});

describe('AdvancedActionsForm raw BATCH', () => {
    const batchHost = () => ({
        getActionFormats: vi.fn(async () => ({ 0: 'VERSION|COMMAND' })),
        getActionFields: vi.fn(async () => ['VERSION', 'COMMAND']),
        validateAction: vi.fn(async () => ({ valid: true, errors: [] })),
        composeForConfirm: vi.fn(async () => { throw new Error('composed'); }),
    });

    async function submitBatch(props, host) {
        mount(<AdvancedActionsForm walletId="w" onBack={() => {}} {...props} />, vi.fn(async () => ['BATCH', 'SEND']), host);
        const select = await waitFor(() => {
            const found = document.querySelector('option[value="BATCH"]')?.closest('select');
            expect(found).toBeTruthy();
            return found;
        });
        fireEvent.change(select, { target: { value: 'BATCH' } });
        const command = await screen.findByLabelText('COMMAND');
        fireEvent.change(command, { target: { value: 'SEND|0|XCP|1|bc1qdest;ORDER|0|XCP|1|BTC|1' } });
        await waitFor(() => expect(host.validateAction).toHaveBeenCalled());
        const button = await screen.findByRole('button', { name: 'Sign action' });
        await waitFor(() => expect(button.disabled).toBe(false));
        fireEvent.click(button);
    }

    it('refuses a typed ORDER leg without the DEX surface and never composes it', async () => {
        const host = batchHost();
        await submitBatch({ hasDexSurface: false }, host);
        expect(await screen.findByText(/not available in this build, including as BATCH steps/)).toBeTruthy();
        expect(host.composeForConfirm).not.toHaveBeenCalled();
    });

    it('composes the same BATCH in a build with the DEX surface', async () => {
        const host = batchHost();
        await submitBatch({}, host);
        await waitFor(() => expect(host.composeForConfirm).toHaveBeenCalled());
        expect(screen.queryByText(/not available in this build/)).toBeNull();
    });
});

describe('AdvancedActionsForm picker', () => {
    it('keeps ORDER and SWAP, labelled, in a build with the DEX surface', async () => {
        mount(<AdvancedActionsForm walletId="w" onBack={() => {}} />, sdkList());
        const values = await pickerValues();
        expect(values).toEqual(expect.arrayContaining(['ORDER', 'SWAP', 'SEND']));
        expect(document.querySelector('option[value="ORDER"]').textContent).toContain(DEDICATED);
    });

    it('offers neither ORDER nor SWAP when the DEX surface is compiled out', async () => {
        mount(<AdvancedActionsForm walletId="w" onBack={() => {}} hasDexSurface={false} />, sdkList());
        const values = await pickerValues();
        expect(values).toContain('SEND');
        expect(values).not.toContain('ORDER');
        expect(values).not.toContain('SWAP');
        expect(screen.queryByText(/Order \(ORDER\)/)).toBeNull();
    });
});

describe('BatchComposerForm picker', () => {
    it('drops ORDER and SWAP from the SDK list and the fallback without the DEX surface', async () => {
        for (const listActions of [sdkList(), sdkDown()]) {
            mount(<BatchComposerForm walletId="w" onBack={() => {}} hasDexSurface={false} />, listActions);
            const values = await pickerValues();
            expect(values).not.toContain('ORDER');
            expect(values).not.toContain('SWAP');
            cleanup();
        }
    });

    it('keeps them by default', async () => {
        mount(<BatchComposerForm walletId="w" onBack={() => {}} />, sdkDown());
        expect(await pickerValues()).toEqual(expect.arrayContaining(['ORDER', 'SWAP']));
    });
});

describe('ParallelComposer picker and prefill', () => {
    it('drops ORDER and SWAP from the SDK list and the fallback without the DEX surface', async () => {
        for (const listActions of [sdkList(), sdkDown()]) {
            mount(
                <ParallelComposer
                    walletId="w"
                    onBack={() => {}}
                    hasDexSurface={false}
                    initialRows={[{ chainId: BTC, action: '', params: {} }]}
                />,
                listActions,
            );
            const values = await pickerValues();
            expect(values).not.toContain('ORDER');
            expect(values).not.toContain('SWAP');
            cleanup();
        }
    });

    it('refuses a prefilled ORDER row without the DEX surface and accepts it by default', async () => {
        const rows = [{ chainId: BTC, action: 'ORDER', params: { VERSION: '0' } }];
        mount(
            <ParallelComposer walletId="w" onBack={() => {}} hasDexSurface={false} initialRows={rows} />,
            sdkList(),
        );
        expect(await screen.findByText('Row 1: Order is not available in this build.')).toBeTruthy();
        cleanup();

        mount(<ParallelComposer walletId="w" onBack={() => {}} initialRows={rows} />, sdkList());
        await pickerValues();
        expect(screen.queryByText(/not available in this build/)).toBeNull();
    });

    it('refuses a prefilled BATCH row with an ORDER leg without the DEX surface', async () => {
        const rows = [{ chainId: BTC, action: 'BATCH', params: { COMMAND: 'SEND|0|XCP|1|bc1qdest;ORDER|0|XCP|1|BTC|1' } }];
        mount(
            <ParallelComposer walletId="w" onBack={() => {}} hasDexSurface={false} initialRows={rows} />,
            vi.fn(async () => [...SDK_LIST, 'BATCH']),
        );
        expect(await screen.findByText('Row 1: a BATCH step is not available in this build.')).toBeTruthy();
        cleanup();

        mount(<ParallelComposer walletId="w" onBack={() => {}} initialRows={rows} />, vi.fn(async () => [...SDK_LIST, 'BATCH']));
        await pickerValues();
        expect(screen.queryByText(/not available in this build/)).toBeNull();
    });
});

describe('web shell wiring', () => {
    it('passes the build DEX flag to all three generic composers', () => {
        const here = dirname(fileURLToPath(import.meta.url));
        const app = readFileSync(join(here, '..', '..', '..', 'packages', 'web', 'src', 'App.jsx'), 'utf8');
        for (const name of ['AdvancedActionsForm', 'BatchComposerForm', 'ParallelComposer']) {
            const block = app.match(new RegExp(`<${name}\\b[^>]*>`, 's'));
            expect(block, name).toBeTruthy();
            expect(block[0], name).toContain('hasDexSurface={DEX_SURFACE_ENABLED}');
        }
    });
});
