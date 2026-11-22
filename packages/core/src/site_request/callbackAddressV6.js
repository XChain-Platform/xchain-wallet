// SPDX-License-Identifier: AGPL-3.0-or-later

function parseDottedQuad(value) {
    const octets = value.split('.');
    if (octets.length !== 4) return null;

    const numbers = [];
    for (const octet of octets) {
        if (!/^(?:0|[1-9]\d{0,2})$/.test(octet)) return null;
        const number = Number(octet);
        if (number > 255) return null;
        numbers.push(number);
    }

    return [
        (numbers[0] << 8) | numbers[1],
        (numbers[2] << 8) | numbers[3],
    ];
}

function parseIpv6(ip) {
    if (typeof ip !== 'string' || ip.length === 0 || ip.includes('%')) return null;

    let normalized = ip;
    if (normalized.includes('.')) {
        const finalColon = normalized.lastIndexOf(':');
        if (finalColon < 0) return null;

        const dottedWords = parseDottedQuad(normalized.slice(finalColon + 1));
        if (!dottedWords) return null;
        normalized = `${normalized.slice(0, finalColon + 1)}${dottedWords[0].toString(16)}:${dottedWords[1].toString(16)}`;
    }

    const compression = normalized.indexOf('::');
    if (compression !== -1 && normalized.indexOf('::', compression + 2) !== -1) return null;

    let words;
    if (compression === -1) {
        const parts = normalized.split(':');
        if (parts.length !== 8 || parts.some((part) => part.length === 0)) return null;
        words = parts;
    } else {
        const before = normalized.slice(0, compression);
        const after = normalized.slice(compression + 2);
        const head = before === '' ? [] : before.split(':');
        const tail = after === '' ? [] : after.split(':');
        if (head.some((part) => part.length === 0) || tail.some((part) => part.length === 0)) return null;
        if (head.length + tail.length >= 8) return null;
        words = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
    }

    if (words.some((word) => !/^[0-9a-fA-F]{1,4}$/.test(word))) return null;
    return words.map((word) => Number.parseInt(word, 16));
}

export function isRefusedCallbackIpv6(ip, { developerMode = false } = {}) {
    const words = parseIpv6(ip);
    if (!words) return true;

    const loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
    if (loopback) return !developerMode;

    const unspecified = words.every((word) => word === 0);
    const compatible = words.slice(0, 6).every((word) => word === 0);
    const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    const uniqueLocal = (words[0] & 0xfe00) === 0xfc00;
    const linkLocal = (words[0] & 0xffc0) === 0xfe80;
    const multicast = (words[0] & 0xff00) === 0xff00;

    return unspecified || compatible || mapped || uniqueLocal || linkLocal || multicast;
}
