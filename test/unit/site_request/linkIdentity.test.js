// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import {
    LINK_APP_NAME_MAX,
    isAnotherDeviceLogin,
    linkAnswerOrigin,
    linkAppName,
} from '../../../packages/core/src/site_request/linkIdentity.js';
import { BIDI_PLACEHOLDER } from '../../../packages/core/src/shared/utils/textHardening.js';

const RLO = String.fromCharCode(0x202E);
const ZWSP = String.fromCharCode(0x200B);

describe('linkAnswerOrigin', () => {
    it('prefers return over a same-origin callback', () => {
        expect(linkAnswerOrigin({
            return: 'https://site.example/account',
            callback: 'https://site.example/api/wallet',
        })).toBe('https://site.example');
    });

    it('keeps a valid return when the callback is not a URL', () => {
        expect(linkAnswerOrigin({
            return: 'https://site.example/account',
            callback: 'not a URL',
        })).toBe('https://site.example');
    });

    it('uses a callback when return is absent', () => {
        expect(linkAnswerOrigin({ callback: 'https://site.example/api/wallet' }))
            .toBe('https://site.example');
    });

    it('normalizes an internationalized host to punycode', () => {
        expect(linkAnswerOrigin({ return: 'https://bücher.example/cb' }))
            .toBe('https://xn--bcher-kva.example');
    });

    it('keeps a non-default port in the origin', () => {
        expect(linkAnswerOrigin({ return: 'https://site.example:8443/cb' }))
            .toBe('https://site.example:8443');
    });

    it('fails closed when return and callback have different origins', () => {
        expect(linkAnswerOrigin({
            return: 'https://site.example/account',
            callback: 'https://api.example/wallet',
        })).toBeNull();
    });

    it.each([
        ['a non-URL', { return: 'not a URL' }],
        ['a javascript target', { return: 'javascript:alert(1)' }],
        ['an ftp target', { callback: 'ftp://site.example/result' }],
        ['a null envelope', null],
    ])('returns null for %s', (_label, envelope) => {
        expect(linkAnswerOrigin(envelope)).toBeNull();
    });
});

describe('linkAppName', () => {
    it('neutralizes bidi overrides and zero-width characters', () => {
        const name = linkAppName({ app: { name: `Wal${ZWSP}let${RLO}App` } });
        expect(name).toBe(`Wallet${BIDI_PLACEHOLDER}App`);
        expect(name).not.toContain(RLO);
        expect(name).not.toContain(ZWSP);
    });

    it('caps a long name at the display limit', () => {
        const name = linkAppName({ app: { name: 'A'.repeat(100) } });
        expect(LINK_APP_NAME_MAX).toBe(64);
        expect(name).toHaveLength(LINK_APP_NAME_MAX);
        expect(name).toBe(`${'A'.repeat(63)}…`);
    });

    it.each([
        ['a missing app', {}],
        ['a missing name', { app: {} }],
        ['an empty name', { app: { name: '' } }],
        ['a whitespace-only name', { app: { name: ' \t\n ' } }],
        ['a numeric name', { app: { name: 42 } }],
    ])('returns null for %s', (_label, envelope) => {
        expect(linkAppName(envelope)).toBeNull();
    });
});

describe('isAnotherDeviceLogin', () => {
    it('accepts login with callback only', () => {
        expect(isAnotherDeviceLogin({ method: 'login', callback: 'https://site.example/cb' }))
            .toBe(true);
    });

    it.each([
        ['login with both targets', {
            method: 'login',
            callback: 'https://site.example/cb',
            return: 'https://site.example/return',
        }],
        ['login with return only', {
            method: 'login',
            return: 'https://site.example/return',
        }],
        ['signMessage with callback only', {
            method: 'signMessage',
            callback: 'https://site.example/cb',
        }],
        ['login with an empty callback', {
            method: 'login',
            callback: '',
        }],
        ['a null envelope', null],
    ])('rejects %s', (_label, envelope) => {
        expect(isAnotherDeviceLogin(envelope)).toBe(false);
    });
});
