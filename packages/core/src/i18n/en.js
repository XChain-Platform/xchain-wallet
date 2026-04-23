// English string dictionary — §54.
//
// Every user-facing string that shows up in a UI should live here
// behind a stable key. Code reaches into the dictionary via `t(key)`
// from ./index.js. Dotted keys (`home.lock`) express scope but the
// dictionary is a flat object — key collisions are a lint-time error,
// not runtime surprise.
//
// Scope boundary: Phase 1 ships only English. A later piece will add
// additional locales via the same dictionary shape. The `t()` helper
// already supports fallback to `en` for missing keys in non-default
// locales, so onboarding a new locale is purely a data addition.
//
// Guidelines:
//   - Keep copy here matching what's rendered in JSX. Drift is the
//     main failure mode for this pattern; the extraction piece + lint
//     rule (later) catches inline strings.
//   - Plural / interpolation uses `{name}` placeholders consumed by
//     `format()` in index.js. Keep placeholders named (not positional)
//     so translators don't have to infer argument order.

export const en = {
    // --- common ---------------------------------------------------
    'common.back': 'Back',
    'common.cancel': 'Cancel',
    'common.next': 'Next',
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.password': 'Password',
    'common.confirmPassword': 'Confirm password',

    // --- branding -------------------------------------------------
    'brand.productName': 'XChain Wallet',
    'brand.tagline': 'The self-custodial wallet for the XChain Platform.',

    // --- session / lock -------------------------------------------
    'session.locked': 'Wallet locked.',
    'session.unlock': 'Unlock',
    'session.lock': 'Lock',
    'session.incorrectPassword': 'Incorrect password.',

    // --- home -----------------------------------------------------
    'home.noWallets': 'No wallets found.',
    'home.loadingBalances': 'Loading balances…',
    'home.noAddresses': 'No addresses yet. Use Receive to generate one.',
    'home.send': 'Send',
    'home.receive': 'Receive',
    'home.balanceUnavailable': 'Balance unavailable — {reason}',
    'home.addressCount.one': '1 address',
    'home.addressCount.many': '{count} addresses',

    // --- onboarding ----------------------------------------------
    'onboarding.create': 'Create a new wallet',
    'onboarding.import': 'I already have a wallet',
    'create.title': 'Create a new wallet',
    'create.passwordHelp':
        "Your password encrypts the wallet on this device. It can't be recovered — if you forget it, use the recovery phrase on the next screen to restore access.",
    'create.walletName': 'Wallet name',
    'create.passwordMinHint': 'At least {min} characters.',
    'create.passwordMismatch': 'Passwords do not match.',
    'create.mnemonicTitle': 'Write down your recovery phrase',
    'create.mnemonicHelp':
        'These twelve words are the ONLY way to recover your wallet if you lose access to this device. Write them down on paper and store them somewhere safe — never type them into a website, email, or photo.',
    'create.mnemonicAck':
        'I have written down my recovery phrase and stored it safely.',
    'create.createWallet': 'Create wallet',
    'create.failed': 'Failed to create wallet.',

    'import.title': 'Import an existing wallet',
    'import.help':
        'Enter a BIP39 recovery phrase (12, 15, 18, 21, or 24 words) or a Counterwallet 12-word mnemonic. The format is detected automatically.',
    'import.phrase': 'Recovery phrase',
    'import.phraseRequired': 'Recovery phrase is required.',
    'import.wordCount':
        'Expected 12, 15, 18, 21, or 24 words — got {count}.',
    'import.failed': 'Failed to import wallet.',
    'import.submit': 'Import',

    // --- send -----------------------------------------------------
    'send.title': 'Send',
    'send.review': 'Review & Send',
    'send.pickSourceFirst': 'Pick a source address first.',
    'send.destinationRequired': 'Destination address is required.',
    'send.assetRequired': 'Asset ticker is required.',
    'send.amountPositive': 'Amount must be a positive number.',
    'send.memoForbiddenChars': 'Memo cannot contain | or ; characters.',
    'send.passwordHint': 'Required to sign.',
    'send.sent': 'Sent',
    'send.txid': 'Transaction ID',
    'send.noAddresses':
        'No addresses on any chain yet. Use Receive to generate one.',
    'send.failed': 'Send failed.',

    // --- extension banner ----------------------------------------
    'extBanner.detected': 'XChain Wallet extension detected.',
    'extBanner.hint':
        'You can use your extension wallet — click its icon in the browser toolbar.',
    'extBanner.dismiss': 'Dismiss',

    // --- errors ---------------------------------------------------
    'error.vaultClosed': 'Wallet is locked — unlock to continue.',
    'error.genericLoad': 'Failed to load.',
};
