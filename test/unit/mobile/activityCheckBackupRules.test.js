// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BACKUP_RULES = resolve(
    'packages/mobile/android/app/src/main/res/xml/backup_rules.xml',
);
const EXTRACTION_RULES = resolve(
    'packages/mobile/android/app/src/main/res/xml/data_extraction_rules.xml',
);
const ACTIVITY_CHECK_FILES = ['activity-check.json', 'activity-check-runs.txt'];

function parseXml(file) {
    const document = new DOMParser().parseFromString(
        readFileSync(file, 'utf8'),
        'text/xml',
    );
    const error = document.querySelector('parsererror');
    if (error) throw new Error(`${file}: ${error.textContent}`);
    return document;
}

function excludes(element) {
    return [...element.children].filter((child) => child.localName === 'exclude');
}

function expectActivityCheckExcludes(element) {
    for (const path of ACTIVITY_CHECK_FILES) {
        const matches = excludes(element).filter((exclude) => (
            exclude.getAttribute('domain') === 'file'
            && exclude.getAttribute('path') === path
        ));
        expect(matches, path).toHaveLength(1);
    }
}

describe('Android activity-check backup rules', () => {
    it('parses both backup resource files as XML', () => {
        expect(() => parseXml(BACKUP_RULES)).not.toThrow();
        expect(() => parseXml(EXTRACTION_RULES)).not.toThrow();
    });

    it('excludes both activity-check files from legacy backups', () => {
        const document = parseXml(BACKUP_RULES);
        const surfaces = document.querySelectorAll('full-backup-content');
        expect(surfaces).toHaveLength(1);
        expectActivityCheckExcludes(surfaces[0]);

        const wholesale = excludes(surfaces[0]).filter(
            (exclude) => exclude.getAttribute('path') === '.',
        );
        expect(wholesale).toHaveLength(5);
    });

    it.each(['cloud-backup', 'device-transfer'])(
        'excludes both activity-check files from %s',
        (name) => {
            const document = parseXml(EXTRACTION_RULES);
            const surfaces = document.querySelectorAll(name);
            expect(surfaces).toHaveLength(1);
            expectActivityCheckExcludes(surfaces[0]);

            const wholesale = excludes(surfaces[0]).filter(
                (exclude) => !exclude.hasAttribute('path'),
            );
            expect(wholesale).toHaveLength(9);
        },
    );
});
