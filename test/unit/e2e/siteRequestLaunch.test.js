// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { requestLink } from '../../e2e/fixtures/siteRequest.js';
import {
    androidViewArgs,
    iosOpenUrlArgs,
    parseAmStart,
    posixQuote,
    SIMCTL_OPENURL_MAX,
} from '../../e2e/fixtures/siteRequestLaunch.js';

const vectors = JSON.parse(readFileSync(
    resolve('test/fixtures/connect/request-vectors.json'),
    'utf8',
));
const LINK = 'xchain:request?v=1&req=payload';
const PACKAGE_NAME = 'io.xchain.wallet.android';
const SERIAL = 'emulator-5554';

describe('site request launch shell quoting', () => {
    const shellTexts = [
        ...vectors.valid.map(({ name, envelope }) => ({
            name,
            text: requestLink(envelope),
        })),
        {
            name: 'POSIX shell metacharacters',
            text: "'$` space &;",
        },
    ];

    it.each(shellTexts)('round-trips $name byte for byte through /bin/sh', ({ text }) => {
        const output = execFileSync('/bin/sh', [
            '-c',
            `printf %s ${posixQuote(text)}`,
        ]);

        expect(output.equals(Buffer.from(text))).toBe(true);
    });
});

describe('Android VIEW launch arguments', () => {
    it.each([
        {
            name: 'without serial or stop-first',
            options: { packageName: PACKAGE_NAME },
            expected: [
                'shell', 'am', 'start', '-W',
                '-a', 'android.intent.action.VIEW',
                '-p', PACKAGE_NAME,
                '-d', `'${LINK}'`,
            ],
        },
        {
            name: 'with serial',
            options: { packageName: PACKAGE_NAME, serial: SERIAL },
            expected: [
                '-s', SERIAL,
                'shell', 'am', 'start', '-W',
                '-a', 'android.intent.action.VIEW',
                '-p', PACKAGE_NAME,
                '-d', `'${LINK}'`,
            ],
        },
        {
            name: 'with stop-first',
            options: { packageName: PACKAGE_NAME, stopFirst: true },
            expected: [
                'shell', 'am', 'start', '-W', '-S',
                '-a', 'android.intent.action.VIEW',
                '-p', PACKAGE_NAME,
                '-d', `'${LINK}'`,
            ],
        },
        {
            name: 'with serial and stop-first',
            options: {
                packageName: 'io.xchain.wallet.android.debug',
                serial: SERIAL,
                stopFirst: true,
            },
            expected: [
                '-s', SERIAL,
                'shell', 'am', 'start', '-W', '-S',
                '-a', 'android.intent.action.VIEW',
                '-p', 'io.xchain.wallet.android.debug',
                '-d', `'${LINK}'`,
            ],
        },
    ])('builds the exact argument array $name', ({ options, expected }) => {
        expect(androidViewArgs(LINK, options)).toEqual(expected);
    });

    it.each([
        ['a non-string link', null, { packageName: PACKAGE_NAME }],
        ['an empty link', '', { packageName: PACKAGE_NAME }],
        ['a link containing a newline', `${LINK}\nnext`, { packageName: PACKAGE_NAME }],
        ['a link containing a NUL', `${LINK}\0next`, { packageName: PACKAGE_NAME }],
        ['a one-part package', LINK, { packageName: 'wallet' }],
        ['an empty package part', LINK, { packageName: 'io..wallet' }],
        ['a package part starting with a number', LINK, { packageName: 'io.1wallet' }],
        ['an empty serial', LINK, { packageName: PACKAGE_NAME, serial: '' }],
        ['a serial containing whitespace', LINK, { packageName: PACKAGE_NAME, serial: 'emulator 5554' }],
    ])('rejects %s', (_name, link, options) => {
        expect(() => androidViewArgs(link, options)).toThrow(TypeError);
    });
});

describe('iOS simulator URL launch arguments', () => {
    it('accepts a link at the probe P3 boundary', () => {
        const link = 'x'.repeat(SIMCTL_OPENURL_MAX);

        expect(iosOpenUrlArgs(link)).toEqual(['simctl', 'openurl', 'booted', link]);
    });

    it('accepts an explicit simulator UUID', () => {
        const udid = 'A1B2C3D4-E5F6-7890-abcd-1234567890ef';

        expect(iosOpenUrlArgs(LINK, { udid })).toEqual([
            'simctl', 'openurl', udid, LINK,
        ]);
    });

    it('rejects a link one character beyond the probe P3 boundary', () => {
        expect(() => iosOpenUrlArgs('x'.repeat(SIMCTL_OPENURL_MAX + 1)))
            .toThrow(/2047 characters measured by probe P3/);
    });

    it.each([
        'Booted',
        'A1B2C3D4-E5F6-7890-ABCD',
        'A1B2C3D4-E5F6-7890-ABCD-1234567890GH',
    ])('rejects invalid simulator UDID %s', (udid) => {
        expect(() => iosOpenUrlArgs(LINK, { udid })).toThrow(TypeError);
    });
});

describe('am start output parser', () => {
    it('reads a successful cold launch', () => {
        expect(parseAmStart([
            'Starting: Intent { act=android.intent.action.VIEW }',
            'Status: ok',
            'LaunchState: COLD',
            'TotalTime: 842',
        ].join('\n'))).toEqual({
            ok: true,
            launchState: 'COLD',
            broughtToFront: false,
            error: null,
        });
    });

    it('reads delivery to the currently running top-most instance', () => {
        expect(parseAmStart([
            'Warning: Activity not started, intent has been delivered to currently running top-most instance.',
            'Status: ok',
            'LaunchState: HOT',
        ].join('\n'))).toEqual({
            ok: true,
            launchState: 'HOT',
            broughtToFront: true,
            error: null,
        });
    });

    it('reads an unresolved activity error', () => {
        expect(parseAmStart(
            'Error: Activity not started, unable to resolve Intent',
        )).toEqual({
            ok: false,
            launchState: null,
            broughtToFront: false,
            error: 'Activity not started, unable to resolve Intent',
        });
    });

    it('does not accept a status followed by an error', () => {
        expect(parseAmStart([
            'Status: ok',
            'LaunchState: WARM',
            'Error: Activity not started, unable to resolve Intent',
        ].join('\n'))).toEqual({
            ok: false,
            launchState: 'WARM',
            broughtToFront: false,
            error: 'Activity not started, unable to resolve Intent',
        });
    });
});
