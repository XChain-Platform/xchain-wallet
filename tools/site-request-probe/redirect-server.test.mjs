// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';

import { createProbeServer } from './redirect-server.mjs';

const server = createProbeServer({ allowHosts: ['allowed.example:8443'] });
let origin;

before(async () => {
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
});

test('serves the probe page at both page paths', async () => {
    const expected = await readFile(new URL('./index.html', import.meta.url), 'utf8');
    for (const path of ['/', '/index.html']) {
        const response = await fetch(`${origin}${path}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
        assert.equal(await response.text(), expected);
    }
});

test('redirects to a same-origin path without caching', async () => {
    const response = await fetch(`${origin}/r302?to=${encodeURIComponent('/landing?run=1')}`, {
        redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/landing?run=1');
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('strips a fragment from the redirect target', async () => {
    const response = await fetch(`${origin}/r302?to=${encodeURIComponent('/landing?run=1#marker')}`, {
        redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/landing?run=1');
});

test('redirects to an explicitly allowed cross-origin host', async () => {
    const target = 'https://allowed.example:8443/landing?run=1#marker';
    const response = await fetch(`${origin}/r302?to=${encodeURIComponent(target)}`, {
        redirect: 'manual',
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://allowed.example:8443/landing?run=1');
    assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('rejects unsafe redirect targets without a Location header', async () => {
    const targets = [
        null,
        '//evil.example/landing',
        '/\\evil.example/landing',
        'javascript:alert(1)',
        'https://unlisted.example/landing',
    ];
    for (const target of targets) {
        const suffix = target === null ? '' : `?to=${encodeURIComponent(target)}`;
        const response = await fetch(`${origin}/r302${suffix}`, { redirect: 'manual' });
        assert.equal(response.status, 400, target ?? 'missing target');
        assert.equal(response.headers.get('location'), null, target ?? 'missing target');
        assert.equal(response.headers.get('cache-control'), 'no-store', target ?? 'missing target');
    }
});

test('answers an unknown path with 404', async () => {
    const response = await fetch(`${origin}/missing`);
    assert.equal(response.status, 404);
});
