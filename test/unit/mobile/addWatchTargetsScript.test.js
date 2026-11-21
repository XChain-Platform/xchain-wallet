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

const repoRoot = process.cwd();
const source = resolve(repoRoot, 'packages/mobile/scripts/add-watch-targets.rb');
const fixtures = [];

afterEach(() => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'darwin')('add-watch-targets.rb', () => {
    it('creates idempotent watch targets backed by Version.xcconfig', () => {
        const fixture = makeFixture();
        const first = run(fixture);
        expect(first.status, first.stderr).toBe(0);

        const projectFile = join(fixture.project, 'project.pbxproj');
        const firstProject = readFileSync(projectFile);
        const facts = projectFacts(fixture.project);
        const app = facts.targets.find((target) => target.name === 'WatchApp');
        const tests = facts.targets.find((target) => target.name === 'WatchAppTests');

        expect(app.productType).toBe('com.apple.product-type.application');
        expectSettings(app, {
            GENERATE_INFOPLIST_FILE: 'YES',
            INFOPLIST_KEY_CFBundleDisplayName: 'XChain',
            INFOPLIST_KEY_WKApplication: 'YES',
            INFOPLIST_KEY_WKCompanionAppBundleIdentifier: 'io.xchain.wallet.ios',
            INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp: 'NO',
            INFOPLIST_KEY_WKWatchOnly: 'NO',
            PRODUCT_BUNDLE_IDENTIFIER: 'io.xchain.wallet.ios.watch',
            WATCHOS_DEPLOYMENT_TARGET: '10.0',
        });
        expect(tests.productType).toBe('com.apple.product-type.bundle.unit-test');
        expect(tests.dependencies).toEqual(['WatchApp']);
        expectSettings(tests, {
            PRODUCT_BUNDLE_IDENTIFIER: 'io.xchain.wallet.ios.watch.tests',
            TEST_HOST: '$(BUILT_PRODUCTS_DIR)/WatchApp.app/WatchApp',
            WATCHOS_DEPLOYMENT_TARGET: '10.0',
        });
        expect(facts.groups).toEqual(['WatchApp', 'WatchAppTests']);
        expect(firstProject.toString()).toMatch(/objectVersion = 77;/);
        expect(firstProject.toString()).toMatch(/preferredProjectObjectVersion = 77;/);
        expect(existsSync(join(fixture.project, 'xcshareddata/xcschemes/WatchApp.xcscheme'))).toBe(true);

        const second = run(fixture);
        expect(second.status, second.stderr).toBe(0);
        expect(readFileSync(projectFile)).toEqual(firstProject);
    });

    it('rejects xcodeproj versions older than 1.28 before opening a project', () => {
        const fixture = makeFixture();
        const rubyLib = join(fixture.root, 'ruby');
        mkdirSync(rubyLib, { recursive: true });
        writeFileSync(join(rubyLib, 'xcodeproj.rb'), "module Xcodeproj\n  VERSION = '1.27.0'\nend\n");

        const result = run(fixture, { RUBYLIB: rubyLib });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('xcodeproj >= 1.28 required (found 1.27.0)');
    });
});

function makeFixture() {
    const tempRoot = resolve(repoRoot, 'tmp');
    mkdirSync(tempRoot, { recursive: true });
    const root = mkdtempSync(join(tempRoot, 'add-watch-targets-'));
    fixtures.push(root);
    const script = join(root, 'scripts/add-watch-targets.rb');
    const project = join(root, 'ios/App/App.xcodeproj');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(source, script);

    const create = spawnSync('/usr/bin/ruby', ['-rxcodeproj', '-e', `
project = Xcodeproj::Project.new(ARGV.fetch(0))
project.main_group.new_file('Version.xcconfig')
project.save
`, project], { encoding: 'utf8' });
    expect(create.status, create.stderr).toBe(0);
    return { root, script, project };
}

function run(fixture, overrides = {}) {
    return spawnSync('/usr/bin/ruby', [fixture.script], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: { ...process.env, ...overrides },
    });
}

function projectFacts(project) {
    const ruby = `
project = Xcodeproj::Project.open(ARGV.fetch(0))
targets = project.targets.map do |target|
  {
    name: target.name,
    productType: target.product_type,
    configurations: target.build_configurations.map do |configuration|
      { base: configuration.base_configuration_reference&.path, settings: configuration.build_settings }
    end,
    dependencies: target.dependencies.map { |dependency| dependency.target&.name }.compact,
  }
end
group_class = Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup
groups = project.objects.select { |object| object.is_a?(group_class) }.map(&:path).sort
puts JSON.generate({ targets: targets, groups: groups })
`;
    const result = spawnSync('/usr/bin/ruby', ['-rxcodeproj', '-rjson', '-e', ruby, project], {
        encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
}

function expectSettings(target, expected) {
    expect(target.configurations).toHaveLength(2);
    for (const configuration of target.configurations) {
        expect(configuration.base).toBe('Version.xcconfig');
        expect(configuration.settings).toMatchObject(expected);
    }
}
