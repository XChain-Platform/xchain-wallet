// Ledger transport factory — web-app target. Same WebHID pattern as
// the extension (§18.2 treats them as one case). Cross-package
// relative import keeps the implementation single-sourced.

export {
    getLedgerTransport,
    pairLedgerSigner,
    resetLedgerTransport,
} from '../../../extension/src/signers/ledgerFactory.js';
