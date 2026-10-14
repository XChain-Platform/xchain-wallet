// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    createRoot: vi.fn(),
    render: vi.fn(),
    getSettings: vi.fn(),
    hydrateCustomChains: vi.fn(),
    initPanicModePersistence: vi.fn(),
    installWipeHook: vi.fn(),
    defaultRegistry: vi.fn(),
    syncRegistry: vi.fn(),
    flows: { marker: 'flows' },
}));

vi.mock('react-dom/client', () => ({ createRoot: mocks.createRoot }));
vi.mock('@xchain-wallet/core', () => ({
    flows: mocks.flows,
    i18n: {
        availableLocales: vi.fn(() => ['en']),
        setLocale: vi.fn(),
    },
    registry: {
        defaultRegistry: mocks.defaultRegistry,
        hydrateCustomChainsFromSettings: mocks.hydrateCustomChains,
        syncChainRegistryFromHub: mocks.syncRegistry,
    },
}));
vi.mock('@xchain-wallet/core/ui/tokens.css', () => ({}));
vi.mock('../../../packages/extension/src/approval/Router.jsx', () => ({ Router: () => null }));
vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    getSettings: mocks.getSettings,
}));
vi.mock('../../../packages/extension/src/background/panicModeStorage.js', () => ({
    initPanicModePersistence: mocks.initPanicModePersistence,
}));
vi.mock('../../../packages/extension/src/storage/wipeHook.js', () => ({
    installExtensionWipeHook: mocks.installWipeHook,
}));

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="xchain-approval-root"></div>';
    mocks.createRoot.mockReturnValue({ render: mocks.render });
    mocks.defaultRegistry.mockReturnValue({ id: 'registry' });
    mocks.syncRegistry.mockResolvedValue({ ok: true });
    mocks.getSettings.mockResolvedValue({});
    mocks.initPanicModePersistence.mockResolvedValue(undefined);
});

describe('approval entrypoint fallbacks', () => {
    it('mounts when optional registry and settings promises reject', async () => {
        mocks.syncRegistry.mockRejectedValue(new Error('registry unavailable'));
        mocks.getSettings.mockRejectedValue(new Error('settings unavailable'));

        await expect(import('../../../packages/extension/src/approval/main.jsx'))
            .resolves.toBeDefined();
        await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());

        expect(mocks.hydrateCustomChains).not.toHaveBeenCalled();
    });

    it('reports a skipped registry sync and absorbs descriptor hydration failure', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        mocks.syncRegistry.mockResolvedValue({ ok: false, reason: 'offline' });
        mocks.getSettings.mockResolvedValue({ customChains: [{ id: 'broken' }] });
        mocks.hydrateCustomChains.mockImplementation(() => {
            throw new Error('invalid descriptor');
        });

        await expect(import('../../../packages/extension/src/approval/main.jsx'))
            .resolves.toBeDefined();
        await vi.waitFor(() => expect(mocks.hydrateCustomChains).toHaveBeenCalledOnce());

        expect(info).toHaveBeenCalledWith(
            '[xchain] approval chain-registry sync skipped:',
            'offline',
        );
        expect(mocks.render).toHaveBeenCalledOnce();
    });
});
