// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { pbxprojFacts, pbxprojTargetLinks } from './pbxproj-facts.mjs';

const projectText = `
    {
        objectVersion = 77;
        preferredProjectObjectVersion = 77;
        objects = {
            APP_GROUP_NOTIFY = {
                isa = PBXFileSystemSynchronizedRootGroup;
                path = App/notify;
            };
            APP_GROUP_WATCH = {
                isa = PBXFileSystemSynchronizedRootGroup;
                path = App/watch;
            };
            WATCH_GROUP = {
                isa = PBXFileSystemSynchronizedRootGroup;
                path = WatchApp;
            };
            SHARED_GROUP = {
                isa = PBXFileSystemSynchronizedRootGroup;
                path = WatchShared;
            };
            WIDGET_GROUP = {
                isa = PBXFileSystemSynchronizedRootGroup;
                path = WatchWidgets;
            };
            WATCH_PRODUCT = {
                isa = PBXFileReference;
                path = WatchApp.app;
            };
            NOTICE_FILE = {
                isa = PBXFileReference;
                path = Notice.txt;
            };
            WATCH_BUILD_FILE = {
                isa = PBXBuildFile;
                fileRef = WATCH_PRODUCT;
            };
            NOTICE_BUILD_FILE = {
                isa = PBXBuildFile;
                fileRef = NOTICE_FILE;
            };
            COPY_NOTICE = {
                isa = PBXCopyFilesBuildPhase;
                name = "Copy Notice";
                dstSubfolderSpec = 7;
                dstPath = Resources;
                files = (NOTICE_BUILD_FILE,);
            };
            EMBED_WATCH = {
                isa = PBXCopyFilesBuildPhase;
                name = "Embed Watch Content";
                dstSubfolderSpec = 16;
                dstPath = "$(CONTENTS_FOLDER_PATH)/Watch";
                files = (WATCH_BUILD_FILE,);
            };
            SOURCES = {
                isa = PBXSourcesBuildPhase;
            };
            WATCH_DEPENDENCY = {
                isa = PBXTargetDependency;
                name = "Stale Watch Name";
                target = WATCH_TARGET;
            };
            FALLBACK_DEPENDENCY = {
                isa = PBXTargetDependency;
                name = "Legacy Helper";
            };
            UNRESOLVED_DEPENDENCY = {
                isa = PBXTargetDependency;
                name = "Unresolved Helper";
                target = MISSING_TARGET;
            };
            APP_TARGET = {
                isa = PBXNativeTarget;
                name = App;
                fileSystemSynchronizedGroups = (
                    APP_GROUP_WATCH,
                    APP_GROUP_NOTIFY,
                );
                dependencies = (
                    WATCH_DEPENDENCY,
                    FALLBACK_DEPENDENCY,
                    UNRESOLVED_DEPENDENCY,
                );
                buildPhases = (
                    SOURCES,
                    COPY_NOTICE,
                    EMBED_WATCH,
                );
            };
            WATCH_TARGET = {
                isa = PBXNativeTarget;
                name = WatchApp;
                fileSystemSynchronizedGroups = (
                    SHARED_GROUP,
                    WATCH_GROUP,
                );
            };
            WIDGET_TARGET = {
                isa = PBXNativeTarget;
                name = WatchWidgets;
                fileSystemSynchronizedGroups = (
                    WIDGET_GROUP,
                    SHARED_GROUP,
                );
            };
            EMPTY_TARGET = {
                isa = PBXNativeTarget;
                name = Empty;
            };
        };
    }
`;

test('reads target-owned groups, dependencies, and copy phases', () => {
    assert.deepEqual(pbxprojTargetLinks(projectText), [
        {
            name: 'App',
            synchronizedGroups: ['App/notify', 'App/watch'],
            dependencies: ['Legacy Helper', 'Unresolved Helper', 'WatchApp'],
            copyPhases: [
                {
                    name: 'Copy Notice',
                    dstSubfolderSpec: 7,
                    dstPath: 'Resources',
                    files: ['Notice.txt'],
                },
                {
                    name: 'Embed Watch Content',
                    dstSubfolderSpec: 16,
                    dstPath: '$(CONTENTS_FOLDER_PATH)/Watch',
                    files: ['WatchApp.app'],
                },
            ],
        },
        {
            name: 'Empty',
            synchronizedGroups: [],
            dependencies: [],
            copyPhases: [],
        },
        {
            name: 'WatchApp',
            synchronizedGroups: ['WatchApp', 'WatchShared'],
            dependencies: [],
            copyPhases: [],
        },
        {
            name: 'WatchWidgets',
            synchronizedGroups: ['WatchShared', 'WatchWidgets'],
            dependencies: [],
            copyPhases: [],
        },
    ]);
});

test('leaves pbxprojFacts return shape unchanged', () => {
    assert.deepEqual(Object.keys(pbxprojFacts(projectText)), [
        'objectVersion',
        'preferredProjectObjectVersion',
        'targets',
        'synchronizedGroups',
        'copyPhases',
    ]);
});

test('reads stable test-target dependencies from the current App Xcode project', async () => {
    const projectUrl = new URL(
        '../../packages/mobile/ios/App/App.xcodeproj/project.pbxproj',
        import.meta.url,
    );
    const links = pbxprojTargetLinks(await readFile(projectUrl, 'utf8'));

    for (const targetName of ['AppTests', 'AppUITests']) {
        const target = links.find(({ name }) => name === targetName);
        assert.ok(target, `${targetName} target must exist`);
        assert.ok(target.dependencies.includes('App'), `${targetName} must depend on App`);
    }
});
