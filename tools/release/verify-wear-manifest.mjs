// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';

import { isInvokedDirectly } from './is-invoked-directly.mjs';

const USAGE = `Usage: node tools/release/verify-wear-manifest.mjs <merged-manifest.xml> [--version-code N]

Reads merged Wear Android manifest XML and verifies its watch feature, standalone
metadata, exact component exports and exact permission set without changing it.
With --version-code, also verifies the code derived from the release tag.
`;

export const EXPECTED_COMPONENTS = [
    { type: 'activity', name: 'com.google.android.gms.common.api.GoogleApiActivity', exported: false },
    { type: 'activity', name: 'io.xchain.wallet.android.wear.MainActivity', exported: true },
    { type: 'provider', name: 'androidx.startup.InitializationProvider', exported: false },
    { type: 'receiver', name: 'androidx.profileinstaller.ProfileInstallReceiver', exported: true },
    {
        type: 'service',
        name: 'io.xchain.wallet.android.wear.complication.WalletComplicationService',
        exported: true,
    },
    { type: 'service', name: 'io.xchain.wallet.android.wear.sync.WatchListenerService', exported: true },
    { type: 'service', name: 'io.xchain.wallet.android.wear.tile.BalanceTileService', exported: true },
];

export const EXPECTED_PERMISSIONS = [
    'io.xchain.wallet.android.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
];

function attribute(tag, name) {
    return new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 's').exec(tag)?.[2];
}

function tags(xml, names) {
    const pattern = new RegExp(`<\\s*(${names.join('|')})\\b[^>]*>`, 'gs');
    return [...xml.matchAll(pattern)];
}

export function listComponents(xml) {
    return tags(xml, ['activity-alias', 'activity', 'service', 'receiver', 'provider'])
        .map(([tag, type]) => {
            const exported = attribute(tag, 'android:exported');
            return {
                type,
                name: attribute(tag, 'android:name'),
                exported: exported === undefined ? 'absent' : exported === 'true',
            };
        });
}

export function listPermissions(xml) {
    return [...new Set(
        tags(xml, ['uses-permission'])
            .map(([tag]) => attribute(tag, 'android:name'))
            .filter((name) => name !== undefined),
    )].sort();
}

export function usesFeatures(xml) {
    return tags(xml, ['uses-feature']).map(([tag]) => ({
        name: attribute(tag, 'android:name'),
        required: attribute(tag, 'android:required') !== 'false',
    }));
}

export function metaData(xml) {
    return Object.fromEntries(tags(xml, ['meta-data']).map(([tag]) => [
        attribute(tag, 'android:name'),
        attribute(tag, 'android:value'),
    ]));
}

export function checkWearManifest(xml, { components, permissions, versionCode }) {
    const failures = [];
    const passes = [];
    const actualComponents = listComponents(xml);
    const actualPermissions = new Set(listPermissions(xml));
    const expectedPermissions = new Set(permissions);
    const watchFeature = usesFeatures(xml)
        .find(({ name }) => name === 'android.hardware.type.watch');
    const standalone = metaData(xml)['com.google.android.wearable.standalone'];

    if (versionCode !== undefined) {
        const manifestTag = tags(xml, ['manifest'])[0]?.[0];
        const actualVersionCode = manifestTag && attribute(manifestTag, 'android:versionCode');
        if (actualVersionCode !== versionCode) {
            failures.push(
                `the Wear bundle's versionCode is ${actualVersionCode}, not the ${versionCode} the tag derives`,
            );
        } else {
            passes.push(`versionCode is ${versionCode}, which is what the tag derives`);
        }
    }

    if (!watchFeature) {
        failures.push('feature android.hardware.type.watch is missing');
    } else if (!watchFeature.required) {
        failures.push('feature android.hardware.type.watch has android:required="false"');
    } else {
        passes.push('feature android.hardware.type.watch is required');
    }

    if (standalone !== 'false') {
        failures.push(
            `metadata com.google.android.wearable.standalone is ${JSON.stringify(standalone)}, not "false"`,
        );
    } else {
        passes.push('metadata com.google.android.wearable.standalone is "false"');
    }

    for (const component of actualComponents) {
        if (component.exported === 'absent') {
            failures.push(
                `component ${component.type} ${JSON.stringify(component.name)} has no android:exported value`,
            );
        }
    }

    for (const expected of components) {
        const actual = actualComponents.find(({ type, name }) => (
            type === expected.type && name === expected.name
        ));
        const label = `${expected.type} ${JSON.stringify(expected.name)}`;
        if (!actual) {
            failures.push(`expected component ${label} is missing`);
        } else if (actual.exported !== expected.exported) {
            failures.push(
                `component ${label} has android:exported=${JSON.stringify(actual.exported)}, `
                + `expected ${JSON.stringify(expected.exported)}`,
            );
        } else {
            passes.push(`component ${label} has android:exported=${JSON.stringify(expected.exported)}`);
        }
    }

    for (const actual of actualComponents) {
        if (!components.some(({ type, name }) => type === actual.type && name === actual.name)) {
            failures.push(`component ${actual.type} ${JSON.stringify(actual.name)} is not expected`);
        }
    }

    for (const permission of expectedPermissions) {
        if (actualPermissions.has(permission)) {
            passes.push(`permission ${permission} is present`);
        } else {
            failures.push(`expected permission ${permission} is missing`);
        }
    }

    for (const permission of actualPermissions) {
        if (!expectedPermissions.has(permission)) {
            failures.push(`permission ${permission} is not expected`);
        }
    }

    return { failures, passes };
}

export function main(args, stdout = process.stdout, stderr = process.stderr) {
    if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
        stdout.write(USAGE);
        return 0;
    }
    const hasManifestOnly = args.length === 1;
    const hasVersionCode = args.length === 3 && args[1] === '--version-code';
    if (!hasManifestOnly && !hasVersionCode) {
        stderr.write(USAGE);
        return 2;
    }

    const result = checkWearManifest(readFileSync(args[0], 'utf8'), {
        components: EXPECTED_COMPONENTS,
        permissions: EXPECTED_PERMISSIONS,
        versionCode: hasVersionCode ? args[2] : undefined,
    });
    for (const pass of result.passes) stdout.write(`PASS ${pass}\n`);
    for (const failure of result.failures) stderr.write(`FAIL ${failure}\n`);
    return result.failures.length === 0 ? 0 : 1;
}

if (isInvokedDirectly(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
