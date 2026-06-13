// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// @xchain-wallet/bridge-spec — dApp-facing reference client
//
// Small, dependency-free helpers for third-party dApps that want to talk
// to an XChain wallet injected at `window.xchain`. The actual provider
// implementation lives in the wallet's extension/web packages; this module
// just gives consumers a typed, ergonomic way to discover and use it.

import {
    SIGN_IN_DEFAULT_EXPIRY_MS,
    SIGN_IN_CHALLENGE_VERSION,
} from './index.ts';
import type {
    XChainProvider,
    SignInChallengeV2,
    SignInParams,
} from './index.ts';

// Event fired on `window` by the wallet's inject script once
// `window.xchain` is assigned. dApps that load before injection can wait
// for this rather than polling.
export const PROVIDER_READY_EVENT = 'xchain#initialized';

export interface GetProviderOpts {
    // How long to wait for injection. 0 = check once and return.
    // Default 1000ms — injection is usually instant, but some shells
    // (web-app in iframe, slow extensions) need a beat.
    timeoutMs?: number;
}

export function isXChainAvailable(): boolean {
    return (
        typeof globalThis !== 'undefined' &&
        'xchain' in globalThis &&
        (globalThis as { xchain?: XChainProvider }).xchain?.isXChainWallet ===
            true
    );
}

// Await the injected provider. Resolves to null if the wallet does not
// appear within `timeoutMs`. Safe to call before or after injection.
export function getProvider(
    opts: GetProviderOpts = {},
): Promise<XChainProvider | null> {
    const timeoutMs = opts.timeoutMs ?? 1000;

    if (isXChainAvailable()) {
        return Promise.resolve(
            (globalThis as { xchain?: XChainProvider }).xchain ?? null,
        );
    }

    if (timeoutMs <= 0 || typeof globalThis.addEventListener !== 'function') {
        return Promise.resolve(null);
    }

    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: XChainProvider | null) => {
            if (settled) return;
            settled = true;
            globalThis.removeEventListener(PROVIDER_READY_EVENT, onReady);
            clearTimeout(timer);
            resolve(value);
        };
        const onReady = () => {
            const p = (globalThis as { xchain?: XChainProvider }).xchain;
            finish(p ?? null);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        globalThis.addEventListener(PROVIDER_READY_EVENT, onReady, {
            once: true,
        });
        // Re-check once synchronously in case the provider was assigned
        // between our first read and the listener registration.
        if (isXChainAvailable()) {
            onReady();
        }
    });
}

// Generate a cryptographically random nonce, hex-encoded. 16 bytes = 128
// bits of entropy, plenty for replay protection.
export function generateNonce(byteLength: number = 16): string {
    const crypto = globalThis.crypto;
    if (!crypto?.getRandomValues) {
        throw new Error('Web Crypto API is required to generate a nonce');
    }
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Build a SignInParams with a fresh nonce and a sane expiry window.
// Pure — does not touch the provider.
export function makeSignInParams(
    appId: string,
    opts: { expiresInMs?: number; nonce?: string } = {},
): SignInParams {
    return {
        appId,
        nonce: opts.nonce ?? generateNonce(),
        expiresInMs: opts.expiresInMs ?? SIGN_IN_DEFAULT_EXPIRY_MS,
    };
}

// Verify a parsed sign-in challenge is current and well-formed. Does NOT
// verify the signature — callers use `sdk.auth.verifyMessage` for that.
// Returns null on success or a human-readable reason string on failure.
//
// `expected.origin` is mandatory: it is the origin the relying backend
// serves its dApp from (e.g. 'https://app.example'). The challenge's
// origin field was stamped by the wallet from the requesting page, so a
// mismatch means the user signed this challenge on some other site —
// reject it even when appId and nonce match.
export function validateSignInChallenge(
    parts: SignInChallengeV2,
    expected: { appId: string; origin: string; nonce?: string; now?: number },
): string | null {
    if (parts.version !== SIGN_IN_CHALLENGE_VERSION) {
        return `Unsupported challenge version: ${parts.version}`;
    }
    if (parts.appId !== expected.appId) {
        return `Challenge appId mismatch: expected ${expected.appId}, got ${parts.appId}`;
    }
    if (parts.origin !== expected.origin) {
        return `Challenge origin mismatch: expected ${expected.origin}, got ${parts.origin}`;
    }
    if (expected.nonce !== undefined && parts.nonce !== expected.nonce) {
        return 'Challenge nonce mismatch';
    }
    const now = expected.now ?? Date.now();
    if (!Number.isFinite(parts.timestamp) || parts.timestamp > now) {
        return 'Challenge timestamp is in the future';
    }
    if (!Number.isFinite(parts.expiresAt) || parts.expiresAt <= now) {
        return 'Challenge is expired';
    }
    return null;
}
