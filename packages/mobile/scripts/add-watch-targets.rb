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

def dependency_named?(host, name)
  host.dependencies.any? do |dependency|
    dependency.name == name || dependency.target&.name == name || dependency.target_proxy&.remote_info == name
  end
end

def add_target_dependency(host, target)
  return unless host && target
  host.add_dependency(target) unless dependency_named?(host, target.name)
end

def embed_target(host, embedded, name, destination, path = '')
  return unless host && embedded
  phase = host.copy_files_build_phases.find { |candidate| candidate.name == name } ||
    host.new_copy_files_build_phase(name)
  phase.dst_subfolder_spec = destination
  phase.dst_path = path
  product = embedded.product_reference
  product_name = product&.path
  unless product_name.nil? || phase.files_references.any? { |reference| reference.path == product_name }
    build_file = phase.add_file_reference(product)
    build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  end
  add_target_dependency(host, embedded)
end

def add_widget_info(target)
  target.build_configurations.each do |configuration|
    configuration.build_settings.delete('INFOPLIST_KEY_CFBundleDisplayName')
    configuration.build_settings.delete('INFOPLIST_KEY_NSExtensionPointIdentifier')
  end
  phase = target.shell_script_build_phases.find { |candidate| candidate.name == 'Generate WatchWidgets Info' } ||
    target.new_shell_script_build_phase('Generate WatchWidgets Info')
  phase.output_paths = ['$(DERIVED_FILE_DIR)/WatchWidgets-Info.plist']
  phase.shell_script = <<~'SH'
    /usr/bin/plutil -create xml1 "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert CFBundleDisplayName -string XChain "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert CFBundleExecutable -string '$(EXECUTABLE_NAME)' "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert CFBundleIdentifier -string '$(PRODUCT_BUNDLE_IDENTIFIER)' "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert CFBundleInfoDictionaryVersion -string 6.0 "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert CFBundleName -string '$(PRODUCT_NAME)' "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert CFBundlePackageType -string '$(PRODUCT_BUNDLE_PACKAGE_TYPE)' "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert CFBundleShortVersionString -string '$(MARKETING_VERSION)' "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert CFBundleVersion -string '$(CURRENT_PROJECT_VERSION)' "$SCRIPT_OUTPUT_FILE_0"
    /usr/bin/plutil -insert NSExtension -xml '<dict><key>NSExtensionPointIdentifier</key><string>com.apple.widgetkit-extension</string></dict>' "$SCRIPT_OUTPUT_FILE_0"
  SH
end

watch_app = target_named(project, 'WatchApp', :application)
apply_settings(watch_app, {
  'GENERATE_INFOPLIST_FILE' => 'YES',
  'INFOPLIST_KEY_CFBundleDisplayName' => 'XChain',
  'INFOPLIST_KEY_WKApplication' => 'YES',
  'INFOPLIST_KEY_WKCompanionAppBundleIdentifier' => 'io.xchain.wallet.ios',
  'INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp' => 'NO',
  'INFOPLIST_KEY_WKWatchOnly' => 'NO',
  'CODE_SIGN_ENTITLEMENTS' => 'WatchApp/WatchApp.entitlements',
  'PRODUCT_BUNDLE_IDENTIFIER' => 'io.xchain.wallet.ios.watch',
  'PRODUCT_NAME' => '$(TARGET_NAME)',
  'SDKROOT' => 'watchos',
  'SWIFT_VERSION' => '5.0',
  'TARGETED_DEVICE_FAMILY' => '4',
  'WATCHOS_DEPLOYMENT_TARGET' => '10.0',
}, version_config)
add_synchronized_group(project, watch_app, 'WatchApp')
add_synchronized_group(project, watch_app, 'WatchShared')

watch_widgets = target_named(project, 'WatchWidgets', :app_extension)
apply_settings(watch_widgets, {
  'APPLICATION_EXTENSION_API_ONLY' => 'YES',
  'CODE_SIGN_ENTITLEMENTS' => 'WatchWidgets/WatchWidgets.entitlements',
  'GENERATE_INFOPLIST_FILE' => 'NO',
  'INFOPLIST_FILE' => '$(DERIVED_FILE_DIR)/WatchWidgets-Info.plist',
  'PRODUCT_BUNDLE_IDENTIFIER' => 'io.xchain.wallet.ios.watch.widgets',
  'PRODUCT_NAME' => '$(TARGET_NAME)',
  'SDKROOT' => 'watchos',
  'SKIP_INSTALL' => 'YES',
  'SWIFT_VERSION' => '5.0',
  'TARGETED_DEVICE_FAMILY' => '4',
  'WATCHOS_DEPLOYMENT_TARGET' => '10.0',
}, version_config)
add_synchronized_group(project, watch_widgets, 'WatchWidgets')
add_synchronized_group(project, watch_widgets, 'WatchShared')
add_widget_info(watch_widgets)
embed_target(watch_app, watch_widgets, 'Embed App Extensions', '13')

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
add_target_dependency(watch_tests, watch_app)

phone_app = project.targets.find { |target| target.name == 'App' }
abort('add-watch-targets: no App target') unless phone_app
%w[App/watch App/notify App/activity App/fold].each do |path|
  add_synchronized_group(project, phone_app, path)
end

phone_tests = project.targets.find { |target| target.name == 'AppTests' }
abort('add-watch-targets: no AppTests target') unless phone_tests
add_synchronized_group(project, phone_tests, 'AppTests/Native')

phone_ui_tests = project.targets.find { |target| target.name == 'AppUITests' }
abort('add-watch-targets: no AppUITests target') unless phone_ui_tests
add_synchronized_group(project, phone_ui_tests, 'AppUITests/Native')

embed_target(phone_app, watch_app, 'Embed Watch Content', '16', '$(CONTENTS_FOLDER_PATH)/Watch')

project.instance_variable_set(:@object_version, '77')
project.root_object.preferred_project_object_version = '77'
project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(watch_app)
scheme.add_test_target(watch_tests)
scheme.set_launch_target(watch_app)
scheme.save_as(project_path, 'WatchApp', true)
puts 'add-watch-targets: WatchApp, WatchWidgets, and WatchAppTests ready'
