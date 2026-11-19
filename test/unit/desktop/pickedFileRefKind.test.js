// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/** @vitest-environment node */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPickedFileTokenStore } from '../../../packages/desktop/main/pickedFileTokens.js';
import { createPickedFileRefKind } from '../../../packages/desktop/main/pickedFileRefKind.js';
import { registerPickedFile } from '../../../packages/desktop/main/pickedFileRegistration.js';

const tempDirs = [];

async function tempFile(name, bytes) {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'xchain-picked-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, name);
    await fs.promises.writeFile(filePath, bytes);
    return { dir, filePath };
}

afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true })));
});

describe('picked file token store', () => {
    const file = { path: '/picked/a.bin', size: 3, mtimeMs: 7 };

    it('issues an unguessable token that can be taken exactly once', () => {
        const tokens = createPickedFileTokenStore();
        const first = tokens.issue(file);
        const second = tokens.issue(file);

        expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(second).not.toBe(first);
        expect(tokens.take(first)).toMatchObject(file);
        expect(tokens.take(first)).toBeNull();
        expect(tokens.take(second)).toMatchObject(file);
    });

    it('answers null for an unknown token and for anything that is not a string', () => {
        const tokens = createPickedFileTokenStore();
        tokens.issue(file);

        for (const value of ['nope', '', undefined, null, 5, {}, ['x']]) {
            expect(tokens.take(value)).toBeNull();
        }
        expect(tokens.size).toBe(1);
    });

    it('expires a token after its lifetime and consumes it on the late take', () => {
        let at = 1_000;
        const tokens = createPickedFileTokenStore({ now: () => at, ttlMs: 500 });
        const live = tokens.issue(file);
        const stale = tokens.issue(file);

        at += 499;
        expect(tokens.take(live)).toMatchObject(file);
        at += 2;
        expect(tokens.take(stale)).toBeNull();
        expect(tokens.size).toBe(0);
    });

    it('evicts the oldest token when the store is over its cap', () => {
        const tokens = createPickedFileTokenStore({ maxEntries: 2 });
        const oldest = tokens.issue(file);
        const middle = tokens.issue(file);
        const newest = tokens.issue(file);

        expect(tokens.size).toBe(2);
        expect(tokens.take(oldest)).toBeNull();
        expect(tokens.take(middle)).not.toBeNull();
        expect(tokens.take(newest)).not.toBeNull();
    });
});

describe('picked file ref kind', () => {
    it('opens the registered file and reads its bytes', async () => {
        const { filePath } = await tempFile('doc.bin', Buffer.from('picked bytes'));
        const tokens = createPickedFileTokenStore();
        const registered = await registerPickedFile(filePath, { tokens });
        const pick = createPickedFileRefKind({ tokens });

        const source = await pick({ kind: 'picked', token: registered.token, size: registered.size });

        expect(source.size).toBe(12);
        expect(await source.readSlice(0, 6)).toEqual(Buffer.from('picked'));
    });

    it.each([
        ['an unknown token', () => ({ token: 'forged', size: 3 })],
        ['a size that disagrees with the registration', (token) => ({ token, size: 4 })],
    ])('refuses %s with FILE_REF_INVALID before any stat or open', async (_label, build) => {
        const openPath = vi.fn();
        const tokens = createPickedFileTokenStore();
        const token = tokens.issue({ path: '/picked/a.bin', size: 3, mtimeMs: 1 });
        const pick = createPickedFileRefKind({ tokens, openPath });

        await expect(pick({ kind: 'picked', ...build(token) })).rejects.toMatchObject({ code: 'FILE_REF_INVALID' });
        expect(openPath).not.toHaveBeenCalled();
    });

    it('refuses a reused token and an expired token with FILE_REF_INVALID', async () => {
        let at = 0;
        const { filePath } = await tempFile('reuse.bin', Buffer.from('abc'));
        const tokens = createPickedFileTokenStore({ now: () => at, ttlMs: 100 });
        const pick = createPickedFileRefKind({ tokens });
        const first = await registerPickedFile(filePath, { tokens });
        const second = await registerPickedFile(filePath, { tokens });

        await pick({ kind: 'picked', token: first.token, size: 3 });
        await expect(pick({ kind: 'picked', token: first.token, size: 3 }))
            .rejects.toMatchObject({ code: 'FILE_REF_INVALID' });
        at = 101;
        await expect(pick({ kind: 'picked', token: second.token, size: 3 }))
            .rejects.toMatchObject({ code: 'FILE_REF_INVALID' });
    });

    it('never reads a path from the reference', async () => {
        const openPath = vi.fn();
        const pick = createPickedFileRefKind({ tokens: createPickedFileTokenStore(), openPath });

        await expect(pick({ kind: 'picked', token: 'x', size: 1, path: '/etc/hosts' }))
            .rejects.toMatchObject({ code: 'FILE_REF_INVALID' });
        await expect(pick({ kind: 'path', path: '/etc/hosts', size: 1 }))
            .rejects.toMatchObject({ code: 'FILE_REF_INVALID' });
        expect(openPath).not.toHaveBeenCalled();
    });

    it('refuses a malformed picked reference', async () => {
        const pick = createPickedFileRefKind({ tokens: createPickedFileTokenStore() });

        for (const ref of [null, { kind: 'picked' }, { kind: 'picked', token: '', size: 1 },
            { kind: 'picked', token: 't', size: -1 }, { kind: 'picked', token: 't', size: 1.5 }]) {
            await expect(pick(ref)).rejects.toMatchObject({ code: 'FILE_REF_INVALID' });
        }
    });

    it('reports a file that changed after it was picked', async () => {
        const { filePath } = await tempFile('moved.bin', Buffer.from('before'));
        const tokens = createPickedFileTokenStore();
        const registered = await registerPickedFile(filePath, { tokens });
        const later = new Date(Date.now() + 60_000);
        await fs.promises.utimes(filePath, later, later);

        await expect(createPickedFileRefKind({ tokens })({
            kind: 'picked',
            token: registered.token,
            size: registered.size,
        })).rejects.toMatchObject({ code: 'FILE_CHANGED' });
    });
});

describe('picked file registration', () => {
    it('answers a token and the size without naming the path', async () => {
        const { filePath } = await tempFile('reg.bin', Buffer.from('12345'));
        const tokens = createPickedFileTokenStore();

        const answer = await registerPickedFile(filePath, { tokens });

        expect(Object.keys(answer).sort()).toEqual(['size', 'token']);
        expect(answer.size).toBe(5);
        expect(JSON.stringify(answer)).not.toContain(filePath);
        expect(tokens.take(answer.token)).toMatchObject({ path: filePath, size: 5 });
    });

    it('refuses a directory, a missing file, a relative path and a non-string', async () => {
        const { dir } = await tempFile('x.bin', Buffer.from('x'));
        const tokens = createPickedFileTokenStore();

        for (const value of [dir, path.join(dir, 'missing.bin'), 'relative/file.bin', '', null, 42, { path: dir }]) {
            await expect(registerPickedFile(value, { tokens })).resolves.toBeNull();
        }
        expect(tokens.size).toBe(0);
    });
});
