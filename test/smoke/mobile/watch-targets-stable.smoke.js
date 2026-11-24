// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {
    chmodSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { applyNativeSmokeGate } from '../../helpers/nativeSmokeGate.js';
import { versionXcconfigFor } from '../../../packages/mobile/scripts/version.js';

applyNativeSmokeGate('watch-targets-stable.smoke.js');

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scratchRoot = join(root, 'tmp');
mkdirSync(scratchRoot, { recursive: true });
const fixture = mkdtempSync(join(scratchRoot, 'watch-targets-stable-'));
const mobile = join(fixture, 'packages/mobile');
const project = join(mobile, 'ios/App/App.xcodeproj');
const pbxproj = join(project, 'project.pbxproj');

try {
    stageFixture();

    run('ruby', [join(mobile, 'scripts/add-uitest-target.rb')]);
    run('ruby', [join(mobile, 'scripts/add-watch-targets.rb')]);
    syncIos();
    const first = readFileSync(pbxproj);

    run('ruby', [join(mobile, 'scripts/add-watch-targets.rb')]);
    syncIos();
    const second = readFileSync(pbxproj);

    assert.deepEqual(second, first, 'the second watch-target and Capacitor sync pass changed project.pbxproj');
    assertProjectShape(second.toString('utf8'));

    await runArchive('/bin/bash', [join(fixture, 'tools/release/ios-archive.sh')], {
        CFFIXED_USER_HOME: join(fixture, 'user-home'),
        CLANG_MODULE_CACHE_PATH: join(fixture, 'module-cache'),
        PATH: `${join(fixture, 'bin')}:${process.env.PATH}`,
        SWIFTPM_MODULECACHE_OVERRIDE: join(fixture, 'module-cache'),
        XCHAIN_IOS_ARCHIVE_UNSIGNED: '1',
        XCHAIN_TEST_DERIVED_DATA: join(fixture, 'derived-data'),
        XCHAIN_TEST_PACKAGE_CACHE: join(fixture, 'package-cache'),
        XCHAIN_TEST_SOURCE_PACKAGES: join(fixture, 'source-packages'),
        XDG_CACHE_HOME: join(fixture, 'cache'),
    }, 30 * 60_000);

    const app = join(mobile, 'ios/build/App.xcarchive/Products/Applications/App.app');
    assert.ok(existsSync(join(app, 'Watch/WatchApp.app')), 'the archive is missing WatchApp.app');
    assert.ok(
        existsSync(join(app, 'Watch/WatchApp.app/PlugIns/WatchWidgets.appex')),
        'the archived watch app is missing WatchWidgets.appex',
    );

    console.log('watch targets stable smoke OK (two syncs byte-identical; watch archive embedded)');
} finally {
    try {
        rmSync(fixture, { recursive: true, force: true, maxRetries: 60, retryDelay: 500 });
    } catch (error) {
        console.error(`watch targets stable smoke cleanup failed: ${error.message}`);
    }
}

function stageFixture() {
    cpSync(join(root, 'packages/mobile/ios'), join(mobile, 'ios'), { recursive: true });
    copy('packages/mobile/capacitor.config.json');
    copy('packages/mobile/package.json');
    copy('packages/mobile/scripts/add-uitest-target.rb');
    copy('packages/mobile/scripts/add-watch-targets.rb');
    copy('packages/mobile/scripts/version.js');
    copy('packages/core/src/uri/xchainUri.js');
    copy('tools/release/ios-archive.sh');
    copy('tools/release/is-invoked-directly.mjs');
    copy('tools/release/verify-ios-artifact.mjs');
    copy('tools/release/watch-embed.mjs');

    symlinkSync(join(root, 'packages/mobile/node_modules'), join(mobile, 'node_modules'), 'dir');
    mkdirSync(join(mobile, 'www'), { recursive: true });
    writeFileSync(join(mobile, 'www/index.html'), '<!doctype html><title>XChain</title>\n');
    const { version } = JSON.parse(readFileSync(join(mobile, 'package.json'), 'utf8'));
    writeFileSync(join(mobile, 'ios/App/Version.xcconfig'), versionXcconfigFor(`v${version}`));

    const xcodebuild = join(fixture, 'bin/xcodebuild');
    mkdirSync(dirname(xcodebuild), { recursive: true });
    writeFileSync(
        xcodebuild,
        '#!/bin/bash\nexec /usr/bin/xcodebuild '
        + '-IDEPackageSupportDisableManifestSandbox=YES '
        + '-derivedDataPath "$XCHAIN_TEST_DERIVED_DATA" '
        + '-packageCachePath "$XCHAIN_TEST_PACKAGE_CACHE" '
        + '-clonedSourcePackagesDirPath "$XCHAIN_TEST_SOURCE_PACKAGES" "$@"\n',
    );
    chmodSync(xcodebuild, 0o755);
}

function copy(relativePath) {
    const destination = join(fixture, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(root, relativePath), destination);
}

function syncIos() {
    const cli = join(mobile, 'node_modules/@capacitor/cli/bin/capacitor');
    run(process.execPath, [cli, 'sync', 'ios'], {}, 5 * 60_000, mobile);
}

function assertProjectShape(projectText) {
    const targetNames = JSON.parse(run('ruby', [
        '-rxcodeproj',
        '-rjson',
        '-e',
        'puts JSON.generate(Xcodeproj::Project.open(ARGV.fetch(0)).targets.map(&:name))',
        project,
    ]).stdout);
    for (const target of ['App', 'WatchApp', 'WatchWidgets', 'WatchAppTests']) {
        assert.ok(targetNames.includes(target), `the synchronized project lost target ${target}`);
    }

    assert.equal(
        (projectText.match(/isa = PBXFileSystemSynchronizedRootGroup;/g) || []).length,
        4,
        'the project must retain four synchronized watch source groups',
    );
    for (const group of ['WatchApp', 'WatchAppTests', 'WatchShared', 'WatchWidgets']) {
        assert.match(projectText, new RegExp(`path = ${group};`));
    }
    assert.match(projectText, /name = "Embed Watch Content";/);
    assert.match(projectText, /WatchApp\.app in Embed Watch Content/);
    assert.match(projectText, /name = "Embed App Extensions";/);
    assert.match(projectText, /WatchWidgets\.appex in Embed App Extensions/);
    assert.match(projectText, /objectVersion = 77;/);
}

function run(command, args, extraEnv = {}, timeout = 2 * 60_000, cwd = fixture) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, ...extraEnv },
        maxBuffer: 64 * 1024 * 1024,
        timeout,
    });
    assert.ifError(result.error);
    assert.equal(
        result.status,
        0,
        `${command} ${args.join(' ')} failed\n${result.stdout || ''}${result.stderr || ''}`,
    );
    return result;
}

function runArchive(command, args, extraEnv, timeout) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: fixture,
            detached: true,
            env: { ...process.env, ...extraEnv },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let forceKill;
        child.stdout.on('data', (chunk) => { stdout += chunk; });
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('error', reject);
        const timer = setTimeout(() => {
            timedOut = true;
            killProcessGroup(child.pid, 'SIGTERM');
            forceKill = setTimeout(() => killProcessGroup(child.pid, 'SIGKILL'), 5_000);
        }, timeout);
        child.on('close', (code, signal) => {
            clearTimeout(timer);
            clearTimeout(forceKill);
            try {
                assert.equal(
                    code,
                    0,
                    `${command} ${args.join(' ')} ${timedOut ? 'timed out' : `exited via ${signal || code}`}\n`
                    + stdout + stderr,
                );
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function killProcessGroup(pid, signal) {
    try {
        process.kill(-pid, signal);
    } catch (error) {
        if (error.code !== 'ESRCH') throw error;
    }
}
