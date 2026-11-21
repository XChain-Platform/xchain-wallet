// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = process.cwd();
const SOURCE_SCRIPT = resolve(REPO_ROOT, 'packages/mobile/scripts/add-watch-targets.rb');
const SOURCE_PROJECT = resolve(REPO_ROOT, 'packages/mobile/ios/App/App.xcodeproj');
const fixtures = [];

afterEach(() => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

if (process.platform !== 'darwin') {
    console.log('add-watch-targets scratch test skipped: requires darwin and the macOS Ruby toolchain');
}

describe.skipIf(process.platform !== 'darwin')('add-watch-targets.rb scratch project', () => {
    it('creates two idempotent watch targets without changing the existing targets', () => {
        expect(existsSync('/usr/bin/ruby'), 'missing /usr/bin/ruby on darwin').toBe(true);
        const gem = spawnSync('/usr/bin/ruby', ['-rxcodeproj', '-e', 'print Xcodeproj::VERSION'], {
            encoding: 'utf8',
        });
        expect(gem.status, `xcodeproj gem unavailable: ${gem.stderr}`).toBe(0);

        const fixture = makeFixture();
        const before = targetSnapshot(fixture.project);
        const first = runScript(fixture);
        expect(first.status, first.stderr).toBe(0);

        const firstProject = readFileSync(join(fixture.project, 'project.pbxproj'));
        const projectText = firstProject.toString('utf8');
        const after = targetSnapshot(fixture.project);
        expect(after.map(({ name }) => name)).toEqual([
            ...before.map(({ name }) => name),
            'WatchApp',
            'WatchAppTests',
        ]);
        expect(after.filter(({ name }) => before.some((target) => target.name === name)))
            .toEqual(before);

        const watchApp = after.find(({ name }) => name === 'WatchApp');
        expect(watchApp.productType).toBe('com.apple.product-type.application');
        expectAllSettings(watchApp, {
            GENERATE_INFOPLIST_FILE: 'YES',
            INFOPLIST_KEY_CFBundleDisplayName: 'XChain',
            INFOPLIST_KEY_WKApplication: 'YES',
            INFOPLIST_KEY_WKCompanionAppBundleIdentifier: 'io.xchain.wallet.ios',
            INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp: 'NO',
            INFOPLIST_KEY_WKWatchOnly: 'NO',
            PRODUCT_BUNDLE_IDENTIFIER: 'io.xchain.wallet.ios.watch',
            SDKROOT: 'watchos',
            WATCHOS_DEPLOYMENT_TARGET: '10.0',
        });

        const watchTests = after.find(({ name }) => name === 'WatchAppTests');
        expect(watchTests.productType).toBe('com.apple.product-type.bundle.unit-test');
        expect(watchTests.dependencies).toEqual(['WatchApp']);
        expectAllSettings(watchTests, {
            BUNDLE_LOADER: '$(TEST_HOST)',
            PRODUCT_BUNDLE_IDENTIFIER: 'io.xchain.wallet.ios.watch.tests',
            SDKROOT: 'watchos',
            TEST_HOST: '$(BUILT_PRODUCTS_DIR)/WatchApp.app/WatchApp',
            WATCHOS_DEPLOYMENT_TARGET: '10.0',
        });

        expect(projectText).toMatch(/objectVersion = 77;/);
        expect(projectText).toMatch(/preferredProjectObjectVersion = 77;/);
        expect(projectText.match(/isa = PBXFileSystemSynchronizedRootGroup;/g)).toHaveLength(2);
        expect(projectText).toMatch(/path = WatchApp;/);
        expect(projectText).toMatch(/path = WatchAppTests;/);
        expect(existsSync(join(fixture.project, 'xcshareddata/xcschemes/WatchApp.xcscheme'))).toBe(true);

        const second = runScript(fixture);
        expect(second.status, second.stderr).toBe(0);
        expect(readFileSync(join(fixture.project, 'project.pbxproj'))).toEqual(firstProject);
    });

    it('aborts before project mutation when xcodeproj is older than 1.28', () => {
        expect(existsSync('/usr/bin/ruby'), 'missing /usr/bin/ruby on darwin').toBe(true);
        const fixture = makeFixture();
        const rubyLib = join(fixture.root, 'ruby');
        mkdirSync(rubyLib, { recursive: true });
        writeFileSync(join(rubyLib, 'xcodeproj.rb'), "module Xcodeproj\n  VERSION = '1.27.0'\nend\n");

        const result = spawnSync('/usr/bin/ruby', [fixture.script], {
            cwd: fixture.root,
            encoding: 'utf8',
            env: { ...process.env, RUBYLIB: rubyLib },
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('xcodeproj >= 1.28 required (found 1.27.0)');
    });
});

function makeFixture() {
    const tempRoot = resolve(REPO_ROOT, 'tmp');
    mkdirSync(tempRoot, { recursive: true });
    const root = mkdtempSync(join(tempRoot, 'add-watch-targets-'));
    fixtures.push(root);
    const script = join(root, 'scripts/add-watch-targets.rb');
    const project = join(root, 'ios/App/App.xcodeproj');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(SOURCE_SCRIPT, script);
    cpSync(SOURCE_PROJECT, project, { recursive: true });
    return { root, script, project };
}

function runScript(fixture) {
    return spawnSync('/usr/bin/ruby', [fixture.script], {
        cwd: fixture.root,
        encoding: 'utf8',
    });
}

function targetSnapshot(project) {
    const ruby = `
project = Xcodeproj::Project.open(ARGV.fetch(0))
targets = project.targets.map do |target|
  {
    name: target.name,
    productType: target.product_type,
    productName: target.product_name,
    configurations: target.build_configurations.map do |configuration|
      {
        name: configuration.name,
        base: configuration.base_configuration_reference&.path,
        settings: configuration.build_settings,
      }
    end,
    dependencies: target.dependencies.map { |dependency| dependency.target&.name }.compact,
  }
end
puts JSON.generate(targets)
`;
    const result = spawnSync('/usr/bin/ruby', ['-rxcodeproj', '-rjson', '-e', ruby, project], {
        encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
}

function expectAllSettings(target, expected) {
    expect(target.configurations).toHaveLength(2);
    for (const configuration of target.configurations) {
        expect(configuration.base).toBe('Version.xcconfig');
        expect(configuration.settings).toMatchObject(expected);
    }
}
