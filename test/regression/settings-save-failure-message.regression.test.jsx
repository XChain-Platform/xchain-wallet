// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a settings write the vault refuses is reported once.
//
//   [P3] 2026-10-24: a full disk or a storage backend that went away made the
//        Automatic Donation System switch (and every section that logs the
//        failure to the console) snap back with no message.

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../packages/core/src/shared/components/ToastHost.jsx';
import { useSettings } from '../../packages/core/src/shared/hooks/useSettings.js';

const SETTINGS = { ads: { enabled: true } };

let latest;
function Probe({ reportsOwnError = false }) {
    latest = useSettings({ reportsOwnError });
    return null;
}

function mount(updateSettings, probeProps = {}) {
    const messaging = { getSettings: async () => SETTINGS, updateSettings };
    render(
        <MessagingProvider messaging={messaging} shell="web">
            <ToastHost>
                <Probe {...probeProps} />
            </ToastHost>
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('regression/settings-save-failure-message', () => {
    it('[REGRESSION P3] shows one toast with the storage message and still rejects', async () => {
        const quota = Object.assign(new Error('Storage is full. Free some space, then try again.'), {
            name: 'StorageQuotaError',
        });
        mount(vi.fn(async () => { throw quota; }));
        await act(async () => { await Promise.resolve(); });

        let rejected;
        await act(async () => {
            rejected = await latest.update({ ads: { enabled: false } }).catch((err) => err);
        });

        expect(rejected).toBe(quota);
        expect(await screen.findByText('Storage is full. Free some space, then try again.')).toBeTruthy();
    });

    it('[REGRESSION P3] hides internals behind the generic sentence', async () => {
        mount(vi.fn(async () => { throw new Error('settings.update: tx aborted at idb.js:12:3'); }));
        await act(async () => { await Promise.resolve(); });

        await act(async () => {
            await latest.update({ ads: { enabled: false } }).catch(() => {});
        });

        expect(await screen.findByText("Couldn't save this setting. Try again.")).toBeTruthy();
        expect(screen.queryByText(/idb\.js/)).toBeNull();
    });

    it('[REGRESSION P3] stays quiet for a caller that reports its own error', async () => {
        mount(vi.fn(async () => { throw new Error('refused'); }), { reportsOwnError: true });
        await act(async () => { await Promise.resolve(); });

        await act(async () => {
            await latest.update({ ads: { enabled: false } }).catch(() => {});
        });

        expect(screen.queryByText("Couldn't save this setting. Try again.")).toBeNull();
        expect(screen.queryByText('refused')).toBeNull();
    });
});
