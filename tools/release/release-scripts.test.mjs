import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
    copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    STABLE_BUILD,
    storeVersionFromTag,
    versionCodeFromTag,
} from '../../packages/mobile/scripts/version.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, 'verify-validated-commit.mjs');
const BUMP = join(HERE, 'bump-version.mjs');
const SHA = 'a'.repeat(40);
const REPO = 'XChain-Platform/xchain-wallet';

function runGate(args, env = {}) {
    return spawnSync(process.execPath, [GATE, ...args], {
        encoding: 'utf8',
        env: {
            ...process.env,
            GITHUB_TOKEN: '',
            GITHUB_REPOSITORY: '',
            ...env,
        },
    });
}

test('derives the store integer with stable in the middle build band', () => {
    const formula = (major, minor, patch, build) => (
        major * 10_000_000 + minor * 10_000 + patch * 100 + build
    );

    assert.equal(STABLE_BUILD, 50);
    assert.equal(storeVersionFromTag('v0.341.3'), formula(0, 341, 3, STABLE_BUILD));
    assert.equal(storeVersionFromTag('v2.34.56'), formula(2, 34, 56, STABLE_BUILD));
    assert.equal(versionCodeFromTag('v0.341.3'), storeVersionFromTag('v0.341.3'));
    assert.equal(storeVersionFromTag('v0.341.3-beta.49'), formula(0, 341, 3, 49));
    assert.equal(storeVersionFromTag('v0.341.3-respin.1'), formula(0, 341, 3, 51));
});

test('bump-version reconciles every package and both extension manifest versions', (t) => {
    const root = mkdtempSync(join(tmpdir(), 'release-bump-consistency-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const toolDir = join(root, 'tools', 'release');
    mkdirSync(toolDir, { recursive: true });
    copyFileSync(BUMP, join(toolDir, 'bump-version.mjs'));

    writeFileSync(join(root, 'package.json'), '{\n    "version": "1.0.0"\n}\n');
    for (const [index, name] of ['core', 'extension', 'future-package'].entries()) {
        const packageDir = join(root, 'packages', name);
        mkdirSync(packageDir, { recursive: true });
        writeFileSync(join(packageDir, 'package.json'),
            `{\n    "name": "${name}",\n    "version": "${index + 2}.0.0"\n}\n`);
    }
    mkdirSync(join(root, 'packages', 'core', 'src'), { recursive: true });
    writeFileSync(join(root, 'packages', 'core', 'src', 'buildInfo.js'),
        "export const WALLET_VERSION = '6.0.0';\n");
    writeFileSync(join(root, 'packages', 'extension', 'manifest.json'),
        '{\n    "version": "7.0.0",\n    "version_name": "Store label 7.0.0"\n}\n');
    writeFileSync(join(root, 'README.md'),
        '<img src="https://img.shields.io/badge/version-8.0.0-blue">\n'
        + 'Pre-v2.0 (current version: `9.0.0`).\n');
    writeFileSync(join(root, 'CHANGELOG.md'), `# Changelog

## [Unreleased]

- Reconcile release versions.

## [1.0.0] - 2026-01-01

- Previous release.
`);

    const result = spawnSync(process.execPath, [
        join(toolDir, 'bump-version.mjs'), '1.1.0', '--date', '2026-10-13',
    ], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);

    for (const file of [
        'package.json',
        'packages/core/package.json',
        'packages/extension/package.json',
        'packages/future-package/package.json',
    ]) {
        assert.equal(JSON.parse(readFileSync(join(root, file), 'utf8')).version, '1.1.0');
    }
    const manifest = JSON.parse(readFileSync(
        join(root, 'packages', 'extension', 'manifest.json'), 'utf8',
    ));
    assert.equal(manifest.version, '1.1.0');
    assert.equal(manifest.version_name, '1.1.0');
});

test('rejects malformed release-gate arguments before contacting GitHub', () => {
    const help = runGate(['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Required commit statuses: license\/cla/);

    for (const [args, message] of [
        [['--sha'], /requires a value/],
        [['--unknown'], /unknown option/],
        [['stray'], /unexpected argument/],
        [['--sha', SHA, '--sha', SHA], /only once/],
    ]) {
        const result = runGate(args);
        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, message);
    }

    const waitOption = runGate(
        ['--sha', SHA, '--repo', REPO, '--poll', '1'],
        { GITHUB_TOKEN: 'test-token' },
    );
    assert.equal(waitOption.status, 1, waitOption.stdout);
    assert.match(waitOption.stderr, /require --wait/);
});

const SERVER = `
const http = require('node:http');
const statuses = JSON.parse(process.argv[1]);
const routes = {
    ['/repos/${REPO}/actions/runs']: {
        workflow_runs: [{
            id: 42,
            path: '.github/workflows/ci.yml',
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-10-13T10:00:00Z',
            html_url: 'https://example.invalid/run/42',
        }],
    },
    ['/repos/${REPO}/commits/${SHA}/status']: { statuses },
};
const server = http.createServer((req, res) => {
    const body = routes[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body || { message: 'not found' }));
});
server.listen(0, '127.0.0.1', () => {
    process.stdout.write('PORT=' + server.address().port + '\\n');
});
`;

function serve(statuses) {
    const child = spawn(process.execPath, ['-e', SERVER, JSON.stringify(statuses)], {
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    return new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('stub server did not start')), 10_000);
        child.stdout.on('data', (chunk) => {
            output += chunk;
            const match = output.match(/PORT=(\d+)/);
            if (match) {
                clearTimeout(timer);
                resolve({
                    port: Number(match[1]),
                    stop: () => child.kill('SIGKILL'),
                });
            }
        });
    });
}

async function withStatuses(statuses, callback) {
    const server = await serve(statuses);
    try {
        return callback(runGate(['--sha', SHA, '--repo', REPO], {
            GITHUB_TOKEN: 'test-token',
            GITHUB_API_URL: `http://127.0.0.1:${server.port}`,
        }));
    } finally {
        server.stop();
    }
}

test('requires a successful license/cla status in addition to the CI workflow', async () => {
    await withStatuses([{
        context: 'license/cla',
        state: 'success',
        updated_at: '2026-10-13T10:00:00Z',
        target_url: 'https://example.invalid/status/cla',
    }], (result) => {
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Required statuses: license\/cla/);
        assert.match(result.stdout, /license\/cla: state=success/);
    });

    await withStatuses([], (result) => {
        assert.equal(result.status, 1, result.stdout);
        assert.match(result.stderr, /required status `license\/cla` does not exist/);
    });
});
