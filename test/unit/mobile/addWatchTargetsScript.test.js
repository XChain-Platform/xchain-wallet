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
const uiTestSource = resolve(repoRoot, 'packages/mobile/scripts/add-uitest-target.rb');
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
        const phone = facts.targets.find((target) => target.name === 'App');
        const phoneTests = facts.targets.find((target) => target.name === 'AppTests');
        const phoneUiTests = facts.targets.find((target) => target.name === 'AppUITests');
        const widgets = facts.targets.find((target) => target.name === 'WatchWidgets');
        const tests = facts.targets.find((target) => target.name === 'WatchAppTests');

        expect(app.productType).toBe('com.apple.product-type.application');
        expectSettings(app, {
            CODE_SIGN_ENTITLEMENTS: 'WatchApp/WatchApp.entitlements',
            GENERATE_INFOPLIST_FILE: 'YES',
            INFOPLIST_KEY_CFBundleDisplayName: 'XChain',
            INFOPLIST_KEY_WKApplication: 'YES',
            INFOPLIST_KEY_WKCompanionAppBundleIdentifier: 'io.xchain.wallet.ios',
            INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp: 'NO',
            INFOPLIST_KEY_WKWatchOnly: 'NO',
            PRODUCT_BUNDLE_IDENTIFIER: 'io.xchain.wallet.ios.watch',
            WATCHOS_DEPLOYMENT_TARGET: '10.0',
        });
        expect(app.dependencies).toEqual(['WatchWidgets']);
        expect(app.groups).toEqual(['WatchApp', 'WatchShared']);
        expect(app.copyPhases).toEqual([{
            name: 'Embed App Extensions',
            destination: '13',
            path: '',
            products: ['WatchWidgets.appex'],
        }]);
        expect(widgets.productType).toBe('com.apple.product-type.app-extension');
        expect(widgets.dependencies).toEqual([]);
        expect(widgets.groups).toEqual(['WatchShared', 'WatchWidgets']);
        expectSettings(widgets, {
            APPLICATION_EXTENSION_API_ONLY: 'YES',
            CODE_SIGN_ENTITLEMENTS: 'WatchWidgets/WatchWidgets.entitlements',
            GENERATE_INFOPLIST_FILE: 'NO',
            INFOPLIST_FILE: '$(DERIVED_FILE_DIR)/WatchWidgets-Info.plist',
            PRODUCT_BUNDLE_IDENTIFIER: 'io.xchain.wallet.ios.watch.widgets',
            SKIP_INSTALL: 'YES',
            WATCHOS_DEPLOYMENT_TARGET: '10.0',
        });
        expect(widgets.scripts).toEqual([{
            name: 'Generate WatchWidgets Info',
            outputs: ['$(DERIVED_FILE_DIR)/WatchWidgets-Info.plist'],
            script: expect.stringContaining('NSExtensionPointIdentifier'),
        }]);
        expect(buildWidgetInfo(fixture)).toBe('com.apple.widgetkit-extension');
        expect(phone.dependencies).toEqual(['WatchApp']);
        expect(phone.groups).toEqual(['App/activity', 'App/fold', 'App/notify', 'App/watch']);
        expect(phoneTests.groups).toEqual(['AppTests/Native']);
        expect(phoneTests.sources).toEqual(['ExistingTests.swift']);
        expect(phoneUiTests.groups).toEqual(['AppUITests/Native']);
        expect(phoneUiTests.sources).toEqual(['ExistingUITests.swift']);
        expect(phone.copyPhases).toEqual([{
            name: 'Embed Watch Content',
            destination: '16',
            path: '$(CONTENTS_FOLDER_PATH)/Watch',
            products: ['WatchApp.app'],
        }]);
        expect(tests.productType).toBe('com.apple.product-type.bundle.unit-test');
        expect(tests.dependencies).toEqual(['WatchApp']);
        expectSettings(tests, {
            PRODUCT_BUNDLE_IDENTIFIER: 'io.xchain.wallet.ios.watch.tests',
            TEST_HOST: '$(BUILT_PRODUCTS_DIR)/WatchApp.app/WatchApp',
            WATCHOS_DEPLOYMENT_TARGET: '10.0',
        });
        expect(facts.groups).toEqual([
            'App/activity',
            'App/fold',
            'App/notify',
            'App/watch',
            'AppTests/Native',
            'AppUITests/Native',
            'WatchApp',
            'WatchAppTests',
            'WatchShared',
            'WatchWidgets',
        ]);
        expect(firstProject.toString()).toMatch(/objectVersion = 77;/);
        expect(firstProject.toString()).toMatch(/preferredProjectObjectVersion = 77;/);
        expect(existsSync(join(fixture.project, 'xcshareddata/xcschemes/WatchApp.xcscheme'))).toBe(true);

        const second = run(fixture);
        expect(second.status, second.stderr).toBe(0);
        expect(readFileSync(projectFile)).toEqual(firstProject);

        const uiRefresh = runUiTestScript(fixture);
        expect(uiRefresh.status, uiRefresh.stderr).toBe(0);
        const refreshedUiTests = projectFacts(fixture.project).targets
            .find((target) => target.name === 'AppUITests');
        expect(refreshedUiTests.groups).toEqual(['AppUITests/Native']);
        expect(refreshedUiTests.sources).toEqual(['ExistingUITests.swift']);
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
    const uiTestScript = join(root, 'scripts/add-uitest-target.rb');
    const project = join(root, 'ios/App/App.xcodeproj');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    for (const path of [
        'App/watch',
        'App/notify',
        'App/activity',
        'App/fold',
        'AppTests/Native',
        'AppUITests/Native',
    ]) {
        mkdirSync(join(root, 'ios/App', path), { recursive: true });
    }
    cpSync(source, script);
    cpSync(uiTestSource, uiTestScript);

    const create = spawnSync('/usr/bin/ruby', ['-rxcodeproj', '-e', `
project = Xcodeproj::Project.new(ARGV.fetch(0))
project.main_group.new_file('Version.xcconfig')
app = project.new_target(:application, 'App', :ios, '16.0')
tests = project.new_target(:unit_test_bundle, 'AppTests', :ios, '16.0')
ui_tests = project.new_target(:ui_test_bundle, 'AppUITests', :ios, '16.0')
tests.source_build_phase.add_file_reference(project.main_group.new_file('ExistingTests.swift'))
ui_tests.source_build_phase.add_file_reference(project.main_group.new_file('ExistingUITests.swift'))
tests.add_dependency(app)
ui_tests.add_dependency(app)
project.save
`, project], { encoding: 'utf8' });
    expect(create.status, create.stderr).toBe(0);
    writeFileSync(join(root, 'ios/App/Version.xcconfig'), [
        'MARKETING_VERSION = 1.0.0',
        'CURRENT_PROJECT_VERSION = 1',
        '',
    ].join('\n'));
    const uiTests = join(root, 'ios/App/AppUITests');
    mkdirSync(uiTests, { recursive: true });
    writeFileSync(join(uiTests, 'ExistingUITests.swift'), 'import XCTest\n');
    return { root, script, uiTestScript, project };
}

function runUiTestScript(fixture) {
    return spawnSync('/usr/bin/ruby', [fixture.uiTestScript], {
        cwd: fixture.root,
        encoding: 'utf8',
    });
}

function buildWidgetInfo(fixture) {
    const build = join(fixture.root, 'build');
    const obj = join(fixture.root, 'obj');
    const cache = join(fixture.root, 'cache');
    for (const path of [build, obj, cache]) mkdirSync(path, { recursive: true });
    const result = spawnSync('/usr/bin/xcodebuild', [
        'build', '-project', fixture.project, '-target', 'WatchWidgets',
        '-configuration', 'Debug', '-sdk', 'watchsimulator',
        `SYMROOT=${build}`, `OBJROOT=${obj}`,
        `CLANG_MODULE_CACHE_PATH=${cache}`, `MODULE_CACHE_DIR=${cache}`,
        `SHARED_PRECOMPS_DIR=${cache}`, `SDK_STAT_CACHE_DIR=${cache}`,
        'CODE_SIGNING_ALLOWED=NO',
    ], { encoding: 'utf8', env: { ...process.env, CCHROOT: cache } });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const plist = join(build, 'Debug-watchsimulator/WatchWidgets.appex/Info.plist');
    const point = spawnSync('/usr/libexec/PlistBuddy', [
        '-c', 'Print :NSExtension:NSExtensionPointIdentifier', plist,
    ], { encoding: 'utf8' });
    expect(point.status, point.stderr).toBe(0);
    return point.stdout.trim();
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
    groups: target.file_system_synchronized_groups.map(&:path).sort,
    copyPhases: target.copy_files_build_phases.map do |phase|
      {
        name: phase.name,
        destination: phase.dst_subfolder_spec,
        path: phase.dst_path,
        products: phase.files_references.map(&:path).sort,
      }
    end,
    scripts: target.shell_script_build_phases.map do |phase|
      { name: phase.name, outputs: phase.output_paths, script: phase.shell_script }
    end,
    sources: target.source_build_phase.files_references.map(&:path).sort,
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
