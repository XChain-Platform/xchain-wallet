// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/index — barrel re-exports are complete and consistent.

import { describe, it, expect } from 'vitest';
import * as schemas from '../../../packages/core/src/schemas/index.js';

describe('schemas/index barrel', () => {
    describe('constants re-exports', () => {
        it('exports NETWORKS', () => {
            expect(Array.isArray(schemas.NETWORKS)).toBe(true);
            expect(schemas.NETWORKS).toContain('mainnet');
        });

        it('exports ACTION_PERMISSIONS', () => {
            expect(Array.isArray(schemas.ACTION_PERMISSIONS)).toBe(true);
        });

        it('exports ADDRESS_SOURCES', () => {
            expect(Array.isArray(schemas.ADDRESS_SOURCES)).toBe(true);
        });
    });

    describe('validate re-exports', () => {
        it('exports isString as a function', () => {
            expect(typeof schemas.isString).toBe('function');
        });
        it('exports isNonEmptyString', () => {
            expect(typeof schemas.isNonEmptyString).toBe('function');
        });
        it('exports check', () => {
            expect(typeof schemas.check).toBe('function');
        });
        it('exports checkEach', () => {
            expect(typeof schemas.checkEach).toBe('function');
        });
        it('exports result', () => {
            expect(typeof schemas.result).toBe('function');
        });
        it('exports isPlainObject', () => {
            expect(typeof schemas.isPlainObject).toBe('function');
        });
        it('exports isIsoTimestamp', () => {
            expect(typeof schemas.isIsoTimestamp).toBe('function');
        });
    });

    describe('named create/validate exports', () => {
        it('exports createWallet', () => expect(typeof schemas.createWallet).toBe('function'));
        it('exports validateWallet', () => expect(typeof schemas.validateWallet).toBe('function'));
        it('exports createAccount', () => expect(typeof schemas.createAccount).toBe('function'));
        it('exports validateAccount', () => expect(typeof schemas.validateAccount).toBe('function'));
        it('exports createAddress', () => expect(typeof schemas.createAddress).toBe('function'));
        it('exports validateAddress', () => expect(typeof schemas.validateAddress).toBe('function'));
        it('exports createContact', () => expect(typeof schemas.createContact).toBe('function'));
        it('exports validateContact', () => expect(typeof schemas.validateContact).toBe('function'));
        it('exports createConnectedSite', () => expect(typeof schemas.createConnectedSite).toBe('function'));
        it('exports validateConnectedSite', () => expect(typeof schemas.validateConnectedSite).toBe('function'));
        it('exports validateMultisigConfig', () => expect(typeof schemas.validateMultisigConfig).toBe('function'));
        it('exports buildMultisigConfig', () => expect(typeof schemas.buildMultisigConfig).toBe('function'));
        it('exports createMultisigSigningSession', () => expect(typeof schemas.createMultisigSigningSession).toBe('function'));
        it('exports validateMultisigSigningSession', () => expect(typeof schemas.validateMultisigSigningSession).toBe('function'));
        it('exports pendingCosignerPubkeys', () => expect(typeof schemas.pendingCosignerPubkeys).toBe('function'));
        it('exports progressSummary', () => expect(typeof schemas.progressSummary).toBe('function'));
        it('exports MULTISIG_SESSION_STATUSES', () => expect(Array.isArray(schemas.MULTISIG_SESSION_STATUSES)).toBe(true));
        it('exports createDefaultSettings', () => expect(typeof schemas.createDefaultSettings).toBe('function'));
        it('exports createDefaultAdsChainState', () => expect(typeof schemas.createDefaultAdsChainState).toBe('function'));
        it('exports validateSettings', () => expect(typeof schemas.validateSettings).toBe('function'));
        it('exports ADS_DEFAULT_ENABLED', () => expect(typeof schemas.ADS_DEFAULT_ENABLED).toBe('boolean'));
        it('exports createPendingTx', () => expect(typeof schemas.createPendingTx).toBe('function'));
        it('exports validatePendingTx', () => expect(typeof schemas.validatePendingTx).toBe('function'));
        it('exports createSignerRecord', () => expect(typeof schemas.createSignerRecord).toBe('function'));
        it('exports validateSignerRecord', () => expect(typeof schemas.validateSignerRecord).toBe('function'));
        it('exports SIGNER_KINDS', () => expect(Array.isArray(schemas.SIGNER_KINDS)).toBe(true));
        it('exports createPendingAirdrop', () => expect(typeof schemas.createPendingAirdrop).toBe('function'));
        it('exports validatePendingAirdrop', () => expect(typeof schemas.validatePendingAirdrop).toBe('function'));
        it('exports PENDING_AIRDROP_STAGES', () => expect(Array.isArray(schemas.PENDING_AIRDROP_STAGES)).toBe(true));
        it('exports createWatchlistEntry', () => expect(typeof schemas.createWatchlistEntry).toBe('function'));
        it('exports validateWatchlistEntry', () => expect(typeof schemas.validateWatchlistEntry).toBe('function'));
        it('exports watchlistEntryKey', () => expect(typeof schemas.watchlistEntryKey).toBe('function'));
    });

    describe('migrate exports', () => {
        it('exports migrate', () => expect(typeof schemas.migrate).toBe('function'));
        it('exports migrateWallet', () => expect(typeof schemas.migrateWallet).toBe('function'));
        it('exports migrateAccount', () => expect(typeof schemas.migrateAccount).toBe('function'));
        it('exports migrateAddress', () => expect(typeof schemas.migrateAddress).toBe('function'));
        it('exports migrateContact', () => expect(typeof schemas.migrateContact).toBe('function'));
        it('exports migrateConnectedSite', () => expect(typeof schemas.migrateConnectedSite).toBe('function'));
        it('exports migrateSettings', () => expect(typeof schemas.migrateSettings).toBe('function'));
        it('exports migratePendingTx', () => expect(typeof schemas.migratePendingTx).toBe('function'));
        it('exports migrateMultisigConfig', () => expect(typeof schemas.migrateMultisigConfig).toBe('function'));
        it('exports migrateMultisigSigningSession', () => expect(typeof schemas.migrateMultisigSigningSession).toBe('function'));
        it('exports migrateSigner', () => expect(typeof schemas.migrateSigner).toBe('function'));
        it('exports migratePendingAirdrop', () => expect(typeof schemas.migratePendingAirdrop).toBe('function'));
        it('exports migrateWatchlistEntry', () => expect(typeof schemas.migrateWatchlistEntry).toBe('function'));
    });

    describe('namespace sub-exports', () => {
        it('exports wallet namespace with createWallet', () => {
            expect(typeof schemas.wallet.createWallet).toBe('function');
        });
        it('exports account namespace', () => {
            expect(typeof schemas.account.createAccount).toBe('function');
        });
        it('exports address namespace', () => {
            expect(typeof schemas.address.createAddress).toBe('function');
        });
        it('exports contact namespace', () => {
            expect(typeof schemas.contact.createContact).toBe('function');
        });
        it('exports connectedSite namespace', () => {
            expect(typeof schemas.connectedSite.createConnectedSite).toBe('function');
        });
        it('exports multisigConfig namespace', () => {
            expect(typeof schemas.multisigConfig.buildMultisigConfig).toBe('function');
        });
        it('exports multisigSigningSession namespace', () => {
            expect(typeof schemas.multisigSigningSession.createMultisigSigningSession).toBe('function');
        });
        it('exports settings namespace', () => {
            expect(typeof schemas.settings.createDefaultSettings).toBe('function');
        });
        it('exports pendingTx namespace', () => {
            expect(typeof schemas.pendingTx.createPendingTx).toBe('function');
        });
        it('exports signer namespace', () => {
            expect(typeof schemas.signer.createSignerRecord).toBe('function');
        });
        it('exports pendingAirdrop namespace', () => {
            expect(typeof schemas.pendingAirdrop.createPendingAirdrop).toBe('function');
        });
        it('exports watchlistEntry namespace', () => {
            expect(typeof schemas.watchlistEntry.createWatchlistEntry).toBe('function');
        });
        it('exports migrations namespace', () => {
            expect(typeof schemas.migrations.migrate).toBe('function');
        });
    });
});
