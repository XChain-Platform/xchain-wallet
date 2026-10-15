// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { openExtensionTab } from '../../../packages/extension/src/popup/launchState.js';

describe('extension popup import handoff defaults', () => {
    it('opens a default import tab without closing a non-popup view', async () => {
        const view = {
            close: vi.fn(),
            location: { pathname: '/popup.html' },
            innerWidth: 1200,
        };
        const create = vi.fn().mockResolvedValue({ id: 4 });
        const chromeApi = {
            extension: { getViews: vi.fn(() => []) },
            runtime: { getURL: vi.fn(() => 'chrome-extension://wallet/popup.html') },
            tabs: { create },
        };

        await expect(openExtensionTab({ flow: 'import' }, { chromeApi, view }))
            .resolves.toBe(true);
        expect(create).toHaveBeenCalledWith({
            url: 'chrome-extension://wallet/popup.html?handoff=import&mode=fresh&variant=default&lane=mnemonic',
        });
        expect(view.close).not.toHaveBeenCalled();
    });
});
