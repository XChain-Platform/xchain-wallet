import assert from 'node:assert/strict';
import {
    copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SOURCE = fileURLToPath(new URL('./sdk-link.mjs', import.meta.url));
const SHELLS = ['web', 'extension', 'desktop'];

function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'sdk-link-test-'));
    const toolDir = path.join(root, 'tools', 'dev');
    const sdk = path.join(root, 'sdk-checkout');
    mkdirSync(toolDir, { recursive: true });
    mkdirSync(sdk);
    copyFileSync(SOURCE, path.join(toolDir, 'sdk-link.mjs'));
    writeFileSync(path.join(sdk, 'package.json'), '{"name":"xchain-sdk"}\n');
    for (const shell of SHELLS) {
        const installed = path.join(root, 'packages', shell, 'node_modules', 'xchain-sdk');
        mkdirSync(installed, { recursive: true });
        writeFileSync(path.join(installed, 'registry-marker.txt'), `${shell}\n`);
    }
    return { root, sdk, tool: path.join(toolDir, 'sdk-link.mjs') };
}

function run(tool, args) {
    return spawnSync(process.execPath, [realpathSync(tool), ...args], { encoding: 'utf8' });
}

test('rejects an unknown command with usage', (t) => {
    const { root, tool } = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(tool, ['replace']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /<link\|unlink\|status>/);
});

test('links every shell to a checkout and restores each registry package', (t) => {
    const { root, sdk, tool } = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const linked = run(tool, ['link', '--sdk', sdk]);

    assert.equal(linked.status, 0, linked.stderr);
    for (const shell of SHELLS) {
        const modules = path.join(root, 'packages', shell, 'node_modules');
        assert.equal(lstatSync(path.join(modules, 'xchain-sdk')).isSymbolicLink(), true);
        assert.equal(readFileSync(path.join(modules, 'xchain-sdk.registry-backup', 'registry-marker.txt'), 'utf8'), `${shell}\n`);
    }

    const status = run(tool, ['status']);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /web\s+symlink/);
    assert.match(status.stdout, /registry copy stashed/);

    const unlinked = run(tool, ['unlink']);
    assert.equal(unlinked.status, 0, unlinked.stderr);
    for (const shell of SHELLS) {
        const installed = path.join(root, 'packages', shell, 'node_modules', 'xchain-sdk');
        assert.equal(lstatSync(installed).isDirectory(), true);
        assert.equal(readFileSync(path.join(installed, 'registry-marker.txt'), 'utf8'), `${shell}\n`);
    }
});
