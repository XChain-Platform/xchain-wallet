/**
 * @vitest-environment node
 */

// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A locked desktop wallet whose KDF metadata file is unreadable can never
// unlock. session.status reports that as a damaged vault so the renderer
// shows the damaged-vault screen instead of a password prompt that fails.
// With no vault blob, the same file blocks every create and import, so it
// reports an incomplete install, whose screen offers the reset.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRuntime, handleIpcMessage } from '../../../packages/desktop/main/runtime.js';
import { FileMetaBackend, metaPathFor } from '../../../packages/desktop/main/meta.js';

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'xchain-status-meta-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function runtimeWith({ hasWallet, hasSession }) {
    return createRuntime({
        storageBackend: { load: async () => (hasWallet ? new Uint8Array([5]) : null) },
        sessionBackend: { load: async () => (hasSession ? new Uint8Array([1, 2, 3, 4]) : null) },
        metaBackend: new FileMetaBackend(metaPathFor(dir)),
        chainRegistry: {},
        sdkRegistry: {},
    });
}

describe('session.status with unreadable metadata', () => {
    beforeEach(() => { writeFileSync(metaPathFor(dir), '{broken', 'utf8'); });

    it('reports a locked wallet as a damaged vault', async () => {
        const res = await handleIpcMessage(runtimeWith({ hasWallet: true, hasSession: false }), { type: 'session.status', request: {} });
        expect(res.ok).toBe(false);
        expect(res.error.name).toBe('VaultCorruptError');
    });

    it('leaves an already unlocked session alone', async () => {
        const unlocked = await handleIpcMessage(runtimeWith({ hasWallet: true, hasSession: true }), { type: 'session.status', request: {} });
        expect(unlocked.result.state).toBe('unlocked');
    });

    it('reports an install with no vault blob as incomplete, so its screen offers the reset', async () => {
        const res = await handleIpcMessage(runtimeWith({ hasWallet: false, hasSession: false }), { type: 'session.status', request: {} });
        expect(res.ok).toBe(false);
        expect(res.error.name).toBe('VaultIncompleteError');
    });
});
