// importMnemonic — §15.4. Import a user-supplied 12/24-word BIP39
// mnemonic, or a 12-word Counterwallet-legacy mnemonic (for FreeWallet
// migration). Creates the Wallet + first Account + initial address per
// active chain, matching the shape produced by createWallet so the two
// paths are interchangeable downstream.
//
// Out of scope for this flow (separate §15.4 paths):
//   - Single WIF import — produces a wallet with one imported-WIF
//     address and no HD. Different schema shape, different flow.
//   - .xchain-wallet encrypted backup file — decrypts to a full state,
//     not a fresh wallet; restore rather than import.

import { isValidBip39Mnemonic } from '../crypto/mnemonic.js';
import {
    isValidCounterwalletMnemonic,
    validateCounterwalletMnemonic,
} from '../crypto/counterwallet.js';
import { persistHdWallet } from './_persistHdWallet.js';

export class InvalidMnemonicError extends Error {
    constructor(format, errors) {
        super(
            `importMnemonic: ${format} validation failed — ${errors.join('; ')}`,
        );
        this.name = 'InvalidMnemonicError';
        this.format = format;
        this.errors = errors;
    }
}

export class UnknownMnemonicFormatError extends Error {
    constructor() {
        super(
            'importMnemonic: mnemonic did not validate as BIP39 or Counterwallet — check for typos or wrong wordlist',
        );
        this.name = 'UnknownMnemonicFormatError';
    }
}

const DEFAULT_ORIGIN_BY_FORMAT = {
    'bip39': 'imported-mnemonic',
    'counterwallet-legacy': 'imported-freewallet',
};

/**
 * Trim, collapse internal whitespace, lowercase. Users paste from many
 * sources (PDFs, SMS, handwriting OCR); the canonical validators expect
 * lowercase single-space-separated words.
 * @param {string} s
 */
export function normalizeMnemonic(s) {
    if (typeof s !== 'string') return '';
    return s.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/**
 * Detect format: BIP39 first (checksum catches typos), Counterwallet as
 * fallback. Returns null if neither validates.
 * @param {string} normalized
 * @returns {'bip39' | 'counterwallet-legacy' | null}
 */
export function detectMnemonicFormat(normalized) {
    if (isValidBip39Mnemonic(normalized)) return 'bip39';
    if (isValidCounterwalletMnemonic(normalized)) return 'counterwallet-legacy';
    return null;
}

/**
 * @typedef {Object} ImportMnemonicOpts
 * @property {string} password
 * @property {string} mnemonic                                 user-supplied (whitespace/case tolerant)
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string[]} activeChainIds
 * @property {'bip39' | 'counterwallet-legacy'} [format]       auto-detect if omitted
 * @property {string} [name]                                   default 'Imported Wallet'
 * @property {string} [bip39Passphrase]                        BIP39 only; rejected on Counterwallet
 * @property {'imported-mnemonic' | 'imported-freewallet' | 'imported-xchain-backup'} [origin]  default derived from format
 * @property {import('../crypto/kdf.js').KdfParams} [kdfParams]
 */

/**
 * @typedef {Object} ImportMnemonicResult
 * @property {'bip39' | 'counterwallet-legacy'} format
 * @property {import('../schemas/wallet.js').Wallet} wallet
 * @property {import('../schemas/account.js').Account} account
 * @property {Array<{ chainId: string, address: import('../schemas/address.js').Address }>} addresses
 */

/**
 * @param {ImportMnemonicOpts} opts
 * @returns {Promise<ImportMnemonicResult>}
 */
export async function importMnemonic({
    password,
    mnemonic,
    vault,
    chainRegistry,
    sdkRegistry,
    activeChainIds,
    format,
    name = 'Imported Wallet',
    bip39Passphrase = '',
    origin,
    kdfParams,
    activeNetwork,
}) {
    if (typeof password !== 'string' || password.length === 0) {
        throw new Error('importMnemonic: password is required');
    }
    if (!vault) throw new Error('importMnemonic: vault is required');
    if (!chainRegistry) throw new Error('importMnemonic: chainRegistry is required');
    if (!sdkRegistry) throw new Error('importMnemonic: sdkRegistry is required');
    if (!Array.isArray(activeChainIds) || activeChainIds.length === 0) {
        throw new Error('importMnemonic: activeChainIds must be a non-empty array');
    }
    for (const id of activeChainIds) {
        if (!chainRegistry.has(id)) {
            throw new Error(`importMnemonic: unknown chain "${id}"`);
        }
    }
    if (typeof mnemonic !== 'string' || mnemonic.trim().length === 0) {
        throw new Error('importMnemonic: mnemonic is required');
    }

    const normalized = normalizeMnemonic(mnemonic);

    // Resolve format — explicit caller request takes precedence and is
    // validated against the normalized input; otherwise auto-detect.
    let resolvedFormat;
    if (format) {
        if (format === 'bip39') {
            if (!isValidBip39Mnemonic(normalized)) {
                throw new InvalidMnemonicError('bip39', ['not a valid BIP39 mnemonic']);
            }
        } else if (format === 'counterwallet-legacy') {
            const r = validateCounterwalletMnemonic(normalized);
            if (!r.ok) throw new InvalidMnemonicError('counterwallet-legacy', r.errors);
        } else {
            throw new Error(`importMnemonic: unsupported format "${format}"`);
        }
        resolvedFormat = format;
    } else {
        const detected = detectMnemonicFormat(normalized);
        if (!detected) throw new UnknownMnemonicFormatError();
        resolvedFormat = detected;
    }

    if (resolvedFormat === 'counterwallet-legacy' && bip39Passphrase.length > 0) {
        throw new Error(
            'importMnemonic: counterwallet-legacy wallets do not support a BIP39 passphrase',
        );
    }

    const passphraseEnabled = resolvedFormat === 'bip39' && bip39Passphrase.length > 0;
    const resolvedOrigin = origin ?? DEFAULT_ORIGIN_BY_FORMAT[resolvedFormat];

    // Infer activeNetwork from the first chain when caller didn't supply
    // one. Mirrors createWallet — see effectiveNetwork rationale there.
    const effectiveActiveNetwork = activeNetwork
        ?? chainRegistry.descriptorFor(activeChainIds[0])?.networkKind;

    const persisted = await persistHdWallet({
        mnemonic: normalized,
        format: resolvedFormat,
        origin: resolvedOrigin,
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

    return { format: resolvedFormat, ...persisted };
}
