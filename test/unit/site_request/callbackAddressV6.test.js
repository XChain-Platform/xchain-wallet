// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { isRefusedCallbackIpv6 } from '../../../packages/core/src/site_request/callbackAddressV6.js';

describe('isRefusedCallbackIpv6', () => {
    it('fails closed for malformed input and zone identifiers', () => {
        for (const ip of [
            '',
            '2001:db8::1::2',
            '2001:db8:0:0:0:0:0',
            '2001:db8:0:0:0:0:0:0:1',
            '2001:db8::g',
            '[2001:db8::1]',
            'fe80::1%eth0',
            '::ffff:192.168.001.1',
            '::ffff:256.0.0.1',
            '192.0.2.1',
            null,
        ]) {
            expect(isRefusedCallbackIpv6(ip)).toBe(true);
        }
    });

    it('refuses unspecified and loopback, except loopback in Developer Mode', () => {
        expect(isRefusedCallbackIpv6('::')).toBe(true);
        expect(isRefusedCallbackIpv6('::1')).toBe(true);
        expect(isRefusedCallbackIpv6('0:0:0:0:0:0:0:1')).toBe(true);
        expect(isRefusedCallbackIpv6('::1', { developerMode: true })).toBe(false);
        expect(isRefusedCallbackIpv6('::', { developerMode: true })).toBe(true);
    });

    it('checks both edges and both neighbours of fc00::/7', () => {
        expect(isRefusedCallbackIpv6('fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(false);
        expect(isRefusedCallbackIpv6('fc00::')).toBe(true);
        expect(isRefusedCallbackIpv6('fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
        expect(isRefusedCallbackIpv6('fe00::')).toBe(false);
    });

    it('checks both edges and both neighbours of fe80::/10', () => {
        expect(isRefusedCallbackIpv6('fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(false);
        expect(isRefusedCallbackIpv6('fe80::')).toBe(true);
        expect(isRefusedCallbackIpv6('febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
        expect(isRefusedCallbackIpv6('fec0::')).toBe(false);
    });

    it('checks the edges and lower neighbour of ff00::/8', () => {
        expect(isRefusedCallbackIpv6('feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(false);
        expect(isRefusedCallbackIpv6('ff00::')).toBe(true);
        expect(isRefusedCallbackIpv6('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
    });

    it('refuses every IPv4-compatible and IPv4-mapped address', () => {
        expect(isRefusedCallbackIpv6('::0.0.0.0')).toBe(true);
        expect(isRefusedCallbackIpv6('::8.8.8.8')).toBe(true);
        expect(isRefusedCallbackIpv6('::255.255.255.255')).toBe(true);
        expect(isRefusedCallbackIpv6('::1:0:0')).toBe(false);

        expect(isRefusedCallbackIpv6('::fffe:ffff:ffff')).toBe(false);
        expect(isRefusedCallbackIpv6('::ffff:0.0.0.0')).toBe(true);
        expect(isRefusedCallbackIpv6('::ffff:8.8.8.8')).toBe(true);
        expect(isRefusedCallbackIpv6('::ffff:255.255.255.255')).toBe(true);
        expect(isRefusedCallbackIpv6('::1:0:0:0')).toBe(false);
        expect(isRefusedCallbackIpv6('::ffff:8.8.8.8', { developerMode: true })).toBe(true);
    });

    it('normalizes compressed and expanded spellings before classification', () => {
        expect(isRefusedCallbackIpv6('fd12:3456::abcd')).toBe(true);
        expect(isRefusedCallbackIpv6('fd12:3456:0:0:0:0:0:abcd')).toBe(true);
        expect(isRefusedCallbackIpv6('2001:db8::abcd')).toBe(false);
        expect(isRefusedCallbackIpv6('2001:db8:0:0:0:0:0:abcd')).toBe(false);
    });
});
