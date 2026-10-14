// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const SOURCE = resolve(process.cwd(), 'packages/mobile/scripts/add-uitest-target.rb');
const source = readFileSync(SOURCE, 'utf8');
const fixtures = [];

afterEach(() => {
    for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

// The script needs the macOS system ruby; Linux CI venues have none.
const describeWithRuby = existsSync('/usr/bin/ruby') ? describe : describe.skip;

describeWithRuby('add-uitest-target.rb', () => {
    it('creates the UI-test target, sorted sources, dependency, and both schemes', () => {
        const fixture = makeFixture({ existingTarget: false, appScheme: false });
        const result = run(fixture);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('created AppUITests');
        expect(result.stdout).toContain('source Alpha.swift');
        expect(result.stdout).toContain('source Zeta.swift');
        expect(result.stdout.indexOf('Alpha.swift')).toBeLessThan(result.stdout.indexOf('Zeta.swift'));
        expect(result.stdout).toContain('wrote shared scheme AppUITests');
        expect(result.stdout).toContain('wrote shared scheme App');
        const calls = readFileSync(fixture.log, 'utf8');
        expect(calls).toContain('new_target=AppUITests');
        expect(calls).toContain('dependency=App');
        expect(calls).toContain('settings=io.xchain.wallet.ios.uitests|1,2');
    });

    it('refreshes an existing target without replacing an existing App scheme', () => {
        const fixture = makeFixture({ existingTarget: true, appScheme: true });
        const result = run(fixture);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('AppUITests already present, refreshing sources');
        expect(result.stdout).not.toContain('created AppUITests');
        expect(result.stdout).not.toContain('wrote shared scheme App (restores');
        const calls = readFileSync(fixture.log, 'utf8');
        expect(calls).toContain('remove=Old.swift');
        expect(calls).not.toContain('new_target=AppUITests');
    });

    it('fails clearly when the generated project has no App target', () => {
        const fixture = makeFixture({ existingTarget: false, appScheme: false });
        const result = run(fixture, { FAKE_NO_APP: '1' });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('add-uitest-target: no App target');
    });
});

function makeFixture({ existingTarget, appScheme }) {
    const root = mkdtempSync(join(tmpdir(), 'xchain-add-uitest-'));
    fixtures.push(root);
    const script = join(root, 'packages/mobile/scripts/add-uitest-target.rb');
    const project = join(root, 'packages/mobile/ios/App/App.xcodeproj');
    const sources = join(root, 'packages/mobile/ios/App/AppUITests');
    const lib = join(root, 'ruby');
    const log = join(root, 'calls.log');

    put(script, source);
    mkdirSync(project, { recursive: true });
    put(join(sources, 'Zeta.swift'), 'final class Zeta {}\n');
    put(join(sources, 'Alpha.swift'), 'final class Alpha {}\n');
    if (appScheme) put(join(project, 'xcshareddata/xcschemes/App.xcscheme'), '<Scheme />\n');
    put(log, '');
    put(join(lib, 'xcodeproj.rb'), rubyStub);

    return { root, script, lib, log, existingTarget };
}

function run(fixture, overrides = {}) {
    return spawnSync('/usr/bin/ruby', [fixture.script], {
        cwd: fixture.root,
        encoding: 'utf8',
        env: {
            ...process.env,
            FAKE_EXISTING: fixture.existingTarget ? '1' : '0',
            FAKE_LOG: fixture.log,
            RUBYLIB: fixture.lib,
            ...overrides,
        },
    });
}

function put(path, contents) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
}

const rubyStub = `
module Xcodeproj
  def self.log(message)
    File.open(ENV.fetch('FAKE_LOG'), 'a') { |file| file.puts(message) }
  end

  Dependency = Struct.new(:target)
  BuildFile = Struct.new(:file_ref)

  class Phase
    attr_reader :files
    def initialize
      @files = [BuildFile.new('Old.swift')]
    end
    def remove_file_reference(reference)
      Xcodeproj.log("remove=#{reference}")
      @files.reject! { |file| file.file_ref == reference }
    end
    def add_file_reference(reference)
      Xcodeproj.log("add_source=#{reference}")
      @files << BuildFile.new(reference)
    end
  end

  class Configuration
    attr_reader :build_settings
    def initialize
      @build_settings = {}
    end
  end

  class Target
    attr_reader :name, :source_build_phase, :build_configurations, :dependencies
    def initialize(name)
      @name = name
      @source_build_phase = Phase.new
      @build_configurations = [Configuration.new]
      @dependencies = []
    end
    def add_dependency(target)
      @dependencies << Dependency.new(target)
      Xcodeproj.log("dependency=#{target.name}")
    end
  end

  class Group
    def find_subpath(_name, _create)
      self
    end
    def set_source_tree(value)
      Xcodeproj.log("source_tree=#{value}")
    end
    def set_path(value)
      Xcodeproj.log("group_path=#{value}")
    end
    def new_reference(value)
      value
    end
  end

  class FakeProject
    attr_reader :targets, :main_group
    def initialize
      @targets = []
      @targets << Target.new('App') unless ENV['FAKE_NO_APP'] == '1'
      @targets << Target.new('AppUITests') if ENV['FAKE_EXISTING'] == '1'
      @main_group = Group.new
    end
    def new_target(_kind, name, _platform, _version)
      target = Target.new(name)
      @targets << target
      Xcodeproj.log("new_target=#{name}")
      target
    end
    def save
      target = @targets.find { |item| item.name == 'AppUITests' }
      settings = target.build_configurations.first.build_settings
      Xcodeproj.log("settings=#{settings['PRODUCT_BUNDLE_IDENTIFIER']}|#{settings['TARGETED_DEVICE_FAMILY']}")
    end
  end

  class Project
    def self.open(_path)
      FakeProject.new
    end
  end

  class XCScheme
    def add_build_target(target)
      Xcodeproj.log("build_target=#{target.name}")
    end
    def add_test_target(target)
      Xcodeproj.log("test_target=#{target.name}")
    end
    def set_launch_target(target)
      Xcodeproj.log("launch_target=#{target.name}")
    end
    def save_as(_path, name, shared)
      Xcodeproj.log("scheme=#{name}|#{shared}")
    end
  end
end
`;
