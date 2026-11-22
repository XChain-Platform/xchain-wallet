// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it } from 'vitest';
import {
    isRefusedCallbackHost,
    isRefusedCallbackIpv4,
} from '../../../packages/core/src/site_request/callbackAddress.js';

const refusedRanges = [
    ['0.0.0.0/8', '0.0.0.0', '0.255.255.255'],
    ['10.0.0.0/8', '10.0.0.0', '10.255.255.255'],
    ['100.64.0.0/10', '100.64.0.0', '100.127.255.255'],
    ['127.0.0.0/8', '127.0.0.0', '127.255.255.255'],
    ['169.254.0.0/16', '169.254.0.0', '169.254.255.255'],
    ['172.16.0.0/12', '172.16.0.0', '172.31.255.255'],
    ['192.0.0.0/24', '192.0.0.0', '192.0.0.255'],
    ['192.168.0.0/16', '192.168.0.0', '192.168.255.255'],
    ['198.18.0.0/15', '198.18.0.0', '198.19.255.255'],
    ['224.0.0.0/4', '224.0.0.0', '239.255.255.255'],
    ['240.0.0.0/4', '240.0.0.0', '255.255.255.255'],
];

const rangeNeighbours = [
    ['after 0.0.0.0/8', '1.0.0.0', false],
    ['before 10.0.0.0/8', '9.255.255.255', false],
    ['after 10.0.0.0/8', '11.0.0.0', false],
    ['before 100.64.0.0/10', '100.63.255.255', false],
    ['after 100.64.0.0/10', '100.128.0.0', false],
    ['before 127.0.0.0/8', '126.255.255.255', false],
    ['after 127.0.0.0/8', '128.0.0.0', false],
    ['before 169.254.0.0/16', '169.253.255.255', false],
    ['after 169.254.0.0/16', '169.255.0.0', false],
    ['before 172.16.0.0/12', '172.15.255.255', false],
    ['after 172.16.0.0/12', '172.32.0.0', false],
    ['before 192.0.0.0/24', '191.255.255.255', false],
    ['after 192.0.0.0/24', '192.0.1.0', false],
    ['before 192.168.0.0/16', '192.167.255.255', false],
    ['after 192.168.0.0/16', '192.169.0.0', false],
    ['before 198.18.0.0/15', '198.17.255.255', false],
    ['after 198.18.0.0/15', '198.20.0.0', false],
    ['before 224.0.0.0/4', '223.255.255.255', false],
    ['after 224.0.0.0/4 and first of 240.0.0.0/4', '240.0.0.0', true],
    ['before 240.0.0.0/4 and last of 224.0.0.0/4', '239.255.255.255', true],
];

describe('isRefusedCallbackIpv4', () => {
    it.each(refusedRanges)('refuses the first and last address in %s', (_range, first, last) => {
        expect(isRefusedCallbackIpv4(first)).toBe(true);
        expect(isRefusedCallbackIpv4(last)).toBe(true);
    });

    it.each(rangeNeighbours)('classifies the neighbour %s', (_boundary, ip, refused) => {
        expect(isRefusedCallbackIpv4(ip)).toBe(refused);
    });

    it.each([
        '',
        '1.2.3',
        '1.2.3.4.5',
        '256.2.3.4',
        '1.-2.3.4',
        ' 1.2.3.4',
        '1.2.3.4 ',
        '01.2.3.4',
        '1.02.3.4',
        '1.2.003.4',
        '1.2.3.00',
        '0177.0.0.1',
        '0x7f.0.0.1',
        '2130706433',
        '1e0.2.3.4',
        '1.2.3.+4',
        null,
        undefined,
        0x7f000001,
    ])('refuses malformed IPv4 input %j', (ip) => {
        expect(isRefusedCallbackIpv4(ip)).toBe(true);
    });

    it('lets only loopback addresses through in Developer Mode', () => {
        expect(isRefusedCallbackIpv4('127.0.0.0', { developerMode: true })).toBe(false);
        expect(isRefusedCallbackIpv4('127.42.10.9', { developerMode: true })).toBe(false);
        expect(isRefusedCallbackIpv4('127.255.255.255', { developerMode: true })).toBe(false);
        expect(isRefusedCallbackIpv4('10.0.0.1', { developerMode: true })).toBe(true);
        expect(isRefusedCallbackIpv4('169.254.1.1', { developerMode: true })).toBe(true);
        expect(isRefusedCallbackIpv4('01.2.3.4', { developerMode: true })).toBe(true);
    });
});

describe('isRefusedCallbackHost', () => {
    it.each([
        '8.8.8.8',
        '127.0.0.1',
        '[::1]',
        '[2001:db8::1]',
        '[::ffff:192.0.2.1]',
    ])('refuses the IP-literal host %s under Tor', (host) => {
        expect(isRefusedCallbackHost(host, { tor: true })).toBe(true);
    });

    it.each([
        'example.com',
        'localhost',
        '2001:db8::1',
        '[not-ipv6]',
        '01.2.3.4',
        '',
        null,
        undefined,
    ])('does not classify the non-IP host %j as an IP literal under Tor', (host) => {
        expect(isRefusedCallbackHost(host, { tor: true })).toBe(false);
    });

    it.each(['8.8.8.8', '[::1]', 'example.com'])(
        'does not refuse %s based on its literal form when Tor is off',
        (host) => {
            expect(isRefusedCallbackHost(host)).toBe(false);
        },
    );
});
