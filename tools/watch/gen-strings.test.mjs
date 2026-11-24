// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const sources = [
    'strings-alerts.json',
    'strings-balances.json',
    'strings-surfaces.json',
];

async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), 'watch-strings-'));
    const contract = path.join(root, 'packages/core/src/watch/contract');
    const tools = path.join(root, 'tools/watch');
    await Promise.all([mkdir(contract, { recursive: true }), mkdir(tools, { recursive: true })]);
    await Promise.all(sources.map((name) => cp(
        path.join(repository, 'packages/core/src/watch/contract', name),
        path.join(contract, name),
    )));
    await cp(
        path.join(repository, 'tools/watch/gen-strings.mjs'),
        path.join(tools, 'gen-strings.mjs'),
    );
    return root;
}

function run(root, ...args) {
    return spawnSync(process.execPath, [path.join(root, 'tools/watch/gen-strings.mjs'), ...args], {
        cwd: root,
        encoding: 'utf8',
    });
}

test('merges all catalogs into deterministic Apple and Android resources', async (t) => {
    const root = await fixture();
    t.after(() => rm(root, { recursive: true, force: true }));

    assert.equal(run(root).status, 0);
    const apple = await readFile(
        path.join(root, 'packages/mobile/ios/App/WatchApp/en.lproj/Localizable.strings'),
        'utf8',
    );
    const widgets = await readFile(
        path.join(root, 'packages/mobile/ios/App/WatchWidgets/en.lproj/Localizable.strings'),
        'utf8',
    );
    const android = await readFile(
        path.join(root, 'packages/mobile/android/wear/src/main/res/values/strings.xml'),
        'utf8',
    );
    assert.equal(widgets, apple);
    assert.ok(widgets.includes('"g1.request" = "Request";'));
    assert.match(apple, /"g1\.alerts" = "Alerts";/);
    assert.match(apple, /"w1\.title" = "Balances";/);
    assert.match(apple, /"w4\.title" = "Alert detail";/);
    assert.match(android, /<string name="g1_alerts">Alerts<\/string>/);
    assert.match(android, /<string name="w1_request_waiting">1 request waiting<\/string>/);
    assert.match(android, /<string name="w1_title">Balances<\/string>/);
    assert.match(android, /<string name="w4_title">Alert detail<\/string>/);
    assert.equal(run(root, '--check').status, 0);
});

test('--check exits one when either output is stale and does not rewrite it', async (t) => {
    const root = await fixture();
    t.after(() => rm(root, { recursive: true, force: true }));
    assert.equal(run(root).status, 0);
    const outputs = [
        'packages/mobile/ios/App/WatchApp/en.lproj/Localizable.strings',
        'packages/mobile/ios/App/WatchWidgets/en.lproj/Localizable.strings',
        'packages/mobile/android/wear/src/main/res/values/strings.xml',
    ];

    for (const name of outputs) {
        const output = path.join(root, name);
        await writeFile(output, 'stale\n');
        const checked = run(root, '--check');
        assert.equal(checked.status, 1);
        assert.match(checked.stderr, /Stale generated strings:/);
        assert.ok(checked.stderr.includes(name));
        assert.equal(await readFile(output, 'utf8'), 'stale\n');
        assert.equal(run(root).status, 0);
    }
});
