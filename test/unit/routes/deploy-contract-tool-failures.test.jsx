// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'module.exports = { run() { return 0.5; } };';
const ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const INTERNAL = new TypeError("Cannot read properties of undefined (reading 'suggestGasLimit')");

async function drain() {
    await act(async () => {
        for (let i = 0; i < 16; i += 1) await Promise.resolve();
    });
}

async function mount(overrides) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        listContractTemplates: () => Promise.resolve({ templates: [], patterns: [] }),
        listPendingDeploys: () => Promise.resolve([]),
        planDeploy: () => Promise.resolve({ single: true, totalChunks: 0, codeHash: 'ab' }),
        getContractExportedMeta: () => Promise.resolve(null),
        ...overrides,
    };
    const messaging = new Proxy(target, {
        get: (object, property) => (property in object ? object[property] : () => Promise.resolve({})),
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DeployContractForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    await drain();
    fireEvent.change(screen.getByLabelText('Code source'), { target: { value: SOURCE } });
    await drain();
}

afterEach(() => cleanup());

describe('publish tool failures', () => {
    it('keeps an internal error out of the gas suggestion message', async () => {
        await mount({ suggestContractGasLimit: () => Promise.reject(INTERNAL) });
        fireEvent.click(screen.getByRole('button', { name: 'Suggest gas' }));
        await drain();

        expect(screen.getByText('Gas suggestion failed.')).toBeInTheDocument();
        expect(screen.queryByText(/Cannot read properties/)).toBeNull();
    });

    it('keeps an internal error out of the size check message', async () => {
        await mount({ checkContractCodeSize: () => Promise.reject(INTERNAL) });
        fireEvent.click(screen.getByRole('button', { name: 'Estimate size' }));
        await drain();

        expect(screen.getByText('Size check failed.')).toBeInTheDocument();
        expect(screen.queryByText(/Cannot read properties/)).toBeNull();
    });
});
