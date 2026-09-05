// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// useSettings hydrates the calling realm's ChainRegistry with the
// user-added chains carried by the settings record (§9.7 Developer Mode).
// In the MV3 popup and the desktop renderer that registry is a separate
// instance from the host's, so without this every registry-derived
// surface there kept showing bundled chains only.

import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { useSettings } from '../../../packages/core/src/shared/hooks/useSettings.js';
import { defaultRegistry, BUNDLED_DESCRIPTORS } from '../../../packages/core/src/registry/index.js';

const btcRegtest = BUNDLED_DESCRIPTORS.find((d) => d.id === 'bitcoin-regtest');
const CUSTOM_ID = 'use-settings-hydrate-regtest';
const custom = { ...btcRegtest, id: CUSTOM_ID, displayName: 'Hydrate Regtest' };

function wrapperFor(messaging) {
    return function Wrapper({ children }) {
        return (
            <MessagingContext.Provider value={{ shell: 'popup', messaging }}>
                {children}
            </MessagingContext.Provider>
        );
    };
}

afterEach(() => {
    // The hook targets the realm singleton on purpose; leave it clean.
    const reg = defaultRegistry();
    if (reg.get(CUSTOM_ID)?.isUserAdded) reg.removeCustom(CUSTOM_ID);
});

describe('useSettings custom-chain hydration', () => {
    it('installs settings.customChains into the realm registry on a successful read', async () => {
        const reg = defaultRegistry();
        expect(reg.has(CUSTOM_ID)).toBe(false);
        const messaging = {
            getSettings: async () => ({ developerMode: true, customChains: [custom] }),
        };
        const { result } = renderHook(() => useSettings(), { wrapper: wrapperFor(messaging) });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.settings?.customChains).toHaveLength(1);
        expect(reg.has(CUSTOM_ID)).toBe(true);
        expect(reg.get(CUSTOM_ID).isUserAdded).toBe(true);
    });

    it('leaves the registry alone when the read fails (locked vault)', async () => {
        const reg = defaultRegistry();
        const messaging = {
            getSettings: async () => { throw new Error('Vault is not open'); },
        };
        const { result } = renderHook(() => useSettings(), { wrapper: wrapperFor(messaging) });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeInstanceOf(Error);
        expect(reg.has(CUSTOM_ID)).toBe(false);
    });

    it('still returns the record when a persisted row is invalid', async () => {
        const reg = defaultRegistry();
        const before = reg.supportedChains().length;
        const messaging = {
            getSettings: async () => ({ customChains: [{ id: 'garbage-row' }] }),
        };
        const { result } = renderHook(() => useSettings(), { wrapper: wrapperFor(messaging) });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        expect(result.current.settings?.customChains).toHaveLength(1);
        expect(reg.supportedChains().length).toBe(before);
    });
});
