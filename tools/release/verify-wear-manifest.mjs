// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

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
