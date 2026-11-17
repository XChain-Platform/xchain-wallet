// G121: a help (?) icon appears only beside an editable form field, never on
// read-only facts. These sites once rendered an InfoTip on a read-only row.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p) => readFileSync(`packages/core/src/shared/${p}`, 'utf8');

describe('no help icon on read-only fact rows (G121)', () => {
    it('Execute callback facts have no InfoTip', () => {
        expect(read('routes/CallbackForm.jsx')).not.toMatch(/<InfoTip/);
    });

    it('Derivation path cross-check has no InfoTip', () => {
        expect(read('components/DerivationPathCrossCheck.jsx')).not.toMatch(/<InfoTip/);
    });

    it('Raw PSBT viewer and Watcher export code boxes have no InfoTip', () => {
        expect(read('components/RawPsbtViewer.jsx')).not.toMatch(/<InfoTip/);
        expect(read('components/WatcherExport.jsx')).not.toMatch(/<InfoTip/);
    });

    it('Sign message signature box has no InfoTip', () => {
        expect(read('routes/SignMessageForm.jsx')).not.toMatch(/<InfoTip/);
    });

    it('Create list merged-membership estimate has no membership InfoTip', () => {
        expect(read('routes/ListCreateForm.jsx')).not.toContain('About the membership estimate');
    });

    it('the poll votes and voters line has no ballot InfoTip; the editor keeps its own', () => {
        const source = read('routes/PollDetail.jsx');
        expect(source).not.toContain('const ballotTip');
        expect(source.match(/aria="About ballot choices"/g)).toHaveLength(1);
    });
});
