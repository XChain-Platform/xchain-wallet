// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import assert from 'node:assert/strict';
import test from 'node:test';

import { runWatchChecks } from './verify-ios-artifact.mjs';

const PHONE_ID = 'io.xchain.wallet.ios';
const MARKETING = '0.336.0';
const BUILD = '3360050';

const phoneInfo = (over = {}) => ({
    CFBundleIdentifier: PHONE_ID,
    CFBundleShortVersionString: MARKETING,
    CFBundleVersion: BUILD,
    ...over,
});

const watchInfo = (kind = 'app', over = {}) => ({
    CFBundleIdentifier: kind === 'app'
        ? 'io.xchain.wallet.ios.watch'
        : 'io.xchain.wallet.ios.watch.widgets',
    CFBundleShortVersionString: MARKETING,
    CFBundleVersion: BUILD,
    ...(kind === 'app' ? { WKCompanionAppBundleIdentifier: PHONE_ID } : {}),
    ...over,
});

const watchEntitlements = (over = {}) => ({
    'application-identifier': `TEAM123456.${PHONE_ID}.watch`,
    'com.apple.developer.team-identifier': 'TEAM123456',
    'com.apple.security.application-groups': ['group.io.xchain.wallet.ios.watch'],
    'get-task-allow': false,
    ...over,
});

const run = (over = {}) => {
    const kind = over.kind ?? 'app';
    return runWatchChecks({
        phoneInfo: phoneInfo(),
        info: watchInfo(kind),
        entitlements: watchEntitlements(),
        kind,
        stage: 'export',
        ...over,
    });
};

const failureText = (over) => run(over).failures.join('\n');

test('accepts correct watch app and widget bundles at both stages', () => {
    for (const kind of ['app', 'widgets']) {
        for (const stage of ['archive', 'export']) {
            const result = run({ kind, stage, info: watchInfo(kind) });
            assert.deepEqual(result.failures, [], `${kind} ${stage}: ${result.failures.join('\n')}`);
            assert.ok(result.passes.length >= 6);
        }
    }
});

test('rejects invalid kinds and stages', () => {
    assert.throws(() => run({ kind: 'complication', info: watchInfo() }),
        /kind must be 'app' or 'widgets'/);
    assert.throws(() => run({ stage: 'upload' }), /stage must be 'archive' or 'export'/);
});

test('holds each kind to its exact bundle id', () => {
    assert.match(failureText({ info: watchInfo('app', { CFBundleIdentifier: `${PHONE_ID}.other` }) }),
        /watch app bundle id .* not io\.xchain\.wallet\.ios\.watch/);
    assert.match(failureText({ kind: 'widgets', info: watchInfo('widgets', {
        CFBundleIdentifier: `${PHONE_ID}.watch`,
    }) }), /watch widgets bundle id .* not io\.xchain\.wallet\.ios\.watch\.widgets/);
});

test('requires both watch bundle ids to extend the containing phone id', () => {
    for (const kind of ['app', 'widgets']) {
        const result = run({
            kind,
            phoneInfo: phoneInfo({ CFBundleIdentifier: 'io.xchain.other' }),
            info: watchInfo(kind, kind === 'app' ? { WKCompanionAppBundleIdentifier: 'io.xchain.other' } : {}),
        });
        assert.match(result.failures.join('\n'), /does not start with "io\.xchain\.other" and a dot/);
    }
});

test('requires the phone and watch version pair to match', () => {
    assert.match(failureText({ info: watchInfo('app', { CFBundleShortVersionString: '0.335.0' }) }),
        /CFBundleShortVersionString is "0\.335\.0", not the phone app's "0\.336\.0"/);
    assert.match(failureText({ info: watchInfo('app', { CFBundleVersion: '3360049' }) }),
        /CFBundleVersion is "3360049", not the phone app's "3360050"/);
});

test('requires only the watch app to name its companion phone app', () => {
    assert.match(failureText({ info: watchInfo('app', { WKCompanionAppBundleIdentifier: 'io.xchain.other' }) }),
        /WKCompanionAppBundleIdentifier is "io\.xchain\.other"/);
    const widgets = run({
        kind: 'widgets',
        info: watchInfo('widgets', { WKCompanionAppBundleIdentifier: 'io.xchain.other' }),
    });
    assert.deepEqual(widgets.failures, []);
});

test('requires entitlements on every signed bundle', () => {
    for (const stage of ['archive', 'export']) {
        assert.match(failureText({ stage, entitlements: undefined }), /carries no entitlements at all/);
    }
    assert.match(failureText({ entitlements: undefined, unsigned: true }), /carries no entitlements at all/);
});

test('reports entitlement checks skipped only for an unsigned archive', () => {
    const result = run({ stage: 'archive', entitlements: undefined, unsigned: true });
    assert.deepEqual(result.failures, []);
    assert.ok(result.passes.includes(
        'SKIPPED: entitlement checks, because the caller declared an unsigned lane build'));
});

test('requires exactly the one watch application group', () => {
    for (const value of [
        undefined,
        'group.io.xchain.wallet.ios.watch',
        [],
        ['group.io.xchain.wallet.ios.watch', 'group.io.xchain.wallet.other'],
        ['group.io.xchain.wallet.other'],
    ]) {
        assert.match(failureText({ entitlements: watchEntitlements({
            'com.apple.security.application-groups': value,
        }) }), /application groups are .* not \[group\.io\.xchain\.wallet\.ios\.watch\]/);
    }
});

test('rejects every non-signing-added developer entitlement', () => {
    for (const key of [
        'com.apple.developer.associated-domains',
        'com.apple.developer.healthkit',
        'com.apple.developer.icloud-services',
    ]) {
        assert.ok(failureText({ entitlements: watchEntitlements({ [key]: true }) })
            .includes(`unexpected capabilities: [${key}]`));
    }
    assert.deepEqual(run({ entitlements: watchEntitlements({
        'com.apple.developer.team-identifier': 'OTHERTEAM1',
    }) }).failures, []);
});

test('rejects get-task-allow only when the bundle is exported', () => {
    const entitlements = watchEntitlements({ 'get-task-allow': true });
    assert.match(failureText({ entitlements }), /exported watch app is signed with get-task-allow/);
    assert.deepEqual(run({ stage: 'archive', entitlements }).failures, []);
});

test('returns failures in the runChecks diagnostic shape', () => {
    const result = run({ info: watchInfo('app', { CFBundleVersion: '1' }) });
    assert.ok(result.failures.length > 0);
    assert.ok(result.failures.every((line) => /^.+\n    .+/.test(line)));
    assert.ok(result.passes.every((line) => !line.includes('\n')));
});
