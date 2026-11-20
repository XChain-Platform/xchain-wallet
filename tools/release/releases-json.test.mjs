// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { parseReleaseFeed } from '../../packages/core/src/shared/releaseFeed.js';
import { buildReleaseJson } from './releases-json.mjs';

const TOOL = fileURLToPath(new URL('./releases-json.mjs', import.meta.url));
const VALID = Object.freeze({
    latest: '1.2.3',
    channels: {
        web: { version: '1.2.2', url: 'https://wallet.xchain.io/' },
        chrome: {
            version: '1.2.1',
            url: 'https://chromewebstore.google.com/detail/xchain-wallet/item-id',
        },
        'desktop-direct': {
            version: '1.2.3',
            url: 'https://downloads.xchain.io/wallet/desktop/',
        },
    },
});

function fixture(body) {
    const root = mkdtempSync(path.join(tmpdir(), 'releases-json-test-'));
    const input = path.join(root, 'input.json');
    const out = path.join(root, 'releases.json');
    writeFileSync(input, `${JSON.stringify(body, null, 2)}\n`);
    return { input, out, root };
}

function runBuild(body) {
    const files = fixture(body);
    const result = spawnSync(process.execPath, [
        TOOL,
        'build',
        '--input', files.input,
        '--out', files.out,
    ], { encoding: 'utf8' });
    return { ...files, result };
}

test('build writes valid, sorted JSON with two-space indentation and a trailing newline', () => {
    const { result, out } = runBuild(VALID);
    assert.equal(result.status, 0, result.stderr);
    const actual = readFileSync(out, 'utf8');
    assert.equal(actual, `{
  "channels": {
    "chrome": {
      "url": "https://chromewebstore.google.com/detail/xchain-wallet/item-id",
      "version": "1.2.1"
    },
    "desktop-direct": {
      "url": "https://downloads.xchain.io/wallet/desktop/",
      "version": "1.2.3"
    },
    "web": {
      "url": "https://wallet.xchain.io/",
      "version": "1.2.2"
    }
  },
  "latest": "1.2.3"
}
`);
});

test('build refuses a channel version newer than latest', () => {
    const { result, out } = runBuild({
        ...VALID,
        channels: { web: { version: '1.2.4', url: 'https://wallet.xchain.io/' } },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid update channel/);
    assert.equal(existsSync(out), false);
});

test('build refuses a URL on a host the channel does not allow', () => {
    const { result, out } = runBuild({
        ...VALID,
        channels: { chrome: { version: '1.2.1', url: 'https://example.com/wallet' } },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid update target/);
    assert.equal(existsSync(out), false);
});

test('build refuses a non-semver latest version', () => {
    const { result, out } = runBuild({ ...VALID, latest: 'v1' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid update feed/);
    assert.equal(existsSync(out), false);
});

test('--verify-served refuses HTTP 404 without writing output', async () => {
    const { input, out } = fixture(VALID);
    const requests = [];
    await assert.rejects(
        buildReleaseJson({
            input,
            out,
            verifyServed: 'https://public.example/wallet',
            fetchImpl: async (...args) => {
                requests.push(args);
                return { status: 404 };
            },
        }),
        /HTTP 404/,
    );
    assert.equal(existsSync(out), false);
    assert.equal(requests[0][0], 'https://public.example/wallet/RELEASE_HASHES/v1.2.3.txt');
});

test('--verify-served accepts HTTP 200 and uses a credential-free request', async () => {
    const { input, out } = fixture(VALID);
    const requests = [];
    await buildReleaseJson({
        input,
        out,
        verifyServed: 'https://public.example/wallet/',
        fetchImpl: async (...args) => {
            requests.push(args);
            return { status: 200 };
        },
    });
    assert.equal(existsSync(out), true);
    assert.deepEqual(requests[0], [
        'https://public.example/wallet/RELEASE_HASHES/v1.2.3.txt',
        {
            method: 'GET',
            cache: 'no-store',
            redirect: 'error',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
        },
    ]);
});

test('the same input produces byte-identical output', async () => {
    const first = fixture(VALID);
    const second = fixture(VALID);
    await buildReleaseJson({ input: first.input, out: first.out });
    await buildReleaseJson({ input: second.input, out: second.out });
    assert.equal(readFileSync(first.out, 'utf8'), readFileSync(second.out, 'utf8'));
});

test('producer output and the client parser agree on the normalized fixture', async () => {
    const { input, out } = fixture({
        latest: 'v1.2.3',
        channels: {
            web: { version: 'v1.2.2', url: 'https://wallet.xchain.io' },
        },
    });
    const produced = await buildReleaseJson({ input, out });
    const clientParsed = parseReleaseFeed(JSON.parse(readFileSync(out, 'utf8')));
    assert.deepEqual(clientParsed, produced.feed);
    assert.deepEqual(clientParsed, {
        latest: '1.2.3',
        channels: { web: { version: '1.2.2', url: 'https://wallet.xchain.io/' } },
    });
});

test('--help documents build and served-manifest verification', () => {
    const result = spawnSync(process.execPath, [TOOL, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /build --input <file> --out <file>/);
    assert.match(result.stdout, /--verify-served <public base>/);
});
