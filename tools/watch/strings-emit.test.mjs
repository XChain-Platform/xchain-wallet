// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import test from 'node:test';

import { toAndroidStringsXml, toAppleStrings } from './gen-strings.mjs';

test('emits sorted Apple strings with escaped syntax and unchanged placeholders', () => {
    const output = toAppleStrings({
        'state.zed': 'Path \\ line\n"quoted" {amount}',
        'state.alpha': 'First',
    });

    assert.equal(output, [
        '"state.alpha" = "First";',
        '"state.zed" = "Path \\\\ line\\n\\"quoted\\" {amount}";',
        '',
    ].join('\n'));
});

test('emits sorted Android XML with normalized names and escaped values', () => {
    const output = toAndroidStringsXml({
        'w2.special-value': '@open & <close> \'single\' "double" \\ path\n{amount}',
        'state.alpha': '?question',
    });

    assert.equal(output, [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<resources>',
        '    <string name="state_alpha">\\?question</string>',
        '    <string name="w2_special_value">\\@open &amp; &lt;close&gt; \\\'single\\\' \\"double\\" \\\\ path\\n{amount}</string>',
        '</resources>',
        '',
    ].join('\n'));
});

test('marks values containing percent signs as unformatted', () => {
    const output = toAndroidStringsXml({
        'w1.percent': 'Change: 10%',
        'w1.plain': 'Balance {amount}',
    });

    assert.match(output, /<string name="w1_percent" formatted="false">Change: 10%<\/string>/);
    assert.match(output, /<string name="w1_plain">Balance \{amount\}<\/string>/);
});

test('refuses invalid and colliding Android resource names', () => {
    assert.throws(
        () => toAndroidStringsXml({ '9.invalid': 'value' }),
        /Invalid Android resource name: 9\.invalid/,
    );
    assert.throws(
        () => toAndroidStringsXml({ 'same-key': 'one', 'same.key': 'two' }),
        /Duplicate Android resource name: same_key/,
    );
});

test('emits valid empty files', () => {
    assert.equal(toAppleStrings({}), '');
    assert.equal(toAndroidStringsXml({}), [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<resources>',
        '</resources>',
        '',
    ].join('\n'));
});
