// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { pbxprojFacts } from './pbxproj-facts.mjs';

test('reads facts from the current App Xcode project', async () => {
    const projectUrl = new URL(
        '../../packages/mobile/ios/App/App.xcodeproj/project.pbxproj',
        import.meta.url,
    );
    const facts = pbxprojFacts(await readFile(projectUrl, 'utf8'));

    assert.deepEqual(facts, {
        objectVersion: 77,
        preferredProjectObjectVersion: undefined,
        targets: [
            {
                name: 'App',
                productType: 'com.apple.product-type.application',
                bundleIds: ['io.xchain.wallet.ios'],
            },
            {
                name: 'AppTests',
                productType: 'com.apple.product-type.bundle.unit-test',
                bundleIds: ['io.xchain.wallet.ios.tests'],
            },
            {
                name: 'AppUITests',
                productType: 'com.apple.product-type.bundle.ui-testing',
                bundleIds: ['io.xchain.wallet.ios.uitests'],
            },
            {
                name: 'WatchApp',
                productType: 'com.apple.product-type.application',
                bundleIds: ['io.xchain.wallet.ios.watch'],
            },
            {
                name: 'WatchAppTests',
                productType: 'com.apple.product-type.bundle.unit-test',
                bundleIds: ['io.xchain.wallet.ios.watch.tests'],
            },
            {
                name: 'WatchWidgets',
                productType: 'com.apple.product-type.app-extension',
                bundleIds: ['io.xchain.wallet.ios.watch.widgets'],
            },
        ],
        synchronizedGroups: [
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
        ],
        copyPhases: [
            {
                name: 'Embed App Extensions',
                dstSubfolderSpec: 13,
                dstPath: '',
            },
            {
                name: 'Embed Watch Content',
                dstSubfolderSpec: 16,
                dstPath: '$(CONTENTS_FOLDER_PATH)/Watch',
            },
        ],
    });
});

test('reads synchronized groups and a watch copy phase', () => {
    const facts = pbxprojFacts(`
        {
            objectVersion = 77;
            preferredProjectObjectVersion = 77;
            objects = {
                GROUP_B = {
                    isa = PBXFileSystemSynchronizedRootGroup;
                    path = WatchTests;
                };
                GROUP_A = {
                    isa = PBXFileSystemSynchronizedRootGroup;
                    path = Watch;
                };
                COPY = {
                    isa = PBXCopyFilesBuildPhase;
                    name = "Embed Watch Content";
                    dstSubfolderSpec = 16;
                    dstPath = "$(CONTENTS_FOLDER_PATH)/Watch";
                };
            };
        }
    `);

    assert.deepEqual(facts, {
        objectVersion: 77,
        preferredProjectObjectVersion: 77,
        targets: [],
        synchronizedGroups: ['Watch', 'WatchTests'],
        copyPhases: [{
            name: 'Embed Watch Content',
            dstSubfolderSpec: 16,
            dstPath: '$(CONTENTS_FOLDER_PATH)/Watch',
        }],
    });
});

test('reports absent optional copy phase fields as undefined', () => {
    const facts = pbxprojFacts(`{
        objects = {
            COPY = { isa = PBXCopyFilesBuildPhase; };
            GROUP = { isa = PBXFileSystemSynchronizedRootGroup; };
        };
    }`);

    assert.deepEqual(facts.synchronizedGroups, [undefined]);
    assert.deepEqual(facts.copyPhases, [{
        name: undefined,
        dstSubfolderSpec: undefined,
        dstPath: undefined,
    }]);
});
