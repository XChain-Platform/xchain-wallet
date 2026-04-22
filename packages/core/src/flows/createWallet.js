// createWallet — §15.3. The end-to-end "generate a fresh wallet" flow
// that every shell's "Create new wallet" onboarding invokes. Ties the
// crypto, schema, signer, SDK, and storage layers together into one
// call that returns a ready-to-use wallet with one account and one
// address per active chain.
//
// Returns the plaintext mnemonic. Callers MUST display it via the §19.2
// seed-phrase display ceremony and then drop the reference. This module
// does not keep a cached copy.

import {
    BIP39_DEFAULT_STRENGTH_BITS,
    generateBip39Mnemonic,
} from '../crypto/mnemonic.js';
import {
    calibrateKdfParams,
    encryptWalletSeed,
} from '../crypto/index.js';
import { createWallet as createWalletRecord } from '../schemas/wallet.js';
import { createAccount } from '../schemas/account.js';
import { createAddress } from '../schemas/address.js';
import { unlockWalletRecord } from './unlockWallet.js';

/**
 * @typedef {Object} CreateWalletOpts
 * @property {string} password                                 non-empty
 * @property {import('../storage/Vault.js').Vault} vault       must be open
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} activeChainIds                         chains to derive an initial address on
 * @property {string} [name]                                   default 'Main Wallet'
 * @property {number} [strengthBits]                           128 (12 words) | 160 | 192 | 224 | 256 (24 words)
 * @property {string} [bip39Passphrase]                        §15.6 25th word
 * @property {import('../crypto/kdf.js').KdfParams} [kdfParams]  override per-device calibration (tests supply fast params)
 */

/**
 * @typedef {Object} CreateWalletResult
 * @property {string} mnemonic                                 plaintext — display once, then drop
 * @property {import('../schemas/wallet.js').Wallet} wallet
 * @property {import('../schemas/account.js').Account} account
 * @property {Array<{ chainId: string, address: import('../schemas/address.js').Address }>} addresses
 */

/**
 * @param {CreateWalletOpts} opts
 * @returns {Promise<CreateWalletResult>}
 */
export async function createWallet({
    password,
    vault,
    chainRegistry,
    sdkRegistry,
    activeChainIds,
    name = 'Main Wallet',
    strengthBits = BIP39_DEFAULT_STRENGTH_BITS,
    bip39Passphrase = '',
    kdfParams,
}) {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('createWallet: password is required');
    }
    if (!vault) throw new Error('createWallet: vault is required');
    if (!chainRegistry) throw new Error('createWallet: chainRegistry is required');
    if (!sdkRegistry) throw new Error('createWallet: sdkRegistry is required');
    if (!Array.isArray(activeChainIds) || activeChainIds.length === 0) {
        throw new Error('createWallet: activeChainIds must be a non-empty array');
    }
    for (const id of activeChainIds) {
        if (!chainRegistry.has(id)) {
            throw new Error(`createWallet: unknown chain "${id}"`);
        }
    }

    // 1. Generate mnemonic. This IS the plaintext the caller displays
    //    to the user once; it's also what we re-derive the seed from
    //    on every unlock, so it's what we encrypt.
    const mnemonic = generateBip39Mnemonic(strengthBits);
    const passphraseEnabled = bip39Passphrase.length > 0;

    // 2. Pick KDF params. Tests pass fast params; shells omit and pay
    //    the ~1s calibration once at wallet creation (§11.4).
    const effectiveKdfParams = kdfParams ?? calibrateKdfParams();

    // 3. Encrypt the mnemonic bytes into the wallet record shape.
    const mnemonicBytes = new TextEncoder().encode(mnemonic);
    let encryptedSeed;
    let storedKdfParams;
    try {
        const enc = await encryptWalletSeed({
            password,
            seed: mnemonicBytes,
            kdfParams: effectiveKdfParams,
        });
        encryptedSeed = enc.encryptedSeed;
        storedKdfParams = enc.kdfParams;
    } finally {
        mnemonicBytes.fill(0);
    }

    // 4. Build & persist the Wallet record.
    const walletRecord = createWalletRecord({
        name,
        origin: 'created',
        format: 'bip39',
        passphraseEnabled,
        encryptedSeed,
        kdfParams: storedKdfParams,
    });
    await vault.wallets.put(walletRecord);

    // 5. Build & persist the first Account (index 0).
    const account = createAccount({
        walletId: walletRecord.id,
        name: 'Main',
        index: 0,
    });
    await vault.accounts.put(account);

    // 6. Build + unlock a SoftwareSigner against the freshly-persisted
    //    wallet via the shared `unlockWalletRecord` primitive — no
    //    duplicate signer-construction logic here, so address
    //    derivation at creation is identical to a subsequent unlock.
    const signer = await unlockWalletRecord({
        wallet: walletRecord,
        password,
        bip39Passphrase,
        chainRegistry,
        sdkRegistry,
    });

    try {
        // 7. First address per active chain, using the chain's default
        //    address type.
        const addresses = [];
        for (const chainId of activeChainIds) {
            const descriptor = chainRegistry.get(chainId);
            const addressType = descriptor.defaultAddressType;
            const [derived] = await signer.getAddresses({
                chainId,
                accountIndex: 0,
                change: 0,
                startIndex: 0,
                count: 1,
                addressType,
            });
            const record = createAddress({
                accountId: account.id,
                chain: descriptor.coin,
                network: descriptor.networkKind,
                source: 'hd',
                addressType,
                derivationPath: derived.path,
                address: derived.address,
                publicKey: derived.publicKey,
                label: 'Address #1',
            });
            await vault.addresses.put(record);
            addresses.push({ chainId, address: record });
        }

        return { mnemonic, wallet: walletRecord, account, addresses };
    } finally {
        signer.lock();
    }
}
