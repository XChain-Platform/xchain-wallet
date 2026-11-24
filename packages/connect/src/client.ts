// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: MIT

// @dankest-llc/xchain-connect - dApp-facing reference client
//
// Small, dependency-free helpers for third-party dApps that want to talk
// to an XChain wallet injected at `window.xchain`. The actual provider
// implementation lives in the wallet's extension/web packages; this module
// just gives consumers a typed, ergonomic way to discover and use it.

import {
    PROVIDER_READY_EVENT as runtimeProviderReadyEvent,
    isXChainAvailable as runtimeIsXChainAvailable,
    getProvider as runtimeGetProvider,
    generateNonce as runtimeGenerateNonce,
    validateSignInChallenge as runtimeValidateSignInChallenge,
} from './runtime.js';
import type {
    XChainProvider,
    SignInChallengeV2,
} from './index.ts';

// Event fired on `window` by the wallet's inject script once
// `window.xchain` is assigned. dApps that load before injection can wait
// for this rather than polling.
export const PROVIDER_READY_EVENT: 'xchain#initialized' = runtimeProviderReadyEvent;

export interface GetProviderOpts {
    // How long to wait for injection. 0 = check once and return.
    // Default 1000ms - injection is usually instant, but some shells
    // (web-app in iframe, slow extensions) need a beat.
    timeoutMs?: number;
}

export const isXChainAvailable: () => boolean = runtimeIsXChainAvailable;

// Await the injected provider. Resolves to null if the wallet does not
// appear within `timeoutMs`. Safe to call before or after injection.
export const getProvider: (
    opts?: GetProviderOpts,
) => Promise<XChainProvider | null> = runtimeGetProvider;

// Generate a cryptographically random nonce, hex-encoded. 16 bytes = 128
// bits of entropy, plenty for replay protection.
export const generateNonce: (byteLength?: number) => string = runtimeGenerateNonce;

// Verify a parsed sign-in challenge is current and well-formed. Does NOT
// verify the signature - callers use `sdk.auth.verifyMessage` for that.
// Returns null on success or a human-readable reason string on failure.
//
// `expected.origin` is mandatory: it is the origin the relying backend
// serves its dApp from (e.g. 'https://app.example'). The challenge's
// origin field was stamped by the wallet from the requesting page, so a
// mismatch means the user signed this challenge on some other site -
// reject it even when appId and nonce match.
export const validateSignInChallenge: (
    parts: SignInChallengeV2,
    expected: { appId: string; origin: string; nonce?: string; now?: number },
) => string | null = runtimeValidateSignInChallenge;
