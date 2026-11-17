// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The latent half: the editor seeded its draft from the chain
// descriptor's bare `defaultUrl` while the real endpoint is
// `defaultUrl` + `defaultPort`, and Save wrote all three fields
// regardless of which one was touched. Editing Explorer alone on a
// regtest chain therefore persisted encoder/hub as "http://localhost",
// stripped of :3223 and :10000. That was harmless only while the
// overrides were inert; now that SDKRegistry consumes them it would
// take out the two endpoints the operator never touched.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const updateSpy = vi.fn();
let settingsRecord;
let messagingRecord;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: settingsRecord,
        loading: false,
        error: null,
        update: updateSpy,
    }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: messagingRecord }),
}));

const { EndpointsHarness } = await import('./networkRowHarness.jsx');

// litecoin-regtest is the venue from the live repro: three localhost
// endpoints on three DIFFERENT non-standard ports, so a port-stripping
// bug is visible rather than coincidentally harmless.
const LTC_REGTEST = {
    explorer: 'http://localhost:18080',
    encoder: 'http://localhost:3223',
    hub: 'http://localhost:10000',
};

// The page lists networks; a row opens that network's own page (G117).
function openNetwork(chainId) {
    const row = document.querySelector(`[data-network-row="${chainId}"] button`);
    expect(row).not.toBeNull();
    fireEvent.click(row);
}

function ltcRegtestBlock() {
    openNetwork('litecoin-regtest');
    const block = screen.getByRole('region', { name: 'Litecoin · regtest' });
    expect(within(block).getByRole('textbox', { name: 'Encoder URL' }))
        .toHaveValue(LTC_REGTEST.encoder);
    return block;
}

function bitcoinMainnetBlock() {
    openNetwork('bitcoin-mainnet');
    return screen.getByRole('region', { name: 'Bitcoin' });
}

beforeEach(() => {
    updateSpy.mockReset();
    settingsRecord = { developerMode: true, sdkEndpoints: {} };
    messagingRecord = null;
});
afterEach(() => cleanup());

describe('NetworkEndpointsSection', () => {
    it('lists one chevron row per network with its icon area and a summary, and no endpoint fields', () => {
        settingsRecord = {
            developerMode: true,
            sdkEndpoints: {
                'litecoin-regtest': {
                    explorerUrl: 'http://localhost:18080',
                    encoderUrl: 'http://localhost:3223',
                    hubUrl: 'http://localhost:10000',
                    custom: true,
                },
            },
        };
        render(<EndpointsHarness />);

        const rows = Array.from(document.querySelectorAll('[data-network-row]'));
        expect(rows.length).toBeGreaterThan(1);
        expect(screen.queryAllByRole('region')).toHaveLength(0);
        expect(screen.queryAllByRole('textbox')).toHaveLength(0);
        for (const row of rows) {
            expect(row.querySelector('button')).not.toBeNull();
            expect(row.querySelector('[aria-hidden="true"]')).not.toBeNull();
        }
        const ltc = document.querySelector('[data-network-row="litecoin-regtest"]');
        expect(ltc).toHaveTextContent('Litecoin · regtest');
        expect(ltc).toHaveTextContent('Custom endpoint');
        const btc = document.querySelector('[data-network-row="bitcoin-mainnet"]');
        expect(btc).toHaveTextContent('Default endpoint');
    });

    it('opens a network page with its endpoint controls and Back returns to the list', () => {
        render(<EndpointsHarness />);

        const block = ltcRegtestBlock();
        expect(within(block).getByRole('textbox', { name: 'Explorer URL' })).toBeInTheDocument();
        expect(within(block).getByRole('textbox', { name: 'Hub URL' })).toBeInTheDocument();
        expect(document.querySelector('[data-network-row]')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(screen.queryAllByRole('region')).toHaveLength(0);
        expect(document.querySelectorAll('[data-network-row]').length).toBeGreaterThan(1);
    });

    it('keeps a saved endpoint after Back and reopening, and the row summary follows it', async () => {
        updateSpy.mockResolvedValue(undefined);
        const view = render(<EndpointsHarness />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByLabelText('Explorer URL'), { target: { value: 'https://my-explorer.example' } });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));
        await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
        const saved = updateSpy.mock.calls[0][0].sdkEndpoints['bitcoin-mainnet'];
        expect(saved.explorerUrl).toBe('https://my-explorer.example');
        expect(saved.custom).toBe(true);

        // The settings hook now returns the stored record.
        settingsRecord = { ...settingsRecord, sdkEndpoints: { 'bitcoin-mainnet': saved } };
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        view.rerender(<EndpointsHarness />);
        expect(document.querySelector('[data-network-row="bitcoin-mainnet"]')).toHaveTextContent('Custom endpoint');
        const reopened = bitcoinMainnetBlock();
        expect(within(reopened).getByLabelText('Explorer URL')).toHaveValue('https://my-explorer.example');
    });

    it('seeds every field with the port the wallet actually uses', () => {
        render(<EndpointsHarness />);
        const block = ltcRegtestBlock();
        expect(within(block).getByRole('textbox', { name: 'Explorer URL' }).value).toBe(LTC_REGTEST.explorer);
        expect(within(block).getByRole('textbox', { name: 'Encoder URL' }).value).toBe(LTC_REGTEST.encoder);
        expect(within(block).getByRole('textbox', { name: 'Hub URL' }).value).toBe(LTC_REGTEST.hub);
        expect(within(block).getByRole('textbox', { name: 'Explorer URL' }).className).toMatch(/input/);
    });

    it('saves an explorer edit without stripping the sibling ports', () => {
        render(<EndpointsHarness />);
        const block = ltcRegtestBlock();
        fireEvent.change(within(block).getByRole('textbox', { name: 'Explorer URL' }), {
            target: { value: 'http://10.0.0.9:18080' },
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(updateSpy.mock.calls[0][0]).toEqual({
            sdkEndpoints: {
                'litecoin-regtest': {
                    explorerUrl: 'http://10.0.0.9:18080',
                    encoderUrl: LTC_REGTEST.encoder,
                    hubUrl: LTC_REGTEST.hub,
                    custom: true,
                },
            },
        });
    });

    it('refuses an invalid URL, marks its field, and clears that error on change', async () => {
        render(<EndpointsHarness />);
        const block = ltcRegtestBlock();
        const hub = within(block).getByRole('textbox', { name: 'Hub URL' });
        fireEvent.change(hub, {
            target: { value: 'localhost:10000' },   // no scheme
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(updateSpy).not.toHaveBeenCalled();
        expect(block.querySelector('[data-form-errors]')).toHaveTextContent(/Hub URL/);
        expect(hub).toHaveAttribute('aria-invalid', 'true');

        fireEvent.change(hub, { target: { value: LTC_REGTEST.hub } });
        await waitFor(() => expect(block.querySelector('[data-form-errors]')).toBeNull());
        expect(hub).not.toHaveAttribute('aria-invalid');
    });

    it('requires https for a remote host outside regtest', () => {
        render(<EndpointsHarness />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByRole('textbox', { name: 'Explorer URL' }), {
            target: { value: 'http://node.example.com' },
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(updateSpy).not.toHaveBeenCalled();
        expect(block.querySelector('[data-form-errors]')).toHaveTextContent(
            'Explorer URL: Use https:// for remote hosts.',
        );
    });

    it('saves an explorer edit on a chain that has no hub endpoint', () => {
        // Testnet chains ship without a hub, so their Hub URL field starts
        // empty; an untouched empty field is the chain's default, not an error.
        render(<EndpointsHarness />);
        openNetwork('bitcoin-testnet');
        const block = screen.getByRole('region', { name: 'Bitcoin · testnet' });
        expect(within(block).getByRole('textbox', { name: 'Hub URL' })).toHaveValue('');
        fireEvent.change(within(block).getByRole('textbox', { name: 'Explorer URL' }), {
            target: { value: 'https://explorer.example.com' },
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(block.querySelector('[data-form-errors]')).toBeNull();
        expect(updateSpy).toHaveBeenCalledTimes(1);
        expect(updateSpy.mock.calls[0][0].sdkEndpoints['bitcoin-testnet']).toMatchObject({
            explorerUrl: 'https://explorer.example.com',
            hubUrl: '',
            custom: true,
        });
    });

    it('still checks a hub URL typed on a chain that has no hub endpoint', () => {
        render(<EndpointsHarness />);
        openNetwork('bitcoin-testnet');
        const block = screen.getByRole('region', { name: 'Bitcoin · testnet' });
        fireEvent.change(within(block).getByRole('textbox', { name: 'Hub URL' }), {
            target: { value: 'hub.example.com' },
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(updateSpy).not.toHaveBeenCalled();
        expect(block.querySelector('[data-form-errors]')).toHaveTextContent(/Hub URL/);
    });

    it('removes trailing slashes before saving an override', () => {
        render(<EndpointsHarness />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByRole('textbox', { name: 'Hub URL' }), {
            target: { value: 'https://private.example.com/BTC///' },
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(updateSpy.mock.calls[0][0].sdkEndpoints['bitcoin-mainnet'].hubUrl)
            .toBe('https://private.example.com/BTC');
    });

    it('does not mark a default URL with a trailing slash as custom', () => {
        render(<EndpointsHarness />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByRole('textbox', { name: 'Explorer URL' }), {
            target: { value: 'https://explorer.xchain.io/' },
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(updateSpy).not.toHaveBeenCalled();
    });

    it('explains the consequence of saving an unreachable custom host', () => {
        render(<EndpointsHarness />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByRole('textbox', { name: 'Hub URL' }), {
            target: { value: 'https://private.example.com/BTC' },
        });

        expect(within(block).getByText(/host isn't contacted/)).toHaveTextContent(
            /If it's unreachable, this network's balances, history and transactions may be unavailable\./,
        );
    });

    it('treats an emptied field as "use the default", not as no endpoint', () => {
        render(<EndpointsHarness />);
        const block = ltcRegtestBlock();
        fireEvent.change(within(block).getByRole('textbox', { name: 'Explorer URL' }), {
            target: { value: 'http://10.0.0.9:18080' },
        });
        fireEvent.change(within(block).getByRole('textbox', { name: 'Encoder URL' }), {
            target: { value: '' },
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(updateSpy.mock.calls[0][0].sdkEndpoints['litecoin-regtest'].encoderUrl)
            .toBe(LTC_REGTEST.encoder);
    });

    it('shows what the wallet is really using when a port-stripped record is persisted', () => {
        settingsRecord = {
            developerMode: true,
            sdkEndpoints: {
                'litecoin-regtest': {
                    explorerUrl: 'http://10.0.0.9:18080',
                    encoderUrl: 'http://localhost',   // the old editor's damage
                    hubUrl: 'http://localhost',
                    custom: true,
                },
            },
        };
        render(<EndpointsHarness />);
        const block = ltcRegtestBlock();
        expect(within(block).getByRole('textbox', { name: 'Explorer URL' }).value).toBe('http://10.0.0.9:18080');
        expect(within(block).getByRole('textbox', { name: 'Hub URL' }).value).toBe(LTC_REGTEST.hub);
    });

    it('restores the persisted endpoint and shows a rejected save', async () => {
        updateSpy.mockRejectedValueOnce(new Error('Storage is unavailable.'));
        render(<EndpointsHarness />);
        const block = ltcRegtestBlock();
        const explorer = within(block).getByRole('textbox', { name: 'Explorer URL' });
        fireEvent.change(explorer, {
            target: { value: 'http://10.0.0.9:18080' },
        });
        fireEvent.click(within(block).getByRole('button', { name: 'Save Endpoints' }));

        expect(await within(block).findByRole('alert')).toHaveTextContent('Storage is unavailable.');
        expect(explorer).toHaveValue(LTC_REGTEST.explorer);
        expect(within(block).queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('resets only the selected chain to its defaults', async () => {
        settingsRecord = {
            developerMode: true,
            sdkEndpoints: {
                'litecoin-regtest': {
                    explorerUrl: 'http://10.0.0.9:18080',
                    encoderUrl: LTC_REGTEST.encoder,
                    hubUrl: LTC_REGTEST.hub,
                    custom: true,
                },
            },
        };
        render(<EndpointsHarness />);
        fireEvent.click(within(ltcRegtestBlock()).getByRole('button', { name: 'Reset to Default' }));

        await waitFor(() => expect(updateSpy).toHaveBeenCalledWith({
            sdkEndpoints: {
                'litecoin-regtest': {
                    explorerUrl: LTC_REGTEST.explorer,
                    encoderUrl: LTC_REGTEST.encoder,
                    hubUrl: LTC_REGTEST.hub,
                    custom: false,
                },
            },
        }));
    });

    it('reports a successful manual registry refresh as complete', async () => {
        messagingRecord = {
            getChainRegistryStatus: vi.fn(async () => null),
            refreshChainRegistry: vi.fn(async () => ({
                ok: true,
                descriptorCount: 6,
                lastRefreshedAt: new Date().toISOString(),
            })),
        };
        render(<EndpointsHarness />);
        fireEvent.click(screen.getByRole('button', { name: /^Refresh Now/ }));

        expect(await screen.findByText('Refresh complete: 6 networks available from the registry.'))
            .toBeInTheDocument();
    });

    it('ignores registry status returned by a replaced messaging source', async () => {
        let resolveOldStatus;
        messagingRecord = {
            getChainRegistryStatus: vi.fn(() => new Promise((resolve) => { resolveOldStatus = resolve; })),
            refreshChainRegistry: vi.fn(),
        };
        const { rerender } = render(<EndpointsHarness />);

        messagingRecord = {
            getChainRegistryStatus: vi.fn(async () => ({
                ok: true,
                descriptorCount: 9,
                lastRefreshedAt: new Date().toISOString(),
            })),
            refreshChainRegistry: vi.fn(),
        };
        rerender(<EndpointsHarness />);

        expect(await screen.findByText(/9 networks in the registry/)).toBeInTheDocument();
        resolveOldStatus({
            ok: true,
            descriptorCount: 1,
            lastRefreshedAt: new Date().toISOString(),
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(screen.getByText(/9 networks in the registry/)).toBeInTheDocument();
        expect(screen.queryByText(/1 network in the registry/)).toBeNull();
    });

    it('refreshes an endpoint draft when its chain descriptor changes', async () => {
        const registry = defaultRegistry();
        const original = { ...registry.get('bitcoin-mainnet') };
        delete original.isUserAdded;
        const replacement = {
            ...original,
            explorer: {
                ...original.explorer,
                defaultUrl: 'https://remote-explorer.example',
            },
        };
        const view = render(<EndpointsHarness />);
        const explorer = within(bitcoinMainnetBlock()).getByLabelText('Explorer URL');
        expect(explorer).toHaveValue('https://explorer.xchain.io');

        try {
            registry.applyRemoteDescriptors([replacement]);
            view.rerender(<EndpointsHarness />);

            await waitFor(() => expect(explorer).toHaveValue('https://remote-explorer.example'));
        } finally {
            registry.applyRemoteDescriptors([original]);
        }
    });

    it('explains an unreachable registry host and preserves the bundled fallback', async () => {
        messagingRecord = {
            getChainRegistryStatus: vi.fn(async () => null),
            refreshChainRegistry: vi.fn(async () => ({ ok: false, error: 'fetch failed' })),
        };
        render(<EndpointsHarness />);
        fireEvent.click(screen.getByRole('button', { name: /^Refresh Now/ }));

        expect(await screen.findByText(/registry host could not be reached/)).toHaveTextContent(
            'The networks bundled with this wallet remain active.',
        );
    });
});
