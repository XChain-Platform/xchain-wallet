import assert from 'node:assert/strict';
import {
    copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SOURCE = fileURLToPath(new URL('./generate-appendix.js', import.meta.url));

function fixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'glossary-appendix-test-'));
    const toolDir = path.join(root, 'tools', 'glossary');
    const bridgeDir = path.join(root, 'packages', 'bridge-spec', 'src');
    const schemaDir = path.join(root, 'packages', 'core', 'src', 'schemas');
    const glossary = path.join(root, 'docs', 'glossary.md');
    mkdirSync(toolDir, { recursive: true });
    mkdirSync(bridgeDir, { recursive: true });
    mkdirSync(schemaDir, { recursive: true });
    mkdirSync(path.dirname(glossary), { recursive: true });
    copyFileSync(SOURCE, path.join(toolDir, 'generate-appendix.js'));
    writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    writeFileSync(path.join(bridgeDir, 'index.ts'),
        "export type BridgeErrorCode =\n    | 'USER_REJECTED'\n    | 'WALLET_LOCKED';\n");
    writeFileSync(path.join(schemaDir, 'connectedSite.js'), `/**
 * @typedef {Object} SitePermissions
 * @property {string[]} chains
 * @property {boolean} canSignMessage
 */
`);
    writeFileSync(glossary, '# Wallet glossary\n\nHuman-authored introduction.\n');
    return { root, glossary, tool: path.join(toolDir, 'generate-appendix.js') };
}

function run(tool, glossary, args = []) {
    return spawnSync(process.execPath, [tool, ...args], {
        encoding: 'utf8',
        env: { ...process.env, GLOSSARY_PATH: glossary },
    });
}

test('--check reports drift without writing the glossary', (t) => {
    const { root, glossary, tool } = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const before = readFileSync(glossary, 'utf8');

    const result = run(tool, glossary, ['--check']);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /out of sync/);
    assert.equal(readFileSync(glossary, 'utf8'), before);
});

test('writes a source-derived appendix and makes the check pass', (t) => {
    const { root, glossary, tool } = fixture();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const written = run(tool, glossary);

    assert.equal(written.status, 0, written.stderr);
    const output = readFileSync(glossary, 'utf8');
    assert.match(output, /Human-authored introduction\./);
    assert.match(output, /BEGIN auto-generated glossary appendix/);
    assert.match(output, /`USER_REJECTED`/);
    assert.match(output, /`WALLET_LOCKED`/);
    assert.match(output, /`chains`/);
    assert.match(output, /`canSignMessage`/);

    const checked = run(tool, glossary, ['--check']);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /already in sync/);
});
