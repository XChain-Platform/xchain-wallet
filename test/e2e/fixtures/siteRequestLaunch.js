// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

export const SIMCTL_OPENURL_MAX = 2047;

const JAVA_PACKAGE = /^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)+[A-Za-z_$][A-Za-z0-9_$]*$/;
const SIMULATOR_UDID = /^[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}$/;

export function posixQuote(text) {
    return `'${text.replaceAll("'", "'\\''")}'`;
}

export function androidViewArgs(link, { packageName, serial, stopFirst = false }) {
    if (typeof link !== 'string' || link.length === 0 || /[\n\r\0]/.test(link)) {
        throw new TypeError('link must be a non-empty single-line string without NUL');
    }
    if (typeof packageName !== 'string' || !JAVA_PACKAGE.test(packageName)) {
        throw new TypeError('packageName must contain two or more dot-separated Java identifiers');
    }
    if (serial !== undefined && (
        typeof serial !== 'string'
        || serial.length === 0
        || /\s/.test(serial)
    )) {
        throw new TypeError('serial must be a non-empty string without whitespace');
    }

    return [
        ...(serial === undefined ? [] : ['-s', serial]),
        'shell',
        'am',
        'start',
        '-W',
        ...(stopFirst ? ['-S'] : []),
        '-a',
        'android.intent.action.VIEW',
        '-p',
        packageName,
        '-d',
        posixQuote(link),
    ];
}

export function iosOpenUrlArgs(link, { udid = 'booted' } = {}) {
    if (typeof link !== 'string') {
        throw new TypeError('link must be a string');
    }
    if (link.length > SIMCTL_OPENURL_MAX) {
        throw new RangeError(`link exceeds ${SIMCTL_OPENURL_MAX} characters measured by probe P3`);
    }
    if (udid !== 'booted' && !SIMULATOR_UDID.test(udid)) {
        throw new TypeError('udid must be booted or an 8-4-4-4-12 hex UUID');
    }

    return ['simctl', 'openurl', udid, link];
}

export function parseAmStart(text) {
    const lines = text.split(/\r?\n/);
    const errorLine = lines.find((line) => line.startsWith('Error'));
    const errorMatch = lines
        .map((line) => /^Error:\s*(.*)$/.exec(line))
        .find(Boolean);
    const launchStateMatch = lines
        .map((line) => /^LaunchState:\s*(\S+)/.exec(line))
        .find(Boolean);

    return {
        ok: lines.includes('Status: ok') && errorLine === undefined,
        launchState: launchStateMatch?.[1] ?? null,
        broughtToFront: lines.some((line) => (
            line.includes('intent has been delivered to currently running top-most instance')
        )),
        error: errorMatch?.[1] ?? null,
    };
}
