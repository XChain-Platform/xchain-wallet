// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Settings action messages (saved, could not save, not found) are the shared
// StatusMessage row, through the settings Status primitive or directly. They
// were a mix of tiny red hint text, muted hint text, an outlined box and a
// dashed box for the same kinds of message.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withEnglishCopy } from '../../helpers/englishSource.js';

const settingsDir = join(process.cwd(), 'packages', 'core', 'src', 'shared', 'components', 'settings');
const files = [
    ...readdirSync(settingsDir).filter((f) => f.endsWith('.jsx')).map((f) => join(settingsDir, f)),
    join(process.cwd(), 'packages', 'core', 'src', 'shared', 'routes', 'Settings.jsx'),
];

// An element announced as a message whose look is set inline.
const HAND_STYLED_MESSAGE = /<(span|div|p)\b[^>]*role="(alert|status)"[^>]*style=\{/g;

describe('settings inline messages', () => {
    it('never hand-style an announced message with danger text', () => {
        const offenders = [];
        for (const file of files) {
            const src = readFileSync(file, 'utf8');
            for (const match of src.matchAll(HAND_STYLED_MESSAGE)) {
                const tag = src.slice(match.index, src.indexOf('>', match.index) + 1);
                if (/xc-danger|role="alert"/.test(tag)) offenders.push(`${file.split('/').pop()}: ${tag.slice(0, 90)}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps action results out of the muted hint style', () => {
        const display = readFileSync(join(settingsDir, 'DisplaySection.jsx'), 'utf8');
        for (const name of ['watchMessage', 'resetMessage', 'displayMessage']) {
            expect(display).not.toMatch(new RegExp(`style=\\{ROW_HINT\\}>\\{${name}`));
            expect(display).toMatch(new RegExp(`\\{${name} \\? (\\(\\s*)?<StatusMessage`));
        }
        const about = readFileSync(join(settingsDir, 'AboutSection.jsx'), 'utf8');
        expect(about).toMatch(/\{status \? <StatusMessage variant="success">/);
        const settings = readFileSync(files.at(-1), 'utf8');
        expect(settings).toMatch(/<StatusMessage variant=\{UPDATE_CHECK_VARIANT\[state\]/);
    });

    it('puts a row result under the row at full width, not in its label column', () => {
        const display = withEnglishCopy(readFileSync(join(settingsDir, 'DisplaySection.jsx'), 'utf8'));
        expect(display).toMatch(/Saved chain filters<\/span>\s*<\/div>/);
        expect(display).toMatch(/saved list preferences\.<\/span>\s*<\/div>/);
        const region = withEnglishCopy(readFileSync(join(settingsDir, 'LanguageRegionSection.jsx'), 'utf8'));
        expect(region).toMatch(/Asset balances are unchanged\.<\/span>\s*<\/div>/);
    });

    it('shows a settings load failure as the shared load error, not a bare paragraph', () => {
        const keyboard = readFileSync(join(settingsDir, 'KeyboardSection.jsx'), 'utf8');
        expect(keyboard).toMatch(/if \(error\) return <SettingsLoadError error=\{error\} \/>;/);
    });
});
