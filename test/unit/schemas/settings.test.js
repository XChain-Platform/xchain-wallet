// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: schemas/settings: createDefaultSettings, createDefaultAdsChainState, validateSettings.

import { describe, it, expect } from 'vitest';
import {
    createDefaultSettings,
    createDefaultAdsChainState,
    validateSettings,
    THEMES,
    FEE_STRATEGIES,
    REDUCED_MOTION_MODES,
    BACKUP_REMINDER_CADENCES,
    WALLET_MODES,
    ADS_DEFAULT_ENABLED,
    CLIPBOARD_AUTO_CLEAR_DEFAULT,
    FORM_DRAFT_TTL_OPTIONS,
    FORM_DRAFT_TTL_OFF,
    FORM_DRAFT_TTL_24H,
    CURRENT_VERSION,
} from '../../../packages/core/src/schemas/settings.js';

describe('constants', () => {
    it('THEMES has system, light, dark', () => {
        expect(THEMES).toContain('system');
        expect(THEMES).toContain('light');
        expect(THEMES).toContain('dark');
    });

    it('FEE_STRATEGIES has low, normal, fast, custom', () => {
        expect(FEE_STRATEGIES).toContain('low');
        expect(FEE_STRATEGIES).toContain('normal');
        expect(FEE_STRATEGIES).toContain('fast');
        expect(FEE_STRATEGIES).toContain('custom');
    });

    it('REDUCED_MOTION_MODES has auto, always, never', () => {
        expect(REDUCED_MOTION_MODES).toContain('auto');
        expect(REDUCED_MOTION_MODES).toContain('always');
        expect(REDUCED_MOTION_MODES).toContain('never');
    });

    it('BACKUP_REMINDER_CADENCES has off, monthly, quarterly', () => {
        expect(BACKUP_REMINDER_CADENCES).toContain('off');
        expect(BACKUP_REMINDER_CADENCES).toContain('monthly');
        expect(BACKUP_REMINDER_CADENCES).toContain('quarterly');
    });

    it('WALLET_MODES has full, watcher, signer', () => {
        expect(WALLET_MODES).toContain('full');
        expect(WALLET_MODES).toContain('watcher');
        expect(WALLET_MODES).toContain('signer');
    });

    it('FORM_DRAFT_TTL_OPTIONS contains 4 entries', () => {
        expect(FORM_DRAFT_TTL_OPTIONS).toHaveLength(4);
        expect(FORM_DRAFT_TTL_OPTIONS).toContain(FORM_DRAFT_TTL_OFF);
        expect(FORM_DRAFT_TTL_OPTIONS).toContain(FORM_DRAFT_TTL_24H);
    });
});

describe('createDefaultSettings', () => {
    it('creates a valid settings object', () => {
        const s = createDefaultSettings();
        expect(s.schemaVersion).toBe(CURRENT_VERSION);
        expect(s.theme).toBe('system');
        expect(s.reducedMotion).toBe('auto');
        expect(s.autolockMinutes).toBe(15);
        expect(s.fiatCurrency).toBe('USD');
        expect(s.language).toBe('en');
        expect(s.developerMode).toBe(false);
        expect(s.learnMode).toBe(false);
        expect(s.ads.enabled).toBe(ADS_DEFAULT_ENABLED);
        expect(s.backupReminders).toBe('off');
        expect(s.walletMode).toBe('full');
        expect(s.activeNetwork).toBe('mainnet');
        expect(s.privacy.clipboardAutoClearSeconds).toBe(CLIPBOARD_AUTO_CLEAR_DEFAULT);
    });

    it('passes validation immediately', () => {
        const r = validateSettings(createDefaultSettings());
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('initializes empty sdkEndpoints and fees', () => {
        const s = createDefaultSettings();
        expect(s.sdkEndpoints).toEqual({});
        expect(s.fees).toEqual({});
    });

    it('initializes empty pinnedTokens and hiddenTokens', () => {
        const s = createDefaultSettings();
        expect(s.pinnedTokens).toEqual([]);
        expect(s.hiddenTokens).toEqual([]);
    });
});

describe('createDefaultAdsChainState', () => {
    it('creates expected defaults', () => {
        const a = createDefaultAdsChainState();
        expect(a.perTxAmountSats).toBe(1);
        expect(a.triggerAmountSats).toBe(1000);
        expect(a.accumulatedSats).toBe(0);
        expect(a.lifetimeDonatedSats).toBe(0);
        expect(a.lifetimeTxCount).toBe(0);
    });
});

describe('validateSettings', () => {
    it('accepts default settings', () => {
        const r = validateSettings(createDefaultSettings());
        expect(r.ok).toBe(true);
    });

    it('rejects non-object input', () => {
        expect(validateSettings(null).ok).toBe(false);
        expect(validateSettings('x').ok).toBe(false);
    });

    it('rejects wrong schemaVersion', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, schemaVersion: 99 });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('schemaVersion'))).toBe(true);
    });

    it('rejects invalid theme', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, theme: 'plasma' });
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('theme'))).toBe(true);
    });

    it('accepts all valid themes', () => {
        const s = createDefaultSettings();
        for (const theme of THEMES) {
            expect(validateSettings({ ...s, theme }).ok).toBe(true);
        }
    });

    it('rejects invalid reducedMotion', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, reducedMotion: 'sometimes' });
        expect(r.ok).toBe(false);
    });

    it('accepts all valid reducedMotion values', () => {
        const s = createDefaultSettings();
        for (const reducedMotion of REDUCED_MOTION_MODES) {
            expect(validateSettings({ ...s, reducedMotion }).ok).toBe(true);
        }
    });

    it('rejects non-integer autolockMinutes', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, autolockMinutes: 1.5 }).ok).toBe(false);
    });

    it('rejects negative autolockMinutes', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, autolockMinutes: -1 }).ok).toBe(false);
    });

    it('rejects empty fiatCurrency', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, fiatCurrency: '' }).ok).toBe(false);
    });

    it('rejects empty language', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, language: '' }).ok).toBe(false);
    });

    it('rejects malformed sdkEndpoints', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, sdkEndpoints: { chain1: { explorerUrl: 'x', encoderUrl: 'y', hubUrl: 'z', custom: 'yes' } } });
        expect(r.ok).toBe(false);
    });

    it('accepts valid sdkEndpoints', () => {
        const s = createDefaultSettings();
        const r = validateSettings({
            ...s,
            sdkEndpoints: {
                'bitcoin-mainnet': { explorerUrl: 'https://e.com', encoderUrl: 'https://enc.com', hubUrl: 'https://hub.com', custom: false },
            },
        });
        expect(r.ok).toBe(true);
    });

    it('rejects malformed fees', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, fees: { BTC: { strategy: 'turbo', customSatsPerKb: null, rbfByDefault: true } } });
        expect(r.ok).toBe(false);
    });

    it('accepts valid fees', () => {
        const s = createDefaultSettings();
        const r = validateSettings({
            ...s,
            fees: { BTC: { strategy: 'normal', customSatsPerKb: null, rbfByDefault: true } },
        });
        expect(r.ok).toBe(true);
    });

    it('rejects missing privacy.torRouting', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, torRouting: 'yes' } });
        expect(r.ok).toBe(false);
    });

    it('rejects out-of-range clipboardAutoClearSeconds', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, clipboardAutoClearSeconds: 601 } });
        expect(r.ok).toBe(false);
    });

    it('accepts clipboardAutoClearSeconds=0', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, clipboardAutoClearSeconds: 0 } });
        expect(r.ok).toBe(true);
    });

    it('accepts missing clipboardAutoClearSeconds (v2-tolerant)', () => {
        const s = createDefaultSettings();
        const { clipboardAutoClearSeconds, ...privacyWithout } = s.privacy;
        const r = validateSettings({ ...s, privacy: privacyWithout });
        expect(r.ok).toBe(true);
    });

    it('rejects non-boolean hapticsEnabled when present', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, hapticsEnabled: 'yes' } });
        expect(r.ok).toBe(false);
    });

    it('accepts missing hapticsEnabled (v2-tolerant)', () => {
        const s = createDefaultSettings();
        const { hapticsEnabled, ...privacyWithout } = s.privacy;
        const r = validateSettings({ ...s, privacy: privacyWithout });
        expect(r.ok).toBe(true);
    });

    it('rejects non-boolean alwaysRequireHwExplicitConfirm when present', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, alwaysRequireHwExplicitConfirm: 1 } });
        expect(r.ok).toBe(false);
    });

    it('accepts alwaysRequireHwExplicitConfirm=true', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, alwaysRequireHwExplicitConfirm: true } });
        expect(r.ok).toBe(true);
    });

    it('rejects non-boolean priceDataEnabled when present', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, priceDataEnabled: 'yes' } });
        expect(r.ok).toBe(false);
    });

    it('accepts priceDataEnabled=false', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, priceDataEnabled: false } });
        expect(r.ok).toBe(true);
    });

    it('accepts missing metadataFetchEnabled (v2-tolerant)', () => {
        const s = createDefaultSettings();
        const { metadataFetchEnabled, ...privacyWithout } = s.privacy;
        const r = validateSettings({ ...s, privacy: privacyWithout });
        expect(r.ok).toBe(true);
    });

    it('accepts valid formDraftTtlMs', () => {
        const s = createDefaultSettings();
        for (const val of FORM_DRAFT_TTL_OPTIONS) {
            expect(validateSettings({ ...s, privacy: { ...s.privacy, formDraftTtlMs: val } }).ok).toBe(true);
        }
    });

    it('rejects invalid formDraftTtlMs value', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, privacy: { ...s.privacy, formDraftTtlMs: 99999 } });
        expect(r.ok).toBe(false);
    });

    it('rejects malformed ads', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, ads: null }).ok).toBe(false);
    });

    it('rejects ads.enabled non-boolean', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, ads: { ...s.ads, enabled: 'yes' } }).ok).toBe(false);
    });

    it('accepts valid ads.perChain entry', () => {
        const s = createDefaultSettings();
        const r = validateSettings({
            ...s,
            ads: {
                ...s.ads,
                perChain: {
                    'bitcoin-mainnet': { perTxAmountSats: 1, triggerAmountSats: 1000, accumulatedSats: 0, lifetimeDonatedSats: 0, lifetimeTxCount: 0 },
                },
            },
        });
        expect(r.ok).toBe(true);
    });

    it('rejects malformed notifications', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, notifications: null }).ok).toBe(false);
    });

    it('rejects non-boolean developerMode', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, developerMode: 1 }).ok).toBe(false);
    });

    it('rejects malformed grace', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, grace: null }).ok).toBe(false);
    });

    it('rejects negative grace.undoSendSeconds', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, grace: { ...s.grace, undoSendSeconds: -1 } }).ok).toBe(false);
    });

    it('rejects malformed panicMode', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, panicMode: null }).ok).toBe(false);
    });

    it('rejects invalid backupReminders', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, backupReminders: 'weekly' });
        expect(r.ok).toBe(false);
    });

    it('accepts all valid backupReminders values', () => {
        const s = createDefaultSettings();
        for (const cadence of BACKUP_REMINDER_CADENCES) {
            expect(validateSettings({ ...s, backupReminders: cadence }).ok).toBe(true);
        }
    });

    it('rejects invalid pinnedTokens when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, pinnedTokens: [42] }).ok).toBe(false);
    });

    it('accepts valid pinnedTokens', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, pinnedTokens: ['bitcoin-mainnet:BTC'] }).ok).toBe(true);
    });

    it('accepts missing pinnedTokens (optional)', () => {
        const s = createDefaultSettings();
        const { pinnedTokens, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects invalid hiddenTokens when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, hiddenTokens: [null] }).ok).toBe(false);
    });

    it('accepts missing hiddenTokens (optional)', () => {
        const s = createDefaultSettings();
        const { hiddenTokens, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects non-boolean showPinAffordance when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, showPinAffordance: 1 }).ok).toBe(false);
    });

    it('accepts missing showPinAffordance', () => {
        const s = createDefaultSettings();
        const { showPinAffordance, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects non-boolean showHideAffordance when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, showHideAffordance: 'yes' }).ok).toBe(false);
    });

    it('accepts missing showHideAffordance', () => {
        const s = createDefaultSettings();
        const { showHideAffordance, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects non-boolean autoApproveLocalhost when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, autoApproveLocalhost: 1 }).ok).toBe(false);
    });

    it('accepts autoApproveLocalhost=true', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, autoApproveLocalhost: true }).ok).toBe(true);
    });

    it('accepts missing autoApproveLocalhost', () => {
        const s = createDefaultSettings();
        const { autoApproveLocalhost, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects invalid blockedOrigins when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, blockedOrigins: [42] }).ok).toBe(false);
    });

    it('accepts valid blockedOrigins', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, blockedOrigins: ['https://bad.com'] }).ok).toBe(true);
    });

    it('accepts missing blockedOrigins', () => {
        const s = createDefaultSettings();
        const { blockedOrigins, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects invalid blocklistAuditLog when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, blocklistAuditLog: [{ at: 'bad', action: 'add', entry: 'x' }] }).ok).toBe(false);
    });

    it('accepts valid blocklistAuditLog', () => {
        const s = createDefaultSettings();
        const r = validateSettings({
            ...s,
            blocklistAuditLog: [{ at: Date.now(), action: 'add', entry: 'https://x.com' }],
        });
        expect(r.ok).toBe(true);
    });

    it('accepts blocklistAuditLog with optional evictedSiteIds', () => {
        const s = createDefaultSettings();
        const r = validateSettings({
            ...s,
            blocklistAuditLog: [{ at: Date.now(), action: 'add', entry: 'x', evictedSiteIds: ['id1'] }],
        });
        expect(r.ok).toBe(true);
    });

    it('rejects blocklistAuditLog with invalid action', () => {
        const s = createDefaultSettings();
        const r = validateSettings({
            ...s,
            blocklistAuditLog: [{ at: Date.now(), action: 'update', entry: 'x' }],
        });
        expect(r.ok).toBe(false);
    });

    it('accepts missing blocklistAuditLog', () => {
        const s = createDefaultSettings();
        const { blocklistAuditLog, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects invalid signThrottle.burst', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, signThrottle: { burst: 0 } }).ok).toBe(false);
    });

    it('accepts valid signThrottle', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, signThrottle: { burst: 10, windowMs: 60000 } }).ok).toBe(true);
    });

    it('accepts signThrottle with only burst', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, signThrottle: { burst: 5 } }).ok).toBe(true);
    });

    it('rejects signThrottle.windowMs out of range', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, signThrottle: { windowMs: 100 } }).ok).toBe(false);
    });

    it('accepts missing signThrottle', () => {
        const s = createDefaultSettings();
        const { signThrottle, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects invalid walletMode when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, walletMode: 'observer' }).ok).toBe(false);
    });

    it('accepts all valid walletModes', () => {
        const s = createDefaultSettings();
        for (const walletMode of WALLET_MODES) {
            expect(validateSettings({ ...s, walletMode }).ok).toBe(true);
        }
    });

    it('accepts missing walletMode', () => {
        const s = createDefaultSettings();
        const { walletMode, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects invalid activeNetwork when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, activeNetwork: 'devnet' }).ok).toBe(false);
    });

    it('accepts all valid activeNetwork values', () => {
        const s = createDefaultSettings();
        for (const net of ['mainnet', 'testnet', 'regtest']) {
            expect(validateSettings({ ...s, activeNetwork: net }).ok).toBe(true);
        }
    });

    it('accepts missing activeNetwork', () => {
        const s = createDefaultSettings();
        const { activeNetwork, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects invalid customChains when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, customChains: ['not-an-object'] }).ok).toBe(false);
    });

    it('accepts valid customChains array of objects', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, customChains: [{ id: 'custom-1', name: 'CustomChain' }] }).ok).toBe(true);
    });

    it('accepts missing customChains', () => {
        const s = createDefaultSettings();
        const { customChains, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('rejects non-boolean showFiatInHistory when present', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, showFiatInHistory: 'yes' }).ok).toBe(false);
    });

    it('accepts showFiatInHistory=true', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, showFiatInHistory: true }).ok).toBe(true);
    });

    it('accepts missing showFiatInHistory', () => {
        const s = createDefaultSettings();
        const { showFiatInHistory, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('defaults showFiatInHistory to false', () => {
        expect(createDefaultSettings().showFiatInHistory).toBe(false);
    });

    it('rejects malformed quietHours', () => {
        const s = createDefaultSettings();
        expect(validateSettings({ ...s, quietHours: { enabled: true, start: '25:00', end: '08:00' } }).ok).toBe(false);
        expect(validateSettings({ ...s, quietHours: { enabled: 'yes', start: '22:00', end: '08:00' } }).ok).toBe(false);
        expect(validateSettings({ ...s, quietHours: { enabled: true, start: '22:00' } }).ok).toBe(false);
    });

    it('accepts valid quietHours', () => {
        const s = createDefaultSettings();
        const r = validateSettings({ ...s, quietHours: { enabled: true, start: '22:00', end: '08:00' } });
        expect(r.ok).toBe(true);
    });

    it('accepts missing quietHours', () => {
        const s = createDefaultSettings();
        const { quietHours, ...without } = s;
        expect(validateSettings(without).ok).toBe(true);
    });

    it('defaults quietHours to disabled 22:00-08:00', () => {
        const s = createDefaultSettings();
        expect(s.quietHours).toEqual({ enabled: false, start: '22:00', end: '08:00' });
    });
});
