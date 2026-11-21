# Copyright © 2025-2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

require 'xcodeproj'

MINIMUM_XCODEPROJ_VERSION = Gem::Version.new('1.28.0')
installed_version = Gem::Version.new(Xcodeproj::VERSION)
if installed_version < MINIMUM_XCODEPROJ_VERSION
  abort("add-watch-targets: xcodeproj >= 1.28 required (found #{installed_version})")
end

project_path = File.join(File.expand_path('..', __dir__), 'ios', 'App', 'App.xcodeproj')
abort("add-watch-targets: no project at #{project_path}") unless Dir.exist?(project_path)

project = Xcodeproj::Project.open(project_path)
version_config = project.files.find { |file| file.path == 'Version.xcconfig' }
abort('add-watch-targets: no Version.xcconfig reference') unless version_config

def target_named(project, name, type)
  project.targets.find { |target| target.name == name } ||
    project.new_target(type, name, :watchos, '10.0')
end

def apply_settings(target, settings, version_config)
  target.build_configurations.each do |configuration|
    configuration.base_configuration_reference = version_config
    configuration.build_settings.merge!(settings)
  end
end

def add_synchronized_group(project, target, path)
  group_class = Xcodeproj::Project::Object::PBXFileSystemSynchronizedRootGroup
  group = project.objects.find { |object| object.is_a?(group_class) && object.path == path }
  unless group
    group = project.new(group_class)
    group.path = path
    group.source_tree = '<group>'
  end
  target.file_system_synchronized_groups << group unless target.file_system_synchronized_groups.include?(group)
end

watch_app = target_named(project, 'WatchApp', :application)
apply_settings(watch_app, {
  'GENERATE_INFOPLIST_FILE' => 'YES',
  'INFOPLIST_KEY_CFBundleDisplayName' => 'XChain',
  'INFOPLIST_KEY_WKApplication' => 'YES',
  'INFOPLIST_KEY_WKCompanionAppBundleIdentifier' => 'io.xchain.wallet.ios',
  'INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp' => 'NO',
  'INFOPLIST_KEY_WKWatchOnly' => 'NO',
  'PRODUCT_BUNDLE_IDENTIFIER' => 'io.xchain.wallet.ios.watch',
  'PRODUCT_NAME' => '$(TARGET_NAME)',
  'SDKROOT' => 'watchos',
  'SWIFT_VERSION' => '5.0',
  'TARGETED_DEVICE_FAMILY' => '4',
  'WATCHOS_DEPLOYMENT_TARGET' => '10.0',
}, version_config)
add_synchronized_group(project, watch_app, 'WatchApp')

watch_tests = target_named(project, 'WatchAppTests', :unit_test_bundle)
apply_settings(watch_tests, {
  'BUNDLE_LOADER' => '$(TEST_HOST)',
  'GENERATE_INFOPLIST_FILE' => 'YES',
  'PRODUCT_BUNDLE_IDENTIFIER' => 'io.xchain.wallet.ios.watch.tests',
  'PRODUCT_NAME' => '$(TARGET_NAME)',
  'SDKROOT' => 'watchos',
  'SWIFT_VERSION' => '5.0',
  'TARGETED_DEVICE_FAMILY' => '4',
  'TEST_HOST' => '$(BUILT_PRODUCTS_DIR)/WatchApp.app/WatchApp',
  'WATCHOS_DEPLOYMENT_TARGET' => '10.0',
}, version_config)
add_synchronized_group(project, watch_tests, 'WatchAppTests')
watch_tests.add_dependency(watch_app) unless watch_tests.dependencies.any? { |dependency| dependency.target == watch_app }

project.instance_variable_set(:@object_version, '77')
project.root_object.preferred_project_object_version = '77'
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(watch_app)
scheme.add_test_target(watch_tests)
scheme.set_launch_target(watch_app)
scheme.save_as(project_path, 'WatchApp', true)
puts 'add-watch-targets: WatchApp and WatchAppTests ready'
