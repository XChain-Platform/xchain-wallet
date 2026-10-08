// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The MV3 keepalive tick: the idle-lock check must never wait on the
// notification refresh, whose socket connects carry no timeout, and must
// never be skipped because the host build or the refresh rejected.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createKeepaliveTick } from '../../../packages/extension/src/background/walletLock.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const quietLogger = { error: vi.fn() };

describe('keepalive tick', () => {
    it('locks while the notification refresh is still hanging', async () => {
        const maybeAutoLock = vi.fn(async () => 'locked');
        const refresh = vi.fn(() => new Promise(() => {}));
        const tick = createKeepaliveTick({ ensureHost: async () => null, maybeAutoLock, refresh, logger: quietLogger });
        await expect(tick()).resolves.toBe('locked');
        expect(maybeAutoLock).toHaveBeenCalledTimes(1);
        expect(refresh).not.toHaveBeenCalled();
    });

    it('settles even when the refresh it starts never does', async () => {
        const refresh = vi.fn(() => new Promise(() => {}));
        const tick = createKeepaliveTick({
            ensureHost: async () => null,
            maybeAutoLock: async () => 'skipped',
            refresh,
            logger: quietLogger,
        });
        await expect(tick()).resolves.toBe('skipped');
        await Promise.resolve();
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('still runs the idle-lock check when the host build rejects', async () => {
        const maybeAutoLock = vi.fn(async () => 'locked');
        const tick = createKeepaliveTick({
            ensureHost: async () => { throw new Error('vault open failed'); },
            maybeAutoLock,
            refresh: vi.fn(),
            logger: quietLogger,
        });
        await expect(tick()).resolves.toBe('locked');
        expect(maybeAutoLock).toHaveBeenCalledTimes(1);
    });

    it('runs the check only after the host rebuild settles', async () => {
        const order = [];
        const tick = createKeepaliveTick({
            ensureHost: async () => { await Promise.resolve(); order.push('host'); },
            maybeAutoLock: async () => { order.push('lock'); return 'skipped'; },
            refresh: () => { order.push('refresh'); },
            logger: quietLogger,
        });
        await tick();
        await Promise.resolve();
        expect(order).toEqual(['host', 'lock', 'refresh']);
    });

    it('logs a rejected refresh instead of leaving it unhandled', async () => {
        const logger = { error: vi.fn() };
        const tick = createKeepaliveTick({
            ensureHost: async () => null,
            maybeAutoLock: async () => 'skipped',
            refresh: async () => { throw new Error('hub down'); },
            logger,
        });
        await tick();
        await new Promise((r) => setTimeout(r, 0));
        expect(logger.error).toHaveBeenCalledWith('[xchain] keepalive refresh failed:', expect.any(Error));
    });
});

describe('background.js wires the keepalive tick', () => {
    it('drives the alarm through the shipping tick, not an inline refresh-then-lock chain', () => {
        const bg = readFileSync(join(wsRoot, 'packages', 'extension', 'src', 'background.js'), 'utf8');
        expect(bg).toMatch(/createKeepaliveTick\(\{/);
        expect(bg).toMatch(/void keepaliveTick\(\);/);
        expect(bg).not.toMatch(/refresh\(\)\)\s*\n[\s\S]{0,400}?\.then\(\(\) => maybeAutoLock\(\)\)/);
    });
});
