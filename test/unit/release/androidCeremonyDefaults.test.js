// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const work = [];
const executable = (path, body = '#!/usr/bin/env bash\nexit 0\n') => {
    writeFileSync(path, body);
    chmodSync(path, 0o755);
};

function fixture({ bundletools = 1, directKeystore = true } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'android-ceremony-defaults-'));
    work.push(root);
    const release = join(root, 'tools/release');
    const mobile = join(root, 'packages/mobile');
    const store = join(root, 'keys');
    const javaBin = join(root, 'jdk/bin');
    const buildTools = join(root, 'sdk/build-tools/36.0.0');
    const stubBin = join(root, 'stub-bin');
    for (const dir of [release, join(mobile, 'scripts'), store, javaBin, buildTools, stubBin]) {
        mkdirSync(dir, { recursive: true });
    }
    copyFileSync(join(repoRoot, 'tools/release/android-ceremony.sh'), join(release, 'android-ceremony.sh'));
    copyFileSync(join(repoRoot, 'packages/mobile/scripts/version.js'), join(mobile, 'scripts/version.js'));
    writeFileSync(join(mobile, 'package.json'), '{"type":"module","version":"9.8.7"}\n');
    writeFileSync(join(store, 'xchain-play-upload.p12'), '');
    if (directKeystore) writeFileSync(join(store, 'xchain-direct-apk.p12'), '');
    for (const name of ['k9-upload.pass', 'k10-direct.pass']) {
        writeFileSync(join(store, name), '');
        chmodSync(join(store, name), 0o600);
    }
    for (let i = 0; i < bundletools; i += 1) writeFileSync(join(store, `bundletool-${i + 1}.0.0.jar`), '');
    executable(join(javaBin, 'java'));
    executable(join(javaBin, 'jarsigner'));
    executable(join(buildTools, 'apksigner'));
    executable(join(stubBin, 'git'), [
        '#!/usr/bin/env bash',
        '[ "$3" = status ] && exit 0',
        '[ "$3" = rev-parse ] && [ "$4" = HEAD ] && printf "%040d\\n" 0 && exit 0',
        'exit 1',
        '',
    ].join('\n'));
    executable(join(stubBin, 'pnpm'), '#!/usr/bin/env bash\necho "PNPM_REACHED:${XCHAIN_K9_ALIAS:-}"\nexit 3\n');
    const env = { ...process.env, XCHAIN_KEY_DIR: store, JAVA_HOME: dirname(javaBin), ANDROID_HOME: join(root, 'sdk') };
    for (const name of ['CI', 'GITHUB_ACTIONS', 'BUNDLETOOL', 'ANDROID_SDK_ROOT',
        'XCHAIN_K9_KEYSTORE', 'XCHAIN_K9_ALIAS', 'XCHAIN_K9_PASSFILE',
        'XCHAIN_K10_KEYSTORE', 'XCHAIN_K10_ALIAS', 'XCHAIN_K10_PASSFILE']) delete env[name];
    env.PATH = `${stubBin}:${env.PATH}`;
    return { script: join(release, 'android-ceremony.sh'), env, store };
}

const run = (setup, args = ['--rehearsal']) => spawnSync('bash', [setup.script, ...args], {
    env: setup.env, encoding: 'utf8', timeout: 20_000,
});

afterEach(() => work.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

describe('android ceremony rehearsal defaults', () => {
    it('reaches pnpm with every local default named', () => {
        const result = run(fixture());
        expect(result.status).toBe(3);
        for (const value of ['TAG=v9.8.7', 'OUTPUT_DIR=', 'XCHAIN_K9_KEYSTORE=',
            'XCHAIN_K9_ALIAS=xchain-upload', 'XCHAIN_K9_PASSFILE=', 'XCHAIN_K10_KEYSTORE=',
            'XCHAIN_K10_ALIAS=xchain-direct', 'XCHAIN_K10_PASSFILE=', 'BUNDLETOOL=',
            'PATH=']) expect(result.stdout).toContain(`==> rehearsal default: ${value}`);
        expect(result.stdout).toContain('PNPM_REACHED:');
    });

    it('lets an explicit tag and alias win', () => {
        const setup = fixture();
        setup.env.XCHAIN_K9_ALIAS = 'other';
        const result = run(setup, ['--rehearsal', '--tag', 'v1.2.3']);
        expect(result.status).toBe(3);
        expect(result.stdout).toContain('==> v1.2.3 ->');
        expect(result.stdout).toContain('PNPM_REACHED:other');
        expect(result.stdout).not.toContain('rehearsal default: TAG=');
        expect(result.stdout).not.toContain('rehearsal default: XCHAIN_K9_ALIAS=');
    });

    it('keeps a non-rehearsal run strict', () => {
        const result = run(fixture(), []);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('--tag vX.Y.Z is required');
    });

    it('refuses multiple bundletool jars with their count', () => {
        const result = run(fixture({ bundletools: 2 }));
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('found 2 bundletool-*.jar files');
    });

    it('leaves a missing direct keystore for the existing refusal', () => {
        const result = run(fixture({ directKeystore: false }));
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('XCHAIN_K10_KEYSTORE must be set');
    });
});
