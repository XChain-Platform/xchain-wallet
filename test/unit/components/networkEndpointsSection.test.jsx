// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// , the latent half: the editor seeded its draft from the chain
// descriptor's bare `defaultUrl` while the real endpoint is
// `defaultUrl` + `defaultPort`, and Save wrote all three fields
// regardless of which one was touched. Editing Explorer alone on a
// regtest chain therefore persisted encoder/hub as "http://localhost",
// stripped of :3223 and :10000. That was harmless only while the
// overrides were inert; now that SDKRegistry consumes them it would
// take out the two endpoints the operator never touched.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

const updateSpy = vi.fn();
let settingsRecord;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({
        settings: settingsRecord,
        loading: false,
        error: null,
        update: updateSpy,
    }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: null }),
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

beforeEach(() => {
    updateSpy.mockReset();
    settingsRecord = { developerMode: true, sdkEndpoints: {} };
});
afterEach(() => cleanup());

describe('NetworkEndpointsSection ', () => {
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
});
