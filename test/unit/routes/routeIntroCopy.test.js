// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRoute = (name) => readFileSync(`packages/core/src/shared/routes/${name}`, 'utf8');

describe('route intro copy', () => {
    it.each([
        ['OracleForm.jsx', 'An oracle publishes what one unit of a token is worth'],
        ['PairPartnerWallet.jsx', 'Pick which one this device is.'],
        ['PairPartnerWallet.jsx', 'Show this code to the other wallet, then bring its code back here.'],
        ['PairSignerForm.jsx', 'Which kind of device are you pairing?'],
        ['PairSignerForm.jsx', 'Confirm the device you just paired.'],
        ['ParallelComposer.jsx', 'Compose any number of independent actions'],
        ['PollDetail.jsx', 'Vote on poll #{String(pollIndex)}'],
        ['ProjectRosterForm.jsx', "on-chain seal of\n                approval"],
        ['PublishFileForm.jsx', 'Store a file on the chain itself'],
        ['SellOwnershipForm.jsx', "You're selling the entire ownership"],
        ['StakeNew.jsx', "t('stakeNew.prompt')"],
        ['TokenWizard.jsx', 'intro="Choose a template."'],
        ['TokenWizard.jsx', "intro=\"Which chain should record this token's issuance?\""],
        ['TokenWizard.jsx', 'intro={<>Template:'],
    ])('%s omits the repeated top-of-screen copy', (file, copy) => {
        expect(readRoute(file)).not.toContain(copy);
    });

    it('keeps useful guidance in compact disclosures or field hints', () => {
        const oracle = readRoute('OracleForm.jsx');
        const pairing = readRoute('PairPartnerWallet.jsx');
        const roster = readRoute('ProjectRosterForm.jsx');
        const signer = readRoute('SignerSelectForm.jsx');

        expect(oracle).toContain('<InfoTip label={`Dispensers can use an oracle');
        expect(pairing).toContain('hint={lane.help}');
        expect(pairing).toContain('<InfoTip label="Pairing codes contain public keys only');
        expect(roster).toContain('official-token list show an "Official" badge in explorers and wallets');
        expect(signer).toContain('<InfoTip label={t(\'signerSelect.intro\')} />');
    });

    it('retains irreversible-action and fee safety copy', () => {
        expect(readRoute('ParallelComposer.jsx')).toContain('<strong>No rollback:</strong>');
        expect(readRoute('PublishFileForm.jsx')).toContain('Permanent: the published bytes live on-chain forever');
        expect(readRoute('OracleForm.jsx')).toContain('typedConfirmationCopy.oracle(');
        expect(readFileSync('packages/core/src/i18n/locales/en/common.js', 'utf8'))
            .toContain('cannot be undone for 24 hours');
        expect(readRoute('SellOwnershipForm.jsx')).toContain('label="Network fee"');
    });
});
