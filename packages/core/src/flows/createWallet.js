// createWallet — §15.3. Generate a fresh BIP39 wallet, encrypt the
// mnemonic, persist the initial records, and return the plaintext
// mnemonic for the §19.2 seed-phrase display ceremony. Callers MUST
// display it once and then drop the reference; this module does not
// keep a cached copy.

import {
    BIP39_DEFAULT_STRENGTH_BITS,
    generateBip39Mnemonic,
} from '../crypto/mnemonic.js';
import { persistHdWallet } from './_persistHdWallet.js';

/**
 * @typedef {Object} CreateWalletOpts
 * @property {string} password
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} activeChainIds
 * @property {string} [name]                                   default 'Main Wallet'
 * @property {number} [strengthBits]                           128 | 160 | 192 | 224 | 256
 * @property {string} [bip39Passphrase]                        §15.6 25th word
 * @property {import('../crypto/kdf.js').KdfParams} [kdfParams] override per-device calibration
 */

/**
 * @typedef {Object} CreateWalletResult
 * @property {string} mnemonic
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
    activeNetwork,
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

    // Infer activeNetwork from the first chain when the caller didn't
    // pass one. A wallet created with regtest chains lands on regtest;
    // mainnet chains lands on mainnet. Explicit override wins.
    const effectiveActiveNetwork = activeNetwork
        ?? chainRegistry.descriptorFor(activeChainIds[0])?.networkKind;

    const mnemonic = generateBip39Mnemonic(strengthBits);
    const passphraseEnabled = bip39Passphrase.length > 0;

    const persisted = await persistHdWallet({
        mnemonic,
        format: 'bip39',
        origin: 'created',
        passphraseEnabled,
        bip39Passphrase,
        password,
        name,
        accountName: 'Main',
        kdfParams,
        vault,
        chainRegistry,
        sdkRegistry,
        activeChainIds,
        activeNetwork: effectiveActiveNetwork,
    });

    return { mnemonic, ...persisted };
}
