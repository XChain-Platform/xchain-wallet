// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { isInvokedDirectly } from './is-invoked-directly.mjs';

const USAGE = `Usage: node tools/release/verify-wear-manifest.mjs --help

Reads Android manifest XML and the expected component and permission policy.
Reports the manifest checks that pass and fail without changing the manifest.
`;

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

export function checkWearManifest(xml, { components, permissions }) {
    const failures = [];
    const passes = [];
    const actualComponents = listComponents(xml);
    const actualPermissions = new Set(listPermissions(xml));
    const expectedPermissions = new Set(permissions);
    const watchFeature = usesFeatures(xml)
        .find(({ name }) => name === 'android.hardware.type.watch');
    const standalone = metaData(xml)['com.google.android.wearable.standalone'];

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

if (isInvokedDirectly(import.meta.url)
    && process.argv.length === 3
    && (process.argv[2] === '--help' || process.argv[2] === '-h')) {
    process.stdout.write(USAGE);
}
