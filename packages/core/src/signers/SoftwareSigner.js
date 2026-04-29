// SoftwareSigner — §17.2. Wraps the wallet's HD seed plus any imported
// WIFs. Unlock decrypts the seed blob with Argon2id + AES-GCM; HD
// derivation uses BIP32 over the chain registry's path templates.
// Address encoding, PSBT signing, and message signing are delegated to
// `xchain-sdk` and stay stubbed until SDKRegistry lands (§10.2).

import { decryptWalletSeed } from '../crypto/walletBlob.js';
import { decrypt } from '../crypto/aead.js';
import { base64ToBytes, deriveMasterKey } from '../crypto/kdf.js';
import {
    bip39MnemonicToSeed,
    isValidBip39Mnemonic,
} from '../crypto/mnemonic.js';
import {
    counterwalletMnemonicToSeedBytes,
    isValidCounterwalletMnemonic,
} from '../crypto/counterwallet.js';
import { sha256 } from '@noble/hashes/sha2';
import { derive, hdKeyFromSeed, zeroDerivedKey } from '../crypto/hd.js';
import { encodeWif } from '../crypto/wif.js';
import {
    NotImplementedError,
    Signer,
    SignerLockedError,
} from './Signer.js';
import { logConsole } from '../shared/utils/logConsole.js';

/**
 * @typedef {Object} WalletEncryptionInputs
 * @property {string} encryptedSeed                         base64 ciphertext from Wallet.encryptedSeed; empty string legal when format='wif-only'
 * @property {import('../crypto/kdf.js').KdfParams} kdfParams
 * @property {Uint8Array} [aad]                             extra authenticated data passed at encrypt time
 * @property {boolean} [passphraseEnabled]                  §15.6 — BIP39 passphrase required at unlock (BIP39 only)
 * @property {'bip39' | 'counterwallet-legacy' | 'wif-only'} [format]    Wallet.format; defaults to 'bip39'
 * @property {Array<{ encryptedWif: string }>} [importedKeys]            §15.4 — wif-only unlock validates password by decrypting the first entry
 */

/**
 * @typedef {Object} UnlockedState
 * @property {Uint8Array} mnemonicBytes   UTF-8 bytes of the decrypted BIP39 mnemonic (empty for wif-only)
 * @property {Uint8Array} seed            64-byte BIP39 seed; empty for wif-only
 * @property {Map<string, Uint8Array>} importedWifs   decrypted WIFs keyed by addressId (bytes, so we can zero on lock)
 */

export class SoftwareSigner extends Signer {
    /**
     * @param {Object} opts
     * @param {string} opts.id
     * @param {string} opts.displayName
     * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
     * @param {WalletEncryptionInputs} opts.walletEncryption
     * @param {import('../sdk/index.js').SDKRegistry} [opts.sdkRegistry]   optional; required for getAddresses / signPsbt / signMessage
     */
    constructor({ id, displayName, chainRegistry, walletEncryption, sdkRegistry }) {
        super();
        this._id = id;
        this._displayName = displayName;
        this._chainRegistry = chainRegistry;
        this._walletEncryption = walletEncryption;
        this._sdkRegistry = sdkRegistry;
        /** @type {'available' | 'locked'} */
        this._status = 'locked';
        /** @type {UnlockedState | null} */
        this._unlocked = null;
    }

    get id() {
        return this._id;
    }

    get displayName() {
        return this._displayName;
    }

    get kind() {
        return 'software';
    }

    get requiresPhysicalConfirmation() {
        return false;
    }

    async getStatus() {
        return this._status;
    }

    /**
     * Decrypt the wallet's seed blob, validate the resulting mnemonic,
     * and produce a seed suitable for BIP32. Routing by
     * `walletEncryption.format`:
     *
     *   - `'bip39'` (default) — PBKDF2-stretched 64-byte seed via
     *     BIP39, with the optional 25th-word passphrase (§15.6).
     *   - `'counterwallet-legacy'` — 16-byte raw seed via §15.2. No
     *     passphrase concept; BIP39 passphrase must be omitted.
     *
     * Throws on bad password (the AEAD tag check fails) or if the
     * plaintext is not a valid mnemonic in the declared format.
     *
     * @param {Object} opts
     * @param {string} opts.password
     * @param {string} [opts.bip39Passphrase]   required iff format='bip39' and passphraseEnabled
     */
    async unlock({ password, bip39Passphrase = '' }) {
        if (typeof password !== 'string' || password.length === 0) {
            throw new Error('SoftwareSigner.unlock: password is required');
        }
        const enc = this._walletEncryption;
        const format = enc.format ?? 'bip39';
        if (format === 'bip39' && enc.passphraseEnabled && bip39Passphrase.length === 0) {
            throw new Error('SoftwareSigner.unlock: bip39Passphrase is required');
        }
        if (format === 'counterwallet-legacy' && bip39Passphrase.length > 0) {
            throw new Error(
                'SoftwareSigner.unlock: counterwallet-legacy wallets do not support a BIP39 passphrase',
            );
        }
        if (format === 'wif-only' && bip39Passphrase.length > 0) {
            throw new Error(
                'SoftwareSigner.unlock: wif-only wallets have no mnemonic and do not accept a BIP39 passphrase',
            );
        }

        // wif-only wallets have no seed to decrypt. We still derive the
        // master key from the password and decrypt every importedKey
        // entry; the first one's decrypt also doubles as the password
        // probe (if it fails, the AEAD tag check surfaces the same way
        // seed-decrypt failure does for seed-backed wallets).
        if (format === 'wif-only') {
            const imported = enc.importedKeys ?? [];
            if (imported.length === 0) {
                throw new Error(
                    'SoftwareSigner.unlock: wif-only wallet has no importedKeys to validate against',
                );
            }
            const masterKey = deriveMasterKey(password, enc.kdfParams);
            let importedWifs;
            try {
                importedWifs = await decryptImportedKeys(masterKey, imported);
            } finally {
                masterKey.fill(0);
            }
            this._acceptUnlockedState({
                mnemonicBytes: new Uint8Array(0),
                seed: new Uint8Array(0),
                importedWifs,
            });
            logConsole.record({
                source: 'signer:software',
                level: 'info',
                message: `unlock id=${this._id} format=wif-only`,
            });
            return;
        }

        const plaintext = await decryptWalletSeed({
            password,
            encryptedSeed: enc.encryptedSeed,
            kdfParams: enc.kdfParams,
            aad: enc.aad,
        });

        const mnemonic = new TextDecoder().decode(plaintext);

        let seed;
        if (format === 'bip39') {
            if (!isValidBip39Mnemonic(mnemonic)) {
                plaintext.fill(0);
                throw new Error('SoftwareSigner.unlock: decrypted blob is not a valid BIP39 mnemonic');
            }
            seed = await bip39MnemonicToSeed(mnemonic, bip39Passphrase);
        } else if (format === 'counterwallet-legacy') {
            if (!isValidCounterwalletMnemonic(mnemonic)) {
                plaintext.fill(0);
                throw new Error(
                    'SoftwareSigner.unlock: decrypted blob is not a valid Counterwallet mnemonic',
                );
            }
            seed = counterwalletMnemonicToSeedBytes(mnemonic);
        } else {
            plaintext.fill(0);
            throw new Error(`SoftwareSigner.unlock: unsupported wallet format "${format}"`);
        }

        // Seed-backed wallets can also carry importedKeys (§15.5 — WIFs
        // imported INTO an existing HD wallet). Decrypt them now so
        // signPsbt / signMessage / exportWifForAddress can route to
        // them without a second KDF round.
        let importedWifs;
        const importedRecords = enc.importedKeys ?? [];
        if (importedRecords.length > 0) {
            const masterKey = deriveMasterKey(password, enc.kdfParams);
            try {
                importedWifs = await decryptImportedKeys(masterKey, importedRecords);
            } finally {
                masterKey.fill(0);
            }
        } else {
            importedWifs = new Map();
        }

        this._acceptUnlockedState({
            mnemonicBytes: plaintext,
            seed,
            importedWifs,
        });
        logConsole.record({
            source: 'signer:software',
            level: 'info',
            message: `unlock id=${this._id} format=${format}`,
        });
    }

    /** Zero the in-memory seed and flip back to locked. */
    lock() {
        if (this._unlocked) {
            this._unlocked.seed.fill(0);
            this._unlocked.mnemonicBytes.fill(0);
            for (const wif of this._unlocked.importedWifs.values()) wif.fill(0);
            this._unlocked = null;
        }
        if (this._status !== 'locked') {
            this._status = 'locked';
            this._emitStatus('locked');
            logConsole.record({
                source: 'signer:software',
                level: 'info',
                message: `lock id=${this._id}`,
            });
        }
    }

    /**
     * Internal hook used by `unlock` (and tests) to install decrypted
     * material. Not part of the public Signer API.
     *
     * @param {UnlockedState} state
     * @internal
     */
    _acceptUnlockedState(state) {
        this._unlocked = state;
        this._status = 'available';
        this._emitStatus('available');
    }

    _assertUnlocked() {
        if (this._status !== 'available' || !this._unlocked) {
            throw new SignerLockedError(this._id);
        }
    }

    /**
     * Derive addresses under (chainId, accountIndex, change) for the
     * given contiguous index range. Address encoding is delegated to
     * `sdk.wallet.deriveAddress` via the injected SDKRegistry (§10.2).
     *
     * @param {import('./Signer.js').GetAddressesParams} params
     * @returns {Promise<import('./Signer.js').DerivedAddress[]>}
     */
    async getAddresses({ chainId, accountIndex, change, startIndex, count, addressType }) {
        this._assertUnlocked();
        this._assertSdkRegistry('getAddresses');
        const descriptor = this._chainRegistry.get(chainId);
        if (!descriptor) {
            throw new Error(`SoftwareSigner.getAddresses: unknown chain "${chainId}"`);
        }
        const type = addressType ?? descriptor.defaultAddressType;
        if (!descriptor.addressTypes.includes(type)) {
            throw new Error(
                `SoftwareSigner.getAddresses: addressType "${type}" not supported on ${chainId}`,
            );
        }
        const sdk = this._sdkRegistry.get(chainId);
        const root = hdKeyFromSeed(this._unlocked.seed);
        /** @type {import('./Signer.js').DerivedAddress[]} */
        const out = [];
        for (let i = 0; i < count; i++) {
            const index = startIndex + i;
            const path = this._chainRegistry.derivationPathFor(chainId, type, accountIndex, change, index);
            if (!path) {
                throw new Error(
                    `SoftwareSigner.getAddresses: no derivation path for ${chainId}/${type}`,
                );
            }
            const dk = derive(root, path);
            try {
                const address = sdk.wallet.deriveAddress(dk.publicKeyHex, { type });
                out.push({ index, address, publicKey: dk.publicKeyHex, path });
            } finally {
                zeroDerivedKey(dk);
            }
        }
        return out;
    }

    /**
     * Sign a PSBT. All inputs are signed by a single key; that key is
     * identified by either `path` (HD) or `addressId` (imported-WIF).
     * Multi-key signing (different paths across inputs) is a future
     * enhancement.
     *
     * @param {import('./Signer.js').SignPsbtParams} params
     * @returns {Promise<import('./Signer.js').SignPsbtReturn>}
     */
    async signPsbt({ psbtHex, chainId, signingPaths }) {
        this._assertUnlocked();
        this._assertSdkRegistry('signPsbt');
        if (!Array.isArray(signingPaths) || signingPaths.length === 0) {
            throw new Error('SoftwareSigner.signPsbt: signingPaths must be non-empty');
        }
        assertSameSigningSource(signingPaths, 'signPsbt');
        const entry = signingPaths[0];
        const wif = this._resolveWifForEntry(chainId, entry);
        const sdk = this._sdkRegistry.get(chainId);
        const { txHex, txid, psbtHex: signedPsbtHex } = sdk.wallet.signPsbt(psbtHex, wif);
        logConsole.record({
            source: 'signer:software',
            level: 'info',
            message: `signPsbt chain=${chainId} txid=${txid ?? '?'}`,
        });
        return { signedPsbtHex, txHex, txid };
    }

    /**
     * Sign a message via `sdk.auth.signMessage`. Key identified by
     * either `path` (HD) or `addressId` (imported-WIF).
     *
     * For HD keys the signature format must match the address's script
     * type, so we route `segwitNative` / `segwitRedeemScript` from the
     * BIP44 purpose number in the path (44 = p2pkh, 49 = p2sh-p2wpkh,
     * 84 = p2wpkh). p2tr (86) is not supported by the SDK's
     * bitcoinjs-message-based signer.
     *
     * For imported-WIF keys the script type is recorded on the Address
     * record rather than a path; the caller wiring (signMessageFlow)
     * resolves this by passing `addressType` through a separate path
     * if needed, but for v1 we default to plain p2pkh — matches how
     * WIFs imported without path context were typically used.
     *
     * @param {import('./Signer.js').SignMessageParams} params
     * @returns {Promise<import('./Signer.js').SignMessageReturn>}
     */
    async signMessage({ message, chainId, path, addressId }) {
        this._assertUnlocked();
        this._assertSdkRegistry('signMessage');
        const entry = { path, addressId };
        assertEntryShape(entry, 'signMessage');
        const sigOpts = path ? signMessageOptsFromPath(path) : {};
        const wif = this._resolveWifForEntry(chainId, entry);
        const sdk = this._sdkRegistry.get(chainId);
        const result = sdk.auth.signMessage(message, wif, sigOpts);
        // SDK's AuthUtils.signMessage returns { signature, address }; our
        // Signer interface only exposes the signature string.
        const signature = typeof result === 'string' ? result : result?.signature;
        if (typeof signature !== 'string') {
            throw new Error(
                'SoftwareSigner.signMessage: SDK returned no signature string',
            );
        }
        logConsole.record({
            source: 'signer:software',
            level: 'info',
            message: `signMessage chain=${chainId}`,
        });
        return { signature };
    }

    _assertSdkRegistry(method) {
        if (!this._sdkRegistry) {
            throw new Error(
                `SoftwareSigner.${method}: requires an sdkRegistry; construct with { ..., sdkRegistry }`,
            );
        }
    }

    /**
     * Public wrapper for §17.7 "view / export private key" flows.
     * Returns the WIF for an HD-derived address owned by this signer.
     * Caller is responsible for letting the WIF string fall out of
     * scope promptly (see §17.7.3 memory-hygiene caveat on JS string
     * zeroing).
     *
     * Imported-WIF addresses are handled by `exportWifForAddressId`
     * or the top-level `exportPrivateKey` flow.
     *
     * @param {Object} params
     * @param {string} params.chainId
     * @param {string} params.path        BIP32 path of the HD key
     * @returns {string}
     */
    exportWifForPath({ chainId, path }) {
        this._assertUnlocked();
        if (typeof chainId !== 'string' || chainId.length === 0) {
            throw new Error('SoftwareSigner.exportWifForPath: chainId is required');
        }
        return this._deriveWifFor(chainId, path);
    }

    /**
     * Return the WIF for an imported-WIF Address record owned by this
     * signer. Looks up `_unlocked.importedWifs[addressId]`.
     *
     * @param {string} addressId
     * @returns {string}
     */
    exportWifForAddressId(addressId) {
        this._assertUnlocked();
        if (typeof addressId !== 'string' || addressId.length === 0) {
            throw new Error('SoftwareSigner.exportWifForAddressId: addressId is required');
        }
        const bytes = this._unlocked.importedWifs.get(addressId);
        if (!bytes) {
            throw new Error(
                `SoftwareSigner.exportWifForAddressId: no imported WIF for addressId "${addressId}"`,
            );
        }
        return new TextDecoder().decode(bytes);
    }

    /**
     * Internal: resolve the WIF for a signingPaths entry. Routes on
     * which field is present.
     *
     * @param {string} chainId
     * @param {{ path?: string, addressId?: string }} entry
     * @returns {string}
     */
    _resolveWifForEntry(chainId, entry) {
        if (entry && typeof entry.path === 'string' && entry.path.length > 0) {
            return this._deriveWifFor(chainId, entry.path);
        }
        if (entry && typeof entry.addressId === 'string' && entry.addressId.length > 0) {
            return this.exportWifForAddressId(entry.addressId);
        }
        throw new Error(
            'SoftwareSigner: signing-path entry must supply either `path` (HD) or `addressId` (imported-WIF)',
        );
    }

    /**
     * Derive the WIF for (chainId, path). Uses the chain descriptor's
     * wifVersionByte. Caller is responsible for letting the WIF string
     * fall out of scope promptly.
     *
     * @param {string} chainId
     * @param {string} path
     * @returns {string}
     */
    _deriveWifFor(chainId, path) {
        const d = this._chainRegistry.get(chainId);
        if (!d) throw new Error(`SoftwareSigner: unknown chain "${chainId}"`);
        if (typeof path !== 'string' || !path.startsWith('m/')) {
            throw new Error(`SoftwareSigner: invalid derivation path "${path}"`);
        }
        const root = hdKeyFromSeed(this._unlocked.seed);
        const dk = derive(root, path);
        try {
            if (!dk.privateKey) {
                throw new Error(`SoftwareSigner: no private key at path ${path}`);
            }
            return encodeWif(dk.privateKey, d.wifVersionByte, true);
        } finally {
            zeroDerivedKey(dk);
        }
    }

    /**
     * §22.3 MuSig2 round 1 — generate this signer's publicNonce for
     * the multisig session described by `sessionRef`. Wraps
     * `sdk.musig2.aggregateKeys` (to bind the nonce to the aggregated
     * x-only pubkey) and `sdk.musig2.generateNonce`. The nonce is
     * bound to a deterministic `sessionId` derived from the signer's
     * privKey + the session fingerprint, so round 2 can re-cache the
     * secret nonce without persisting secret state — see
     * `signMusig2Round2`.
     *
     * @param {import('./Signer.js').SignMusig2Round1Params} params
     * @returns {Promise<import('./Signer.js').SignMusig2Round1Return>}
     */
    async signMusig2Round1({ chainId, path, sessionRef }) {
        const { publicNonce } = this._musig2Round1Internal({ chainId, path, sessionRef });
        return { publicNonce };
    }

    /**
     * §22.3 MuSig2 round 2 — produce a 32-byte partial signature given
     * the aggregated nonce from round 1. The deterministic sessionId
     * means re-running `generateNonce` re-caches the same secret
     * nonce inside the SDK module, so `partialSign` can find it. The
     * returned `publicNonce` matches round 1's output bit-for-bit and
     * is exposed for sanity-checking by the caller.
     *
     * @param {import('./Signer.js').SignMusig2Round2Params} params
     * @returns {Promise<import('./Signer.js').SignMusig2Round2Return>}
     */
    async signMusig2Round2({ chainId, path, sessionRef, aggNonceHex }) {
        if (!isHex(aggNonceHex) || aggNonceHex.length !== 132) {
            throw new Error('SoftwareSigner.signMusig2Round2: aggNonceHex must be 66-byte hex');
        }
        const { publicNonce, secretKeyBytes, publicKeyBytes, sdk } =
            this._musig2Round1Internal({ chainId, path, sessionRef });
        try {
            const aggNonceBytes = hexToBytes(aggNonceHex);
            const msgBytes = hexToBytes(sessionRef.msgHash);
            const cosignerKeys = sessionRef.cosignerPubkeys.map(hexToBytes);
            const sessionKey = sdk.musig2.startSession(aggNonceBytes, msgBytes, cosignerKeys);
            const partial = sdk.musig2.partialSign({
                secretKey:   secretKeyBytes,
                publicNonce: hexToBytes(publicNonce),
                sessionKey,
                verify:      true,
            });
            return { publicNonce, partialSig: bytesToHex(partial) };
        } finally {
            secretKeyBytes.fill(0);
            publicKeyBytes.fill(0);
        }
    }

    /**
     * Internal: aggregate keys + generate the (deterministic) nonce.
     * Returns the publicNonce alongside the still-live secretKeyBytes
     * so `signMusig2Round2` can call `partialSign` on the same SDK
     * instance without re-deriving the private key.
     *
     * @param {import('./Signer.js').SignMusig2Round1Params} opts
     */
    _musig2Round1Internal({ chainId, path, sessionRef }) {
        this._assertUnlocked();
        this._assertSdkRegistry('signMusig2Round1');
        assertSessionRefShape(sessionRef);
        const sdk = this._sdkRegistry.get(chainId);
        if (!sdk || !sdk.musig2) {
            throw new Error(
                `SoftwareSigner.signMusig2Round1: sdk.musig2 unavailable on chainId "${chainId}" — bump xchain-sdk to 1.10+`,
            );
        }
        if (typeof path !== 'string' || !path.startsWith('m/')) {
            throw new Error(`SoftwareSigner.signMusig2Round1: invalid path "${path}"`);
        }
        const root = hdKeyFromSeed(this._unlocked.seed);
        const dk = derive(root, path);
        try {
            if (!dk.privateKey) {
                throw new Error(`SoftwareSigner.signMusig2Round1: no private key at path ${path}`);
            }
            const cosignerKeys = sessionRef.cosignerPubkeys.map(hexToBytes);
            // BIP327 keyAgg gives us the aggregated x-only pubkey; the
            // nonce-gen call binds the secret nonce to that key so the
            // resulting partial sig is unforgeable across key changes.
            const ctx = sdk.musig2.aggregateKeys(cosignerKeys);
            const xOnlyPublicKey = ctx.xOnlyPubkey;
            const msg = hexToBytes(sessionRef.msgHash);
            // Deterministic sessionId so round 2 can re-derive the
            // same secret nonce without persisting it. Mixes
            // privKey + fingerprint + path so two cosigners on the
            // same wallet (theoretical) get distinct nonces, and the
            // same cosigner across two MuSig2 sessions also gets
            // distinct nonces — both are necessary BIP327 properties.
            const sessionId = sha256(
                concatBytes(
                    new TextEncoder().encode(`xcw-musig2:${path}:`),
                    hexToBytes(sessionRef.fingerprint),
                    dk.privateKey,
                ),
            );
            const secretKeyBytes = new Uint8Array(dk.privateKey);
            const publicKeyBytes = new Uint8Array(dk.publicKey);
            const publicNonce = sdk.musig2.generateNonce({
                publicKey:      publicKeyBytes,
                secretKey:      secretKeyBytes,
                sessionId,
                xOnlyPublicKey,
                msg,
            });
            return {
                publicNonce: bytesToHex(publicNonce),
                secretKeyBytes,
                publicKeyBytes,
                sdk,
            };
        } finally {
            zeroDerivedKey(dk);
        }
    }

    /**
     * §22.3 P2SH / P2WSH single-round contribution. Derives the WIF
     * for the given path, asks the SDK to produce a DER-encoded ECDSA
     * signature over the supplied msgHash, and returns the signature
     * plus the signing key's compressed pubkey.
     *
     * @param {import('./Signer.js').SignMultisigClassicalParams} params
     * @returns {Promise<import('./Signer.js').SignMultisigClassicalReturn>}
     */
    async signMultisigClassical({ chainId, path, msgHash }) {
        this._assertUnlocked();
        this._assertSdkRegistry('signMultisigClassical');
        if (!isHex(msgHash) || msgHash.length !== 64) {
            throw new Error('SoftwareSigner.signMultisigClassical: msgHash must be 32-byte hex');
        }
        if (typeof path !== 'string' || !path.startsWith('m/')) {
            throw new Error(`SoftwareSigner.signMultisigClassical: invalid path "${path}"`);
        }
        const sdk = this._sdkRegistry.get(chainId);
        if (!sdk || !sdk.wallet || typeof sdk.wallet.signEcdsa !== 'function') {
            throw new Error(
                `SoftwareSigner.signMultisigClassical: sdk.wallet.signEcdsa unavailable on chainId "${chainId}"`,
            );
        }
        const root = hdKeyFromSeed(this._unlocked.seed);
        const dk = derive(root, path);
        try {
            if (!dk.privateKey) {
                throw new Error(`SoftwareSigner.signMultisigClassical: no private key at path ${path}`);
            }
            const sigBytes = sdk.wallet.signEcdsa(hexToBytes(msgHash), new Uint8Array(dk.privateKey));
            logConsole.record({
                source: 'signer:software',
                level: 'info',
                message: `signMultisigClassical chain=${chainId}`,
            });
            return {
                sig: bytesToHex(sigBytes),
                publicKey: dk.publicKeyHex,
            };
        } finally {
            zeroDerivedKey(dk);
        }
    }

    /**
     * §22.3 P2SH / P2WSH multisig PSBT signing. Takes a full PSBT
     * (with redeem/witness scripts populated on each input) and a
     * signing path, derives the WIF, and calls
     * `sdk.wallet.signMultisigPsbt` to add this cosigner's partial
     * sigs without finalizing. Returns the PSBT with the new sigs.
     *
     * @param {import('./Signer.js').SignMultisigPsbtParams} params
     * @returns {Promise<import('./Signer.js').SignMultisigPsbtReturn>}
     */
    async signMultisigPsbt({ chainId, psbtHex, signingPaths }) {
        this._assertUnlocked();
        this._assertSdkRegistry('signMultisigPsbt');
        if (typeof psbtHex !== 'string' || psbtHex.length === 0) {
            throw new Error('SoftwareSigner.signMultisigPsbt: psbtHex is required');
        }
        if (!Array.isArray(signingPaths) || signingPaths.length === 0) {
            throw new Error('SoftwareSigner.signMultisigPsbt: signingPaths must be non-empty');
        }
        assertSameSigningSource(signingPaths, 'signMultisigPsbt');
        const entry = signingPaths[0];
        const wif = this._resolveWifForEntry(chainId, entry);
        const sdk = this._sdkRegistry.get(chainId);
        if (!sdk?.wallet || typeof sdk.wallet.signMultisigPsbt !== 'function') {
            throw new Error(
                `SoftwareSigner.signMultisigPsbt: sdk.wallet.signMultisigPsbt unavailable on chainId "${chainId}" — bump xchain-sdk to ^1.13.0`,
            );
        }
        const { psbtHex: signedPsbtHex } = sdk.wallet.signMultisigPsbt(psbtHex, wif);
        logConsole.record({
            source: 'signer:software',
            level: 'info',
            message: `signMultisigPsbt chain=${chainId}`,
        });
        return { psbtHex: signedPsbtHex };
    }

    /**
     * Derive a public key at the given path. Chain-agnostic — the
     * caller supplies the concrete path (resolve via ChainRegistry
     * before calling).
     *
     * @param {import('./Signer.js').GetPublicKeyParams} params
     * @returns {Promise<import('./Signer.js').GetPublicKeyReturn>}
     */
    async getPublicKey({ path }) {
        this._assertUnlocked();
        if (typeof path !== 'string' || !path.startsWith('m/')) {
            throw new Error(`SoftwareSigner.getPublicKey: invalid path "${path}"`);
        }
        const root = hdKeyFromSeed(this._unlocked.seed);
        const derived = derive(root, path);
        try {
            return {
                publicKey: derived.publicKeyHex,
                chainCode: toHex(derived.chainCode),
                fingerprint: derived.fingerprint,
            };
        } finally {
            zeroDerivedKey(derived);
        }
    }
}

function toHex(bytes) {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
}

const HEX_RE = /^[0-9a-fA-F]+$/;
function isHex(v) { return typeof v === 'string' && HEX_RE.test(v); }
function hexToBytes(hex) {
    const clean = hex.toLowerCase();
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}
function bytesToHex(bytes) {
    let s = '';
    for (const b of bytes) s += b.toString(16).padStart(2, '0');
    return s;
}
function concatBytes(...parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
}

function assertSessionRefShape(ref) {
    if (!ref || typeof ref !== 'object') {
        throw new Error('SoftwareSigner: sessionRef is required');
    }
    if (!['p2sh-multisig', 'p2wsh-multisig', 'taproot-musig2'].includes(ref.scheme)) {
        throw new Error(`SoftwareSigner: sessionRef.scheme "${ref.scheme}" is invalid`);
    }
    if (!Array.isArray(ref.cosignerPubkeys) || ref.cosignerPubkeys.length < 2) {
        throw new Error('SoftwareSigner: sessionRef.cosignerPubkeys must be ≥ 2 entries');
    }
    if (!isHex(ref.msgHash) || ref.msgHash.length !== 64) {
        throw new Error('SoftwareSigner: sessionRef.msgHash must be 32-byte hex');
    }
    if (!isHex(ref.fingerprint) || ref.fingerprint.length !== 64) {
        throw new Error('SoftwareSigner: sessionRef.fingerprint must be 32-byte hex');
    }
}

// Decrypt every entry in `importedKeys` into a Map<addressId,
// Uint8Array> keyed by addressId. The plaintext bytes are the WIF's
// UTF-8 encoding; we keep them as bytes (not strings) so lock() can
// zero them. The caller controls the master key lifetime — we use it
// for this one batch then zero it ourselves.
async function decryptImportedKeys(masterKey, importedRecords) {
    /** @type {Map<string, Uint8Array>} */
    const out = new Map();
    for (const rec of importedRecords) {
        if (!rec || typeof rec.encryptedWif !== 'string') continue;
        const wifBytes = await decrypt(masterKey, base64ToBytes(rec.encryptedWif));
        out.set(rec.addressId, wifBytes);
    }
    return out;
}

// All entries in a signingPaths array must identify the same key.
// Multi-key signing (different keys across inputs of one tx) is a
// future enhancement — when it lands, this check moves to routing
// different inputs to different WIFs.
function assertSameSigningSource(signingPaths, method) {
    const paths = new Set(
        signingPaths.map((sp) => sp.path).filter((p) => typeof p === 'string'),
    );
    const addressIds = new Set(
        signingPaths.map((sp) => sp.addressId).filter((a) => typeof a === 'string'),
    );
    if (paths.size + addressIds.size !== 1) {
        throw new Error(
            `SoftwareSigner.${method}: multi-key signing not yet supported; all inputs must share the same path or addressId`,
        );
    }
    for (const sp of signingPaths) assertEntryShape(sp, method);
}

function assertEntryShape(entry, method) {
    const hasPath = typeof entry.path === 'string' && entry.path.length > 0;
    const hasAddressId = typeof entry.addressId === 'string' && entry.addressId.length > 0;
    if (hasPath === hasAddressId) {
        // Both or neither.
        throw new Error(
            `SoftwareSigner.${method}: signing entry must supply exactly one of \`path\` or \`addressId\``,
        );
    }
}

// Map BIP44 purpose number → SDK signMessage opts. Paths outside the
// standard purposes (44/49/84) default to plain p2pkh signing — the
// SDK's behavior when no opts are supplied.
function signMessageOptsFromPath(path) {
    const m = /^m\/(\d+)'/.exec(path);
    const purpose = m?.[1];
    if (purpose === '84') return { segwitNative: true };
    if (purpose === '49') return { segwitRedeemScript: true };
    if (purpose === '86') {
        throw new Error('SoftwareSigner.signMessage: p2tr message signing not supported');
    }
    return {};
}
