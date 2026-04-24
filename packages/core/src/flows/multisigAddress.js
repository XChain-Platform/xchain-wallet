// multisigAddress — Phase 4 Step 18 wrapper. Reads the persisted
// MultisigConfig off a Wallet record, dispatches to
// `sdk.deriveMultisigAddress` (xchain-sdk 1.11+), and returns the
// rendered multisig address along with metadata the Receive surface
// needs (N-of-M label, scheme tag, cosigner names).
//
// Pure read — no signing, no PSBT construction. The wallet.multisig
// field is the source of truth for the address computation: the
// scriptTemplate persisted at MultisigConfig creation time (Step 17)
// drives the address render here.
//
// chainId selects the network for address encoding (bech32 prefix
// for P2WSH/P2TR; version bytes for P2SH base58check). Multisig is
// BTC-only at launch per §22 + §10.3.

/**
 * @typedef {Object} ReceiveMultisigAddressOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} walletId
 * @property {string} chainId
 */

/**
 * @typedef {Object} ReceiveMultisigAddressResult
 * @property {string} address
 * @property {'p2sh-multisig' | 'p2wsh-multisig' | 'taproot-musig2'} scheme
 * @property {number} threshold
 * @property {number} cosignerCount
 * @property {string[]} cosignerNames
 * @property {string} schemeLabel              human-readable: "2-of-3 P2WSH multisig"
 * @property {string | null} redeemScript      hex; populated for p2sh-multisig
 * @property {string | null} witnessScript     hex; populated for p2wsh-multisig
 * @property {string | null} outputPubkey      hex; populated for taproot-musig2
 */

/**
 * @param {ReceiveMultisigAddressOpts} opts
 * @returns {Promise<ReceiveMultisigAddressResult>}
 */
export async function receiveMultisigAddress(opts) {
    if (!opts) throw new Error('receiveMultisigAddress: opts is required');
    if (!opts.vault) throw new Error('receiveMultisigAddress: vault is required');
    if (!opts.sdkRegistry) throw new Error('receiveMultisigAddress: sdkRegistry is required');
    if (typeof opts.walletId !== 'string' || opts.walletId.length === 0) {
        throw new Error('receiveMultisigAddress: walletId is required');
    }
    if (typeof opts.chainId !== 'string' || opts.chainId.length === 0) {
        throw new Error('receiveMultisigAddress: chainId is required');
    }

    const wallet = await opts.vault.wallets.get(opts.walletId);
    if (!wallet) {
        throw new Error(`receiveMultisigAddress: wallet "${opts.walletId}" not found`);
    }
    const config = wallet.multisig;
    if (!config) {
        throw new Error(
            `receiveMultisigAddress: wallet "${opts.walletId}" has no multisig configuration — run the §22 coordinator first`,
        );
    }

    const sdk = opts.sdkRegistry.get(opts.chainId);
    if (!sdk) {
        throw new Error(`receiveMultisigAddress: no SDK registered for chainId "${opts.chainId}"`);
    }
    if (typeof sdk.deriveMultisigAddress !== 'function') {
        throw new Error(
            'receiveMultisigAddress: sdk.deriveMultisigAddress is unavailable — bump xchain-sdk to ^1.11.0',
        );
    }

    const derived = sdk.deriveMultisigAddress({
        scriptTemplate: config.scriptTemplate,
        scheme: config.scheme,
    });
    if (!derived || typeof derived.address !== 'string' || derived.address.length === 0) {
        throw new Error('receiveMultisigAddress: SDK returned no address');
    }

    return {
        address:        derived.address,
        scheme:         config.scheme,
        threshold:      config.threshold,
        cosignerCount:  config.cosigners.length,
        cosignerNames:  config.cosigners.map((c) => c.name),
        schemeLabel:    formatSchemeLabel(config),
        redeemScript:   derived.redeemScript || null,
        witnessScript:  derived.witnessScript || null,
        outputPubkey:   derived.outputPubkey || null,
    };
}

function formatSchemeLabel(config) {
    const t = config.threshold;
    const n = config.cosigners.length;
    if (config.scheme === 'p2sh-multisig') return `${t}-of-${n} P2SH multisig`;
    if (config.scheme === 'p2wsh-multisig') return `${t}-of-${n} P2WSH multisig`;
    return `${t}-of-${n} Taproot-MuSig2`;
}
