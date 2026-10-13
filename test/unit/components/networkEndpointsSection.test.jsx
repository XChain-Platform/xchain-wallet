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

const { NetworkEndpointsSection } = await import(
    '../../../packages/core/src/shared/components/settings/NetworkEndpointsSection.jsx'
);

// litecoin-regtest is the venue from the live repro: three localhost
// endpoints on three DIFFERENT non-standard ports, so a port-stripping
// bug is visible rather than coincidentally harmless.
const LTC_REGTEST = {
    explorer: 'http://localhost:18080',
    encoder: 'http://localhost:3223',
    hub: 'http://localhost:10000',
};

function ltcRegtestBlock() {
    const encoderInputs = screen.getAllByLabelText('Encoder URL');
    const encoder = encoderInputs.find((el) => el.value === LTC_REGTEST.encoder);
    expect(encoder, 'litecoin-regtest block not rendered').toBeTruthy();
    return encoder.parentElement.parentElement;
}

function bitcoinMainnetBlock() {
    return screen.getByText('Bitcoin').parentElement.parentElement;
}

beforeEach(() => {
    updateSpy.mockReset();
    settingsRecord = { developerMode: true, sdkEndpoints: {} };
    messagingRecord = null;
});
afterEach(() => cleanup());

describe('NetworkEndpointsSection', () => {
    it('seeds every field with the port the wallet actually uses', () => {
        render(<NetworkEndpointsSection />);
        const block = ltcRegtestBlock();
        expect(within(block).getByLabelText('Explorer URL').value).toBe(LTC_REGTEST.explorer);
        expect(within(block).getByLabelText('Encoder URL').value).toBe(LTC_REGTEST.encoder);
        expect(within(block).getByLabelText('Hub URL').value).toBe(LTC_REGTEST.hub);
    });

    it('saves an explorer edit without stripping the sibling ports', () => {
        render(<NetworkEndpointsSection />);
        const block = ltcRegtestBlock();
        fireEvent.change(within(block).getByLabelText('Explorer URL'), {
            target: { value: 'http://10.0.0.9:18080' },
        });
        fireEvent.click(within(block).getByText('Save'));

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

    it('refuses to persist a URL the wallet could not talk to', () => {
        render(<NetworkEndpointsSection />);
        const block = ltcRegtestBlock();
        fireEvent.change(within(block).getByLabelText('Hub URL'), {
            target: { value: 'localhost:10000' },   // no scheme
        });
        fireEvent.click(within(block).getByText('Save'));

        expect(updateSpy).not.toHaveBeenCalled();
        expect(within(block).getByRole('alert').textContent).toMatch(/Hub URL/);
    });

    it('requires https for a remote host outside regtest', () => {
        render(<NetworkEndpointsSection />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByLabelText('Explorer URL'), {
            target: { value: 'http://node.example.com' },
        });
        fireEvent.click(within(block).getByText('Save'));

        expect(updateSpy).not.toHaveBeenCalled();
        expect(within(block).getByRole('alert')).toHaveTextContent(
            'Explorer URL: Use https:// for remote hosts.',
        );
    });

    it('removes trailing slashes before saving an override', () => {
        render(<NetworkEndpointsSection />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByLabelText('Hub URL'), {
            target: { value: 'https://private.example.com/BTC///' },
        });
        fireEvent.click(within(block).getByText('Save'));

        expect(updateSpy.mock.calls[0][0].sdkEndpoints['bitcoin-mainnet'].hubUrl)
            .toBe('https://private.example.com/BTC');
    });

    it('does not mark a default URL with a trailing slash as custom', () => {
        render(<NetworkEndpointsSection />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByLabelText('Explorer URL'), {
            target: { value: 'https://explorer.xchain.io/' },
        });
        fireEvent.click(within(block).getByText('Save'));

        expect(updateSpy.mock.calls[0][0].sdkEndpoints['bitcoin-mainnet']).toMatchObject({
            explorerUrl: 'https://explorer.xchain.io',
            custom: false,
        });
    });

    it('explains the consequence of saving an unreachable custom host', () => {
        render(<NetworkEndpointsSection />);
        const block = bitcoinMainnetBlock();
        fireEvent.change(within(block).getByLabelText('Hub URL'), {
            target: { value: 'https://private.example.com/BTC' },
        });

        expect(within(block).getByText(/host is not contacted/)).toHaveTextContent(
            /If it is unreachable, this chain's balances, history and transactions may be unavailable\./,
        );
    });

    it('treats an emptied field as "use the default", not as no endpoint', () => {
        render(<NetworkEndpointsSection />);
        const block = ltcRegtestBlock();
        fireEvent.change(within(block).getByLabelText('Explorer URL'), {
            target: { value: 'http://10.0.0.9:18080' },
        });
        fireEvent.change(within(block).getByLabelText('Encoder URL'), {
            target: { value: '' },
        });
        fireEvent.click(within(block).getByText('Save'));

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
        render(<NetworkEndpointsSection />);
        const block = ltcRegtestBlock();
        expect(within(block).getByLabelText('Explorer URL').value).toBe('http://10.0.0.9:18080');
        expect(within(block).getByLabelText('Hub URL').value).toBe(LTC_REGTEST.hub);
    });

    it('restores the persisted endpoint and shows a rejected save', async () => {
        updateSpy.mockRejectedValueOnce(new Error('Storage is unavailable.'));
        render(<NetworkEndpointsSection />);
        const block = ltcRegtestBlock();
        const explorer = within(block).getByLabelText('Explorer URL');
        fireEvent.change(explorer, {
            target: { value: 'http://10.0.0.9:18080' },
        });
        fireEvent.click(within(block).getByText('Save'));

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
        render(<NetworkEndpointsSection />);
        fireEvent.click(within(ltcRegtestBlock()).getByText('Reset to default'));

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
        render(<NetworkEndpointsSection />);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));

        expect(await screen.findByText('Refresh complete: 6 networks available from the registry.'))
            .toBeInTheDocument();
    });

    it('ignores registry status returned by a replaced messaging source', async () => {
        let resolveOldStatus;
        messagingRecord = {
            getChainRegistryStatus: vi.fn(() => new Promise((resolve) => { resolveOldStatus = resolve; })),
            refreshChainRegistry: vi.fn(),
        };
        const { rerender } = render(<NetworkEndpointsSection />);

        messagingRecord = {
            getChainRegistryStatus: vi.fn(async () => ({
                ok: true,
                descriptorCount: 9,
                lastRefreshedAt: new Date().toISOString(),
            })),
            refreshChainRegistry: vi.fn(),
        };
        rerender(<NetworkEndpointsSection />);

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
        const view = render(<NetworkEndpointsSection />);
        const explorer = within(bitcoinMainnetBlock()).getByLabelText('Explorer URL');
        expect(explorer).toHaveValue('https://explorer.xchain.io');

        try {
            registry.applyRemoteDescriptors([replacement]);
            view.rerender(<NetworkEndpointsSection />);

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
        render(<NetworkEndpointsSection />);
        fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));

        expect(await screen.findByText(/registry host could not be reached/)).toHaveTextContent(
            'The networks bundled with this wallet remain active.',
        );
    });
});
