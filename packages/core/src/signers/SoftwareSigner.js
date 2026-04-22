// SoftwareSigner — §17.2. Wraps the wallet's HD seed plus any imported
// WIFs. Unlock decrypts the seed blob with Argon2id + AES-GCM; HD
// derivation uses BIP32 over the chain registry's path templates.
// Address encoding, PSBT signing, and message signing are delegated to
// `xchain-sdk` and stay stubbed until SDKRegistry lands (§10.2).

import { decryptWalletSeed } from '../crypto/walletBlob.js';
import {
    bip39MnemonicToSeed,
    isValidBip39Mnemonic,
} from '../crypto/mnemonic.js';
import {
    counterwalletMnemonicToSeedBytes,
    isValidCounterwalletMnemonic,
} from '../crypto/counterwallet.js';
import { derive, hdKeyFromSeed, zeroDerivedKey } from '../crypto/hd.js';
import {
    NotImplementedError,
    Signer,
    SignerLockedError,
} from './Signer.js';

/**
 * @typedef {Object} WalletEncryptionInputs
 * @property {string} encryptedSeed                         base64 ciphertext from Wallet.encryptedSeed
 * @property {import('../crypto/kdf.js').KdfParams} kdfParams
 * @property {Uint8Array} [aad]                             extra authenticated data passed at encrypt time
 * @property {boolean} [passphraseEnabled]                  §15.6 — BIP39 passphrase required at unlock (BIP39 only)
 * @property {'bip39' | 'counterwallet-legacy'} [format]    Wallet.format; defaults to 'bip39'
 */

/**
 * @typedef {Object} UnlockedState
 * @property {Uint8Array} mnemonicBytes   UTF-8 bytes of the decrypted BIP39 mnemonic
 * @property {Uint8Array} seed            64-byte BIP39 seed (mnemonic + passphrase)
 * @property {Map<string, Uint8Array>} importedWifs   keyed by addressId
 */

export class SoftwareSigner extends Signer {
    /**
     * @param {Object} opts
     * @param {string} opts.id
     * @param {string} opts.displayName
     * @param {import('../registry/index.js').ChainRegistry} opts.chainRegistry
     * @param {WalletEncryptionInputs} opts.walletEncryption
     */
    constructor({ id, displayName, chainRegistry, walletEncryption }) {
        super();
        this._id = id;
        this._displayName = displayName;
        this._chainRegistry = chainRegistry;
        this._walletEncryption = walletEncryption;
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

        this._acceptUnlockedState({
            mnemonicBytes: plaintext,
            seed,
            importedWifs: new Map(),
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

    async getAddresses(_params) {
        this._assertUnlocked();
        // Needs sdk.WalletUtils.deriveAddress for address encoding per
        // chain/addressType. Unblocked when SDKRegistry (§10.2) lands.
        throw new NotImplementedError('SoftwareSigner.getAddresses');
    }

    async signPsbt(_params) {
        this._assertUnlocked();
        // Needs sdk.WalletUtils.signPsbt. Unblocked by SDKRegistry.
        throw new NotImplementedError('SoftwareSigner.signPsbt');
    }

    async signMessage(_params) {
        this._assertUnlocked();
        // Needs sdk.AuthUtils.signMessage. Unblocked by SDKRegistry.
        throw new NotImplementedError('SoftwareSigner.signMessage');
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
