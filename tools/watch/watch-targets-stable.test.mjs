// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    pbxprojFacts,
    pbxprojTargetLinks,
    watchTargetsStableFailures,
} from './pbxproj-facts.mjs';

const watchTargets = ['WatchApp', 'WatchAppTests', 'WatchWidgets'];
const stableProject = `{
    objectVersion = 77;
    preferredProjectObjectVersion = 77;
    objects = {
        WATCH_GROUP = { isa = PBXFileSystemSynchronizedRootGroup; path = WatchApp; };
        TESTS_GROUP = { isa = PBXFileSystemSynchronizedRootGroup; path = WatchAppTests; };
        SHARED_GROUP = { isa = PBXFileSystemSynchronizedRootGroup; path = WatchShared; };
        WIDGET_GROUP = { isa = PBXFileSystemSynchronizedRootGroup; path = WatchWidgets; };
        WATCH_PRODUCT = { isa = PBXFileReference; path = WatchApp.app; };
        WIDGET_PRODUCT = { isa = PBXFileReference; path = WatchWidgets.appex; };
        WATCH_BUILD_FILE = { isa = PBXBuildFile; fileRef = WATCH_PRODUCT; };
        WIDGET_BUILD_FILE = { isa = PBXBuildFile; fileRef = WIDGET_PRODUCT; };
        EMBED_WATCH = {
            isa = PBXCopyFilesBuildPhase;
            name = "Embed Watch Content";
            dstSubfolderSpec = 16;
            dstPath = "$(CONTENTS_FOLDER_PATH)/Watch";
            files = (WATCH_BUILD_FILE,);
        };
        EMBED_WIDGETS = {
            isa = PBXCopyFilesBuildPhase;
            name = "Embed App Extensions";
            dstSubfolderSpec = 13;
            files = (WIDGET_BUILD_FILE,);
        };
        APP_TARGET = {
            isa = PBXNativeTarget;
            name = App;
            buildPhases = (EMBED_WATCH,);
        };
        WATCH_TARGET = {
            isa = PBXNativeTarget;
            name = WatchApp;
            fileSystemSynchronizedGroups = (WATCH_GROUP, SHARED_GROUP,);
            buildPhases = (EMBED_WIDGETS,);
        };
        TESTS_TARGET = {
            isa = PBXNativeTarget;
            name = WatchAppTests;
            fileSystemSynchronizedGroups = (TESTS_GROUP, SHARED_GROUP,);
        };
        WIDGET_TARGET = {
            isa = PBXNativeTarget;
            name = WatchWidgets;
            fileSystemSynchronizedGroups = (WIDGET_GROUP, SHARED_GROUP,);
        };
    };
}`;

function withoutObjects(text, objectNames) {
    return objectNames.reduce((result, name) => result.replace(
        new RegExp(
            `^        ${name} = \\{(?:[^\\n]*\\};|[\\s\\S]*?^        \\};)\\n`,
            'm',
        ),
        '',
    ), text);
}

test('accepts a byte-stable project with all required watch structure', () => {
    assert.deepEqual(
        watchTargetsStableFailures(stableProject, stableProject, { watchTargets }),
        [],
    );
});

test('reports byte and object version instability first', () => {
    assert.deepEqual(
        watchTargetsStableFailures(stableProject, `${stableProject}\n`, { watchTargets }),
        ['bytes'],
    );
    assert.deepEqual(
        watchTargetsStableFailures(
            stableProject,
            stableProject.replace('objectVersion = 77', 'objectVersion = 60'),
            { watchTargets },
        ),
        ['bytes', 'objectVersion'],
    );
});

test('reports a missing widget target and its embed phase', () => {
    const withoutWidgets = withoutObjects(stableProject, ['EMBED_WIDGETS', 'WIDGET_TARGET']);
    assert.deepEqual(
        watchTargetsStableFailures(stableProject, withoutWidgets, { watchTargets }),
        ['bytes', 'target:WatchWidgets', 'widgets-embed'],
    );
});

test('reports removed synchronized groups in sorted path order', () => {
    const withoutShared = withoutObjects(stableProject, ['SHARED_GROUP']);
    assert.deepEqual(
        watchTargetsStableFailures(stableProject, withoutShared, { watchTargets }),
        ['bytes', 'group:WatchShared'],
    );
});

test('requires at least one synchronized group in the second project', () => {
    const groupNames = ['WATCH_GROUP', 'TESTS_GROUP', 'SHARED_GROUP', 'WIDGET_GROUP'];
    const withoutGroups = withoutObjects(stableProject, groupNames);
    assert.deepEqual(
        watchTargetsStableFailures(withoutGroups, withoutGroups, { watchTargets }),
        ['groups'],
    );
    assert.deepEqual(
        watchTargetsStableFailures(withoutGroups, `${withoutGroups}\n`, { watchTargets }),
        ['bytes', 'groups'],
    );
});

test('requires the App watch embed destination', () => {
    const wrongDestination = stableProject.replace(
        'dstSubfolderSpec = 16;',
        'dstSubfolderSpec = 13;',
    );
    assert.deepEqual(
        watchTargetsStableFailures(stableProject, wrongDestination, { watchTargets }),
        ['bytes', 'embed'],
    );
});

test('returns every failure in contract order', () => {
    const secondText = withoutObjects(
        stableProject.replace('objectVersion = 77', 'objectVersion = 60'),
        [
            'WATCH_GROUP',
            'TESTS_GROUP',
            'SHARED_GROUP',
            'WIDGET_GROUP',
            'EMBED_WATCH',
            'WATCH_TARGET',
            'TESTS_TARGET',
            'WIDGET_TARGET',
        ],
    );
    assert.deepEqual(
        watchTargetsStableFailures(stableProject, secondText, {
            watchTargets: ['WatchWidgets', 'WatchAppTests', 'WatchApp'],
        }),
        [
            'bytes',
            'objectVersion',
            'target:WatchWidgets',
            'target:WatchAppTests',
            'target:WatchApp',
            'group:WatchApp',
            'group:WatchAppTests',
            'group:WatchShared',
            'group:WatchWidgets',
            'groups',
            'embed',
            'widgets-embed',
        ],
    );
});

test('validates the required watch target names', () => {
    assert.throws(
        () => watchTargetsStableFailures(stableProject, stableProject),
        TypeError,
    );
    assert.throws(
        () => watchTargetsStableFailures(stableProject, stableProject, { watchTargets: [] }),
        TypeError,
    );
    assert.throws(
        () => watchTargetsStableFailures(stableProject, stableProject, { watchTargets: [''] }),
        TypeError,
    );
});

test('preserves parser syntax errors for either project text', () => {
    assert.throws(
        () => watchTargetsStableFailures('{', stableProject, { watchTargets }),
        SyntaxError,
    );
    assert.throws(
        () => watchTargetsStableFailures(stableProject, '{', { watchTargets }),
        SyntaxError,
    );
});

test('leaves existing helper result key sets unchanged', () => {
    assert.deepEqual(Object.keys(pbxprojFacts(stableProject)), [
        'objectVersion',
        'preferredProjectObjectVersion',
        'targets',
        'synchronizedGroups',
        'copyPhases',
    ]);
    for (const target of pbxprojTargetLinks(stableProject)) {
        assert.deepEqual(Object.keys(target), [
            'name',
            'synchronizedGroups',
            'dependencies',
            'copyPhases',
        ]);
    }
});
