# Copyright © 2025–2026 Dankest, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Add the AppUITests target to the generated iOS project .
#
# WHY THIS IS A SCRIPT AND NOT A COMMITTED PBXPROJ EDIT. The `ios/` project
# was generated from the Capacitor template (S1) and is regenerated whenever
# the shell is re-scaffolded. A hand-edited pbxproj survives exactly until
# someone runs `cap add ios` again, and then the screenshot harness silently
# stops existing. This script is idempotent, so it is safe to re-run after any
# regeneration and cheap to run in CI as a check.
#
# Requires the xcodeproj gem:  gem install --user-install xcodeproj
#
# Usage: ruby packages/mobile/scripts/add-uitest-target.rb

require 'xcodeproj'

project_path = File.join(File.expand_path('..', __dir__), 'ios', 'App', 'App.xcodeproj')

abort("add-uitest-target: no project at #{project_path}") unless Dir.exist?(project_path)

project = Xcodeproj::Project.open(project_path)
app_target = project.targets.find { |t| t.name == 'App' }
abort('add-uitest-target: no App target') unless app_target

TARGET_NAME = 'AppUITests'.freeze

existing = project.targets.find { |t| t.name == TARGET_NAME }
if existing
  puts "add-uitest-target: #{TARGET_NAME} already present, refreshing sources"
  existing.source_build_phase.files.to_a.each { |f| existing.source_build_phase.remove_file_reference(f.file_ref) }
else
  existing = project.new_target(:ui_test_bundle, TARGET_NAME, :ios, '16.0')
  puts "add-uitest-target: created #{TARGET_NAME}"
end

# The harness drives the real app through its real onboarding. It does NOT
# get a launch argument that seeds state, and the app has no branch keyed on
# one:  §2.1 forbids any build that behaves differently when it thinks
# it is being tested, and a screenshot harness is not an exception to that.
existing.build_configurations.each do |config|
  config.build_settings.merge!(
    # Without PRODUCT_NAME the bundle builds as "-Runner.app/PlugIns/.xctest"
    # and collides with itself: "Multiple commands produce". The error names
    # the path, not the missing setting, so it reads like a duplicate target.
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'TEST_TARGET_NAME' => 'App',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'io.xchain.wallet.ios.uitests',
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'IPHONEOS_DEPLOYMENT_TARGET' => '16.0',
    'TARGETED_DEVICE_FAMILY' => '1,2',
  )
  # Deliberately NOT setting CODE_SIGNING_ALLOWED=NO here, and do not pass it
  # on the xcodebuild command line either. It applies to every target
  # including App, which strips the app's entitlements, and the wallet then
  # cannot reach the Keychain: the run comes up on "Your device needs to be
  # unlocked" with OSStatus -34018 (errSecMissingEntitlement) and every
  # screenshot is of an error screen. Simulator builds are ad-hoc signed
  # ("Sign to Run Locally") for free, which is all this needs.
end

group = project.main_group.find_subpath(TARGET_NAME, true)
group.set_source_tree('SOURCE_ROOT')
group.set_path(TARGET_NAME)

sources_dir = File.join(File.dirname(project_path), TARGET_NAME)
Dir.glob(File.join(sources_dir, '*.swift')).sort.each do |file|
  ref = group.new_reference(File.basename(file))
  existing.source_build_phase.add_file_reference(ref)
  puts "add-uitest-target: source #{File.basename(file)}"
end

existing.add_dependency(app_target) unless existing.dependencies.any? { |d| d.target == app_target }

project.save

# A SHARED scheme, because `xcodebuild test -scheme` cannot see a scheme that
# lives in someone's xcuserdata. Without this the harness runs on the machine
# that created the project and nowhere else.
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app_target)
scheme.add_test_target(existing)
scheme.set_launch_target(app_target)
scheme.save_as(project_path, TARGET_NAME, true)
puts "add-uitest-target: wrote shared scheme #{TARGET_NAME}"

# AND an explicit shared `App` scheme, which is not optional and not tidiness.
#
# Xcode auto-generates implicit schemes for a project that has NO shared ones.
# The moment the scheme above is written, that auto-generation stops, and
# `xcodebuild -scheme App` starts failing with "does not contain a scheme named
# App" - which breaks the release lane ( §5) as a side effect of adding
# a screenshot harness. Writing App explicitly restores it and pins it.
app_scheme_path = File.join(project_path, 'xcshareddata', 'xcschemes', 'App.xcscheme')
unless File.exist?(app_scheme_path)
  app_scheme = Xcodeproj::XCScheme.new
  app_scheme.add_build_target(app_target)
  app_scheme.set_launch_target(app_target)
  app_scheme.save_as(project_path, 'App', true)
  puts 'add-uitest-target: wrote shared scheme App (restores xcodebuild -scheme App)'
end
