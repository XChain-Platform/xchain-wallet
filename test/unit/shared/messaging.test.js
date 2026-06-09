// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Unit: shared/MessagingContext + shared/useMessaging.
// useMessaging is a React hook — tests via renderHook (React Testing Library).

import { describe, it, expect } from 'vitest';
import { createContext } from 'react';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import { useMessaging, screenVariantFor } from '../../../packages/core/src/shared/useMessaging.js';

describe('MessagingContext', () => {
    it('is a valid React context object', () => {
        // A React context has $$typeof + Provider + Consumer.
        expect(MessagingContext).toBeDefined();
        expect(typeof MessagingContext.Provider).toBe('object');
        expect(typeof MessagingContext.Consumer).toBe('object');
    });

    it('defaults to null', () => {
        // renderHook without a provider gets the default value.
        const { result } = renderHook(() => {
            const ctx = React.useContext(MessagingContext);
            return ctx;
        });
        expect(result.current).toBeNull();
    });
});

describe('useMessaging', () => {
    it('throws when used outside MessagingProvider', () => {
        // suppress React error boundary noise in test output
        const consoleError = console.error;
        console.error = () => {};
        expect(() => {
            renderHook(() => useMessaging());
        }).toThrow('useMessaging must be used inside <MessagingProvider>');
        console.error = consoleError;
    });

    it('returns the context value when inside a provider', () => {
        const mockValue = {
            shell: 'web',
            messaging: { unlockWallet: async () => ({}) },
        };
        const wrapper = ({ children }) =>
            React.createElement(MessagingContext.Provider, { value: mockValue }, children);
        const { result } = renderHook(() => useMessaging(), { wrapper });
        expect(result.current.shell).toBe('web');
        expect(typeof result.current.messaging.unlockWallet).toBe('function');
    });
});

describe('screenVariantFor', () => {
    it('returns "small" for popup shell', () => {
        expect(screenVariantFor('popup')).toBe('small');
    });

    it('returns "full" for web shell', () => {
        expect(screenVariantFor('web')).toBe('full');
    });

    it('returns "full" for desktop shell', () => {
        expect(screenVariantFor('desktop')).toBe('full');
    });

    it('returns "full" for any unknown shell', () => {
        expect(screenVariantFor('unknown')).toBe('full');
    });
});
