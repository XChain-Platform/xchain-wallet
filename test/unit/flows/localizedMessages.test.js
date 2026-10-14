// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

import {
    describeBiometric,
    setBiometricProvider,
} from '../../../packages/core/src/flows/biometricUnlock.js';
import { dispenserAddressVerdict } from '../../../packages/core/src/flows/dispenserAddressStanding.js';
import { describePairingLane } from '../../../packages/core/src/flows/pairPartner.js';
import { protocolFeeRowCopy } from '../../../packages/core/src/flows/protocolFeeRow.js';
import { isEntryReplaceable } from '../../../packages/core/src/flows/rbfReplace.js';
import { classifySignRisk } from '../../../packages/core/src/flows/signRiskClassifier.js';
import { checkPasteIntegrity } from '../../../packages/core/src/shared/utils/pasteIntegrity.js';
import {
    registerLocale,
    setLocale,
} from '../../../packages/core/src/i18n/index.js';

const LOCALE = 'unit-flow-messages';

beforeAll(async () => {
    registerLocale(LOCALE, {
        'flows.biometric.genericUnavailable': 'translated biometric status',
        'flows.dispenserAddress.self': 'translated dispenser status',
        'flows.pairPartner.pairSigner': 'translated pairing action',
        'flows.pairPartner.watcherHelp': 'translated pairing help',
        'flows.protocolFee.freeLabel': 'translated fee label',
        'flows.protocolFee.freeHint': 'translated fee status',
        'flows.rbf.noEntry': 'translated replacement error',
        'flows.signRisk.firstRecipient': 'translated signing warning',
        'flows.pasteIntegrity.changed': 'translated clipboard warning',
    });
    await setLocale(LOCALE);
});

afterAll(async () => {
    setBiometricProvider(null);
    await setLocale('en');
});

describe('flow messages use the active locale', () => {
    it('localizes biometric availability status', async () => {
        setBiometricProvider({
            name: 'unit-provider',
            describe: vi.fn().mockResolvedValue({ supported: false }),
            isSupported: vi.fn().mockResolvedValue(false),
            isRegistered: vi.fn().mockReturnValue(false),
            register: vi.fn(),
            unlock: vi.fn(),
            clear: vi.fn(),
        });

        await expect(describeBiometric()).resolves.toMatchObject({
            supported: false,
            reason: 'translated biometric status',
        });
    });

    it('localizes dispenser address verdicts', () => {
        expect(dispenserAddressVerdict({
            address: 'source',
            source: 'source',
            preference: null,
            seen: null,
            origin: null,
        }).message).toBe('translated dispenser status');
    });

    it('localizes pairing lane status', () => {
        expect(describePairingLane('watcher')).toMatchObject({
            cta: 'translated pairing action',
            help: 'translated pairing help',
        });
    });

    it('localizes protocol fee status', () => {
        expect(protocolFeeRowCopy({ fee: 0, coinTicker: 'BTC' })).toMatchObject({
            label: 'translated fee label',
            hint: 'translated fee status',
        });
    });

    it('localizes replacement eligibility errors', () => {
        expect(isEntryReplaceable(null).reason).toBe('translated replacement error');
    });

    it('localizes signing risk warnings', () => {
        expect(classifySignRisk({ signerKind: 'ledger', recipientNovel: true }).reason)
            .toBe('translated signing warning');
    });

    it('localizes clipboard integrity warnings', async () => {
        const result = await checkPasteIntegrity({
            pastedText: 'expected',
            clipboard: { readText: vi.fn().mockResolvedValue('changed') },
        });

        expect(result.reason).toBe('translated clipboard warning');
    });
});
