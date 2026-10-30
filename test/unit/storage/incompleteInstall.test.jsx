// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An install with the kdfParams meta on disk and no vault blob: a desktop
// reset whose blob delete landed and whose meta delete did not, a phone wipe
// that stopped between clearVault and clearMeta, or any other loss of the
// blob. Nothing there can be opened, and assertFreshVault refuses every
// create, import and restore over the meta. Answering no-wallet would open
// onboarding on that dead end, so session.status answers with
// VaultIncompleteError and the shell shows the incomplete-wallet screen,
// whose Reset this wallet runs the shell's reset and lands on onboarding.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { createRuntime, handleIpcMessage, wipeRuntimeStores } from '../../../packages/desktop/main/runtime.js';
import { dispatchPreHost } from '../../../packages/extension/src/background/sessionMeta.js';
import { hydrateEnvelopeError } from '../../../packages/extension/src/background/MessageHost.js';
import { assertFreshVault } from '../../../packages/extension/src/background/walletCreate.js';
import {
    VaultEvictedError,
    VaultIncompleteError,
    vaultErrorKind,
} from '../../../packages/core/src/storage/backend.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { VaultUnavailable } from '../../../packages/core/src/shared/routes/VaultUnavailable.jsx';
import { t } from '../../../packages/core/src/i18n/index.js';
import { getSessionStatus } from '../../../packages/web/src/hostBridge.js';
import { VaultStatus, __setNativeVaultForTests } from '../../../packages/web/src/storage/nativeVault.js';
import { CapacitorMetaBackend } from '../../../packages/web/src/storage/CapacitorStorageBackend.js';
import { __resetBackendCacheForTests } from '../../../packages/web/src/storage/backends.js';

afterEach(() => {
    cleanup();
    __setNativeVaultForTests(undefined);
    __resetBackendCacheForTests();
    delete globalThis.Capacitor;
    delete globalThis.xchainWalletBridge;
});

function memory(initial = null) {
    let value = initial;
    return {
        load: vi.fn(async () => value),
        save: vi.fn(async (next) => { value = next; }),
        clear: vi.fn(async () => { value = null; }),
    };
}

const META = { kdfParams: { algo: 'argon2id', salt: 'AA' } };

describe('session.status on an install whose meta outlived its vault', () => {
    it('answers VaultIncompleteError, which the shells narrow to the incomplete kind', async () => {
        const deps = { storageBackend: memory(), sessionBackend: memory(), metaBackend: memory(META) };
        await expect(assertFreshVault(deps)).rejects.toMatchObject({ name: 'WalletExistsError' });
        const err = await dispatchPreHost('session.status', undefined, deps).catch((e) => e);
        expect(err).toBeInstanceOf(VaultIncompleteError);
        expect(vaultErrorKind(err)).toBe('incomplete');
    });

    it('keeps the plain answers for an empty install and a locked one', async () => {
        const empty = { storageBackend: memory(), sessionBackend: memory(), metaBackend: memory() };
        await expect(dispatchPreHost('session.status', undefined, empty)).resolves.toMatchObject({ state: 'no-wallet' });
        const locked = { storageBackend: memory(new Uint8Array([1])), sessionBackend: memory(), metaBackend: memory(META) };
        await expect(dispatchPreHost('session.status', undefined, locked)).resolves.toMatchObject({ state: 'locked' });
    });

    it('reaches the desktop renderer by name, and the reset clears the way to onboarding', async () => {
        const runtime = createRuntime({
            storageBackend: memory(),
            metaBackend: memory(META),
            sessionBackend: memory(),
            chainRegistry: {},
            sdkRegistry: {},
        });
        const envelope = await handleIpcMessage(runtime, { type: 'session.status' });
        expect(envelope.ok).toBe(false);
        expect(vaultErrorKind(hydrateEnvelopeError(envelope.error))).toBe('incomplete');

        await wipeRuntimeStores(runtime);
        const after = await handleIpcMessage(runtime, { type: 'session.status' });
        expect(after).toMatchObject({ ok: true, result: { state: 'no-wallet' } });
        await expect(assertFreshVault(runtime)).resolves.toBeUndefined();
    });

    it('answers the same on a phone whose native wipe stopped between the vault and the meta', async () => {
        const state = { vault: null, meta: null };
        const plugin = {
            loadVault: async () => ({ status: VaultStatus.ABSENT }),
            loadMeta: async () => (state.meta === null
                ? { status: VaultStatus.ABSENT }
                : { status: VaultStatus.OK, blob: state.meta }),
            saveMeta: async ({ blob }) => { state.meta = blob; return { status: VaultStatus.OK }; },
        };
        globalThis.Capacitor = { isNativePlatform: () => true, Plugins: { XChainVault: plugin } };
        __setNativeVaultForTests(plugin);
        await new CapacitorMetaBackend().save(META);

        const err = await getSessionStatus().catch((e) => e);
        expect(vaultErrorKind(err)).toBe('incomplete');
        expect(err).not.toBeInstanceOf(VaultEvictedError);
    });
});

describe('<VaultUnavailable kind="incomplete">', () => {
    function mount(props) {
        return render(
            <MessagingProvider shell="desktop" messaging={{}}>
                <VaultUnavailable kind="incomplete" {...props} />
            </MessagingProvider>,
        );
    }

    it('says the data is incomplete and leads with Reset this wallet, not a retry', () => {
        mount({});
        expect(screen.getByRole('heading', { name: t('vaultUnavailable.incomplete.title') })).toBeInTheDocument();
        expect(screen.getByText(t('vaultUnavailable.incomplete.body'))).toBeInTheDocument();
        expect(screen.getByRole('button', { name: t('vaultUnavailable.incomplete.reset') })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: t('common.tryAgain') })).not.toBeInTheDocument();
    });

    it('runs the shell reset behind the WIPE gate, then reloads the session', async () => {
        const wipe = vi.fn(async () => {});
        const onRetry = vi.fn(async () => {});
        mount({ wipe, onRetry });

        fireEvent.click(screen.getByRole('button', { name: t('vaultUnavailable.incomplete.reset') }));
        const confirm = screen.getByRole('button', { name: t('vaultUnavailable.incomplete.reset') });
        expect(confirm).toBeDisabled();
        fireEvent.change(screen.getByLabelText(t('vaultUnavailable.wipeConfirm')), { target: { value: 'WIPE' } });
        fireEvent.click(confirm);

        await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
        expect(wipe).toHaveBeenCalledTimes(1);
        expect(wipe.mock.invocationCallOrder[0]).toBeLessThan(onRetry.mock.invocationCallOrder[0]);
    });

    it('says so when the reset fails, and leaves the gate open to try again', async () => {
        const wipe = vi.fn(async () => { throw new Error('meta.json: EACCES'); });
        mount({ wipe, onRetry: vi.fn() });
        fireEvent.click(screen.getByRole('button', { name: t('vaultUnavailable.incomplete.reset') }));
        fireEvent.change(screen.getByLabelText(t('vaultUnavailable.wipeConfirm')), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: t('vaultUnavailable.incomplete.reset') }));
        expect(await screen.findByText(t('vaultUnavailable.incomplete.failed'))).toBeInTheDocument();
        expect(screen.getByRole('button', { name: t('vaultUnavailable.incomplete.reset') })).toBeEnabled();
    });
});
