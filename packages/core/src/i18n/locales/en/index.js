// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English string dictionary (§54 / G173 ICU format).
//
// Keys live in one flat object; dotted keys (`home.lock`) express scope.
// JavaScript silently keeps the last of two identical keys, so
// test/smoke/core/i18n.smoke.js scans this source and fails on a repeat.
//
// Plural / select handling uses ICU MessageFormat-compatible syntax:
//
//   '{count, plural, one {# address} other {# addresses}}'
//   '{kind, select, mainnet {Live} testnet {Testnet} other {Other}}'
//
// `t()` in `i18n/index.js` renders the matched template through
// formatjs (`IntlMessageFormat` from `intl-messageformat`), so the full
// ICU grammar is available: plural, select, selectordinal, number and
// date skeletons, nested patterns and offset. Templates here use only
// plural and select today, which is a choice about the copy, not a
// limit of the runtime. The plural/select-only subset the wallet
// shipped before v0.334 survives as `legacyFormat()` in `i18n/index.js`
// and is reached only when formatjs refuses to parse a template.
//
// Adding a new locale: copy this directory to `locales/<bcp47>/index.js`,
// translate every value, then call
// `registerLocale('<bcp47>', dictionary)` from app boot.
//
// Until a locale is registered, missing keys fall back to English.

export const en = {
    // --- common ---------------------------------------------------
    'common.back': 'Back',
    'common.backToHome': 'Back to home',
    'common.cancel': 'Cancel',
    'common.tryAgain': 'Try again',
    'common.openNetworkSettings': 'Open Network settings',
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.password': 'Password',
    'common.confirm': 'Confirm',
    'common.settingsUnavailable': 'Settings unavailable.',
    'common.chain': 'Chain',
    'common.chooseSourceAddress': 'Choose source address',
    'common.createUnsignedTransaction': 'Create unsigned transaction',
    'common.discard': 'Discard',
    'common.edit': 'Edit',
    'common.estimateUnavailable': 'Estimate unavailable',
    'common.from': 'From',
    'common.fromAddress': 'From address',
    'common.networkFee': 'Network fee',
    'common.networkFeeUnavailable': 'Network fee estimate unavailable.',
    'common.networkFeeValue': 'Network fee: {amount} {ticker}',
    'common.noAddressOnChain': 'No address on this chain. Use Receive to generate one first.',
    'common.notAvailable': 'n/a',
    'common.preview': 'Preview',
    'common.restore': 'Restore',
    'common.review': 'Review',
    'common.sign': 'Sign',
    'common.signOn': 'Sign on {device}',
    'common.transactionId': 'Transaction ID',
    'common.watcherBuildsUnsigned':
        'Watcher mode: this wallet will build an unsigned transaction. Sign it on your Signer-mode wallet, then bring the signed transaction to a Full-mode wallet to broadcast.',
    'common.save': 'Save',

    // --- shared components ---------------------------------------
    'adsNotice.title': 'Automatic Donation System',
    'adsNotice.subtitle':
        'XChain Wallet includes an Automatic Donation System (ADS) that supports continued development of the XChain Platform.',
    'adsNotice.defaultBehavior':
        'ADS is on by default. It sets aside a small amount when you send a transaction and sends it as one donation once it adds up.',
    'adsNotice.optional': 'You do not need to donate to use this wallet.',
    'adsNotice.settings':
        'How much, how often, and whether to donate at all are yours to set under Settings → Automatic Donation System, where ADS can also be turned off entirely.',
    'adsNotice.continue': 'Continue',
    'alerts.dialogLabel': 'Wallet alerts',
    'alerts.title': 'Alerts',
    'alerts.close': 'Close alerts',
    'alerts.empty': "No alerts. You're all caught up.",
    'backupReminder.backupNow': 'Back up now',
    'backupReminder.remindTomorrow': 'Remind me tomorrow',

    // --- settings ------------------------------------------------
    'settings.network.label': 'Network',
    'settings.network.activeLabel': 'Active network',
    'settings.network.switchTitle': 'Switch to {network}?',
    'settings.network.switchMessage':
        'The wallet will reload and show {nextNetwork} chains. Your {currentNetwork} balances and chain settings stay unchanged.',
    'settings.network.switchConfirm': 'Switch network',
    'settings.network.switchError': 'Could not switch networks. Try again.',
    'settings.undoSend.label': 'Hold signed sends before broadcast',
    'settings.undoSend.hintUnavailable':
        'This build cannot hold sends. The preference is saved for a build that supports it.',
    'settings.undoSend.hintAvailable':
        'When enabled, holds each signed send for the duration below so you can cancel it before broadcast. A duration of 0 does not hold sends.',
    'settings.undoSend.durationLabel': 'Hold duration in seconds (0 disables)',
    'settings.undoSend.durationAriaLabel': 'Send hold duration in seconds',

    // --- account picker ------------------------------------------
    'accountPicker.title': 'Accounts',
    'accountPicker.add': 'Add account',
    'accountPicker.manage': 'Manage account',
    'accountPicker.defaultName': 'Account {number}',
    'accountPicker.renameLabel': 'Rename {label}',
    'accountPicker.renameTitle': 'Rename account',
    'accountPicker.empty.title': 'No accounts yet',
    'accountPicker.empty.body': 'Accounts added to this wallet appear here.',
    'accountPicker.error.load': 'Could not load accounts. Try again.',
    'accountPicker.loading': 'Loading accounts…',
    'accountPicker.loadingLabel': 'Loading accounts',

    // --- action routes -------------------------------------------
    'actionDetail.back': 'Back to history',
    'actionDetail.title': 'Action',
    'actionDetail.empty.title': 'No action selected',
    'actionDetail.empty.body': 'Action details appear here after one is selected.',
    'actionsMenu.more': 'More actions',
    'actionsMenu.title': 'Token actions',
    'actionsMenu.unavailable': 'Unavailable: {reason}',

    // --- alerts --------------------------------------------------
    'alerts.empty.title': 'No alerts',
    'alerts.empty.body': "You're all caught up.",

    // --- bridged tokens ------------------------------------------
    'bridgeOrigin.onChainName': 'On-chain token name: {tick}',
    'bridgeOrigin.from': 'Bridged from {origin}',

    'loading.error.title': 'The wallet could not start',
    'loading.error.body':
        'Something stopped the wallet from opening. Your wallet data has not been changed.',
    'loading.error.recovery':
        'Choose Try again. If the wallet still does not open, contact support before clearing any wallet data.',

    'onboarding.carousel.getStarted': 'Get started',
    'onboarding.carousel.skip': 'Skip',
    'onboarding.carousel.steps': 'Onboarding steps',
    'onboarding.carousel.stepLabel': 'Step {current} of {count}: {title}',
    'onboarding.carousel.next': 'Next',

    'market.reversePair': 'Reverse pair to {pair}',
    'market.reverseTitle': 'Reverse to {pair}',
    'market.stats.high24h': '24h high',
    'market.stats.low24h': '24h low',
    'market.stats.volume24h': '24h vol',
    'market.notFound.title': 'Market not found',
    'market.notFound.body': 'It may have been closed or not indexed yet.',
    'market.summary': 'Market summary',
    'market.loading': 'Loading market',
    'market.panels': 'Market panels',

    'multisig.share.title': 'Share this wallet as a cosigner',
    'multisig.share.instructions':
        'Give these values to the person creating the multisig. In their wallet they add a cosigner with origin "External xpub" and paste each one into the field of the same name. They are public keys: they show the shared address but cannot spend from it.',
    'multisig.share.availability':
        'Only software-seed addresses can be shared here. A watch-only address has no signing key, and a hardware address must be exported using the hardware device or its companion wallet.',
    'multisig.share.address': 'Address to share',
    'multisig.share.selectAddress': 'Select address',
    'multisig.share.payload': 'Share payload',
    'multisig.share.payloadHint': 'The QR code and text contain the same public cosigner fields.',
    'multisig.share.qrAlt': 'QR code for multisig cosigner share payload',
    'multisig.share.payloadAriaLabel': 'Cosigner share payload',
    'multisig.share.copyPayload': 'Copy cosigner share payload',
    'multisig.share.xpub': 'xpub',
    'multisig.share.account': 'Account {path}',
    'multisig.share.publicKey': 'Public key',
    'multisig.share.masterFingerprint': 'Master fingerprint',
    'multisig.share.derivationPath': 'Derivation path',
    'multisig.share.identityCheck':
        'Identity check: before funding the multisig, compare the master fingerprint and derivation path with the cosigner over a separate trusted channel. For a hardware signer, confirm its fingerprint on the device itself.',
    'multisig.share.copyField': 'Copy {label}',
    'multisig.share.unavailable': 'Not available from this signer',

    // --- route fallback -----------------------------------------
    'routeNotFound.title': 'Page not found',
    'routeNotFound.body': 'This page does not exist or is no longer available.',
    'routeNotFound.backToHome': 'Back to Home',

    // --- signer selection ---------------------------------------
    'signerSelect.choose': 'Choose signer',
    'signerSelect.title': 'Signer',
    'signerSelect.intro':
        'Choose where this operation derives its keys. This choice does not share recovery words or hardware secrets.',
    'signerSelect.watcherNote':
        'Watch-only mode remains active. Selecting a key source here does not enable local transaction signing.',

    // --- rename forms -------------------------------------------
    'renameAccount.title': 'Rename account',
    'renameAccount.name': 'Account name',
    'renameWallet.title': 'Rename wallet',
    'renameWallet.name': 'Wallet name',

    // --- staking chooser ----------------------------------------
    'stakeNew.backToStaking': 'Back to staking',
    'stakeNew.title': 'New stake',
    'stakeNew.chooseNetwork': 'Choose the network to stake on.',
    'stakeNew.prompt': 'What would you like to stake?',
    'stakeNew.bitcoinOnly':
        'Staking is available on Bitcoin only at launch. Use Receive on a Bitcoin network to generate an address first.',
    'stakeNew.validatorTitle': 'Validator staking',
    'stakeNew.validatorDescription':
        'Stake XCHAIN to help secure the network and earn rewards.',
    'stakeNew.contractTitle': 'Contract staking',
    'stakeNew.contractDescription':
        "Stake tokens into a contract. You'll pick the contract next.",

    // --- vault unavailable --------------------------------------
    'vaultUnavailable.recoverySafe': 'Your recovery phrase still holds everything.',
    'vaultUnavailable.blockchainSafe':
        'Your coins live on the blockchain, not in this app. Anything stored here is only a copy, and your recovery phrase restores it on this device or any other.',
    'vaultUnavailable.restore': 'Restore from recovery phrase or backup',
    'vaultUnavailable.wipeWarning':
        'Do not do this unless you have your recovery phrase or an encrypted backup file to hand.',
    'vaultUnavailable.wipeConfirm': 'Type WIPE to confirm',

    // --- signature verification ---------------------------------
    'verifySignature.title': 'Verify signature',
    'verifySignature.valid': 'Valid signature. Signature matches this message and address.',
    'verifySignature.invalid': 'Invalid signature. Signature does not match this message and address.',
    'verifySignature.malformed': 'Malformed signature. Enter a base64-encoded signature.',
    'verifySignature.chain': 'Chain',
    'verifySignature.address': 'Address',
    'verifySignature.addressPlaceholder': 'The address that produced the signature',
    'verifySignature.message': 'Message',
    'verifySignature.messagePlaceholder': 'The exact text that was signed',
    'verifySignature.signature': 'Signature',
    'verifySignature.signaturePlaceholder': 'Base64 signature blob',
    'verifySignature.verifying': 'Verifying…',

    // --- wallet management --------------------------------------
    'walletDetails.title': 'Wallet details',
    'walletDetails.name': 'Name',
    'walletDetails.type': 'Type',
    'walletDetails.origin': 'Origin',
    'walletDetails.passphrase': '25th-word passphrase',
    'walletDetails.accounts': 'Accounts',
    'walletDetails.created': 'Created',
    'walletDetails.status': 'Status',
    'walletDetails.demoWallet': 'Demo wallet (throwaway)',
    'walletDetails.id': 'ID',
    'walletDetails.upgradeRecovery': 'Upgrade recovery phrase',
    'walletDetails.rename': 'Rename wallet',
    'walletDetails.exitDemo': 'Exit demo & wipe',
    'walletPicker.title': 'Wallets',
    'walletPicker.add': 'Add wallet',
    'walletPicker.manage': 'Manage wallet',
    'walletPicker.emptyTitle': 'No wallets yet',
    'walletPicker.emptyBody': 'Wallets available to this app appear here.',
    'walletPicker.demoPrefix': 'Demo wallet · ',
    'walletPicker.legacy': 'FreeWallet (legacy)',
    'walletPicker.importedKey': 'Imported key',
    'walletPicker.bip39': 'BIP39',
    'walletPicker.passphraseNeeded': ' · needs its passphrase at unlock',
    'walletPicker.detailsFor': 'Wallet details for {wallet}',

    // --- home -----------------------------------------------------
    'home.receive': 'Receive',
    'home.title': 'Home',
    'home.offline.cached':
        'You are offline. Showing cached balances and their last synced time. Network actions will be available when your connection returns.',
    'home.offline.empty': 'You are offline. Connect to load balances and use network actions.',
    'home.loadingBalances': 'Loading balances',
    'home.pendingAirdrops': 'Pending airdrops',
    'home.resumeAirdrop': 'Resume airdrop: {amount} {token} × {count}',
    'home.airdrop.waitingIndex': 'Recipient list sent, waiting to be indexed',
    'home.airdrop.readyToSign': 'Ready to sign the airdrop',
    'home.pendingPayments': 'Pending payments due',
    'home.paymentDue': 'Payment due: pay {amount} to complete matched order #{order}',
    'home.paymentDue.hint': 'Sign to finish paying for your matched order.',
    'home.quickActions': 'Quick actions',
    'home.exchange': 'Exchange',
    'home.exchangeOffline': 'Exchange needs a network connection',
    'home.more': 'More',
    'home.createToken': 'Create token',
    'home.markets': 'Markets',
    'home.messaging': 'Messaging',
    'home.unread': '{count} unread',
    'home.history': 'History',
    'home.addresses': 'Addresses',
    'home.contracts': 'Contracts',
    'home.staking': 'Staking',
    'home.moreActions': 'More actions',
    'home.send': 'Send',
    'home.sendOffline': 'Send needs a network connection',
    'home.settings': 'Settings',
    'home.lockWallet': 'Lock wallet',
    'home.signer.region': 'Signer-mode home',
    'home.signer.title': 'Signer mode',
    'home.signer.body':
        "This wallet only signs transactions from a paired Watcher wallet. Send / Receive / balances are not available. Switch the wallet's mode in Settings → Wallet Mode if you want full-wallet behaviour back.",
    'home.signer.signTransaction': 'Sign a transaction',
    'home.signer.signMessage': 'Sign a message',
    'home.signer.verifySignature': 'Verify a signature',

    // --- contract execution --------------------------------------
    'execute.review.title': 'Review contract call',
    'execute.callContractNumber': 'Call contract #{contract}',
    'execute.loadingAddresses': 'Loading addresses…',
    'execute.success': 'Method call broadcast.',
    'execute.executeOn': 'Execute on {network}',
    'execute.action': 'Execute',
    'execute.review.summary.deposit':
        'Deposit {quantity} {tick}, then call {method}{args} on contract #{contract}.',
    'execute.review.summary.call': 'Call {method}{args} on contract #{contract}.',
    'execute.review.args': '{count, plural, one { with # arg} other { with # args}}',
    'execute.contract': 'Contract',
    'execute.deposit': 'Deposit',
    'execute.method': 'Method',
    'execute.params': 'Params',
    'execute.protocolFee': 'Protocol fee',
    'execute.protocolFee.native': 'Paid in {coin}',
    'execute.protocolFee.xchain': 'Paid from your XCHAIN balance',
    'execute.nativeCoin': 'the native coin',
    'execute.tokenToDeposit': 'Token to deposit',
    'execute.callContract': 'Call contract',
    'execute.caller': 'Caller',
    'execute.enterMethodManually': 'Enter method manually',
    'execute.methodHint': 'Name of the contract method to call.',
    'execute.paramsOptional': 'Params (optional)',
    'execute.paramsHint': 'Pipe-delimited arguments, e.g. foo|42|bc1q… Leave blank for no-arg methods.',
    'execute.useDeclaredMethods': 'Use declared methods',
    'execute.depositOptional': 'Deposit (optional)',
    'execute.noDeposit': 'No deposit',
    'execute.depositAmount': 'Deposit amount',
    'execute.depositHint':
        'Sent into contract #{contract} in the same transaction, before the call. Only tokens on {chain} can be deposited.',
    'execute.thisChain': 'this chain',
    'execute.balanceAvailable': '{amount} {tick} available',
    'execute.removeDeposit': 'Remove deposit',

    // --- gated publishing ----------------------------------------
    'gatedPublish.review.title': 'Review gated publish',
    'gatedPublish.title': 'Gated content · {tick}',
    'gatedPublish.watcherSavedKey':
        'The pack key is saved in this wallet. Sign the transaction on your Signer wallet, then broadcast it from a Full-mode wallet.',
    'gatedPublish.queuedWhat': 'gated file publish',
    'gatedPublish.success': 'Encrypted file published',
    'gatedPublish.transaction': 'Transaction:',
    'gatedPublish.packKeyHash': 'Pack key hash:',
    'gatedPublish.successHint.beforeToken':
        'The decryption key is stored in this wallet and recorded on-chain encrypted to your own address. Anyone who receives',
    'gatedPublish.successHint.afterToken':
        'through a normal send gets the key automatically. To add more files that unlock together, publish again and pick this pack.',
    'gatedPublish.pack.new': 'New pack (fresh key)',
    'gatedPublish.pack.existing': 'Existing pack {hash}…',
    'gatedPublish.signAndPublish': 'Sign and publish',
    'gatedPublish.review.summary.beforeFile': 'Publish',
    'gatedPublish.review.summary.afterFile': 'encrypted; only holders of {tick} will be able to read it.',
    'gatedPublish.previewAlt': 'Preview of {file}',
    'gatedPublish.file': 'File',
    'gatedPublish.gateToken': 'Gate token',
    'gatedPublish.fileMetadata': '{name} · {bytes} bytes · {type}',
    'gatedPublish.pack': 'Pack',
    'gatedPublish.unlockThreshold': 'Unlock threshold',
    'gatedPublish.thresholdReview': 'hold ≥ {amount} {tick} to receive the key',
    'gatedPublish.publishingFrom': 'Publishing from',
    'gatedPublish.permanentHint':
        'Permanent: the encrypted bytes live on-chain forever and the gate cannot be removed later, only the key re-shared. One transaction publishes the file and records your recovery copy of the key; there is no key-less window.',
    'gatedPublish.watcherHint':
        'Watcher mode: this builds an unsigned transaction. The pack key stays in THIS wallet either way.',
    'gatedPublish.gatedContent': 'Gated content',
    'gatedPublish.formHint.beforeToken': 'Publish a file that only holders of',
    'gatedPublish.formHint.afterToken':
        'can read. The file is encrypted before it touches the chain; the key travels automatically with every normal send of the token.',
    'gatedPublish.ownerMissing.beforeAddress': 'This wallet does not hold the owner address',
    'gatedPublish.ownerMissing.afterAddress':
        'for {tick}. Only the token owner can publish gated files.',
    'gatedPublish.fileLimit': 'File (up to about {bytes} bytes)',
    'gatedPublish.fileToPublish': 'File to publish',
    'gatedPublish.titleOptional': 'Title (optional)',
    'gatedPublish.titleField': 'Title',
    'gatedPublish.memoOptional': 'Memo (optional)',
    'gatedPublish.memoField': 'Memo',
    'gatedPublish.unlockThresholdOptional': 'Unlock threshold (optional)',
    'gatedPublish.noThreshold': 'No threshold',
    'gatedPublish.thresholdHint':
        'Holders need at least this many {tick} after a send to receive the unlock key. This is a first-access lock, not copy protection: anyone who ever got the key keeps it, even if they later hold less.',
    'gatedPublish.pack.add': 'Add to pack',
    'gatedPublish.pack.unlockTogether': '(files in this pack unlock together)',
    'gatedPublish.pack.loading': 'Loading reusable packs…',
    'gatedPublish.pack.empty':
        'No reusable packs in this wallet yet. Files published under one pack share a single key and unlock together.',
    'gatedPublish.ackForever':
        'I understand the encrypted file is published on-chain forever and the gate cannot be removed later.',

    // --- governance ----------------------------------------------
    'governance.title': 'Governance',
    'governance.noAddress.title': 'No governance address',
    'governance.noAddress.body': 'Governance requires an address on a supported chain.',
    'governance.createPoll': 'Create poll',
    'governance.delegateVotes': 'Delegate votes',
    'governance.loadingAddresses': 'Loading governance addresses…',
    'governance.loadingAddressesLabel': 'Loading governance addresses',
    'governance.loadingPolls': 'Loading governance polls…',
    'governance.loadingPollsLabel': 'Loading governance polls',
    'governance.error.addresses': 'Could not load governance addresses. Try again.',
    'governance.error.polls': 'Could not load governance polls. Try again.',
    'governance.empty.title': 'No polls yet',
    'governance.empty.body': 'Polls created on this chain appear here.',
    'governance.closesAtBlock': 'Closes at block {block}',

    // --- wallet import -------------------------------------------
    'importWallet.lane': 'Import lane',
    'importWallet.recoveryPhrase': 'Recovery phrase',
    'importWallet.encryptedBackup': 'Encrypted backup',
    'importWallet.browse': 'Browse',
    'importWallet.restoring': 'Restoring…',
    'importWallet.importing': 'Importing…',
    'importWallet.import': 'Import',
    'importWallet.title': 'Import wallet',
    'importWallet.freeWallet.fullTitle': 'Import from FreeWallet',
    'importWallet.freeWallet.title': 'FreeWallet import',
    'importWallet.backup.fullTitle': 'Restore from encrypted backup',
    'importWallet.backup.title': 'Restore backup',
    'importWallet.existing.fullTitle': 'Import an existing wallet',
    'importWallet.freeWallet.fullSubtitle':
        'Paste your 12-word FreeWallet recovery phrase. We detect BIP39 or the legacy Counterwallet/FreeWallet format automatically so the correct address derivation is used.',
    'importWallet.freeWallet.subtitle':
        'Paste your 12-word FreeWallet recovery phrase. Its format is detected automatically.',
    'importWallet.backup.addFullSubtitle':
        "Restore an encrypted backup as a new wallet alongside your existing one(s). The wallet record gets a fresh id at decode time so the two wallets don't collide.",
    'importWallet.backup.replaceFullSubtitle':
        'Pick a `.xchain-wallet` file you exported from this app, then fill in the three passwords a restore needs.',
    'importWallet.backup.addSubtitle': "Restore as a new wallet (won't replace your existing one).",
    'importWallet.backup.replaceSubtitle': 'Pick a backup file, then fill in the three passwords below.',
    'importWallet.phrase.fullSubtitle':
        'Enter a BIP39 recovery phrase (12, 15, 18, 21, or 24 words) or a Counterwallet 12-word recovery phrase. The format is detected automatically.',
    'importWallet.phrase.subtitle': 'Paste a 12-, 15-, 18-, 21-, or 24-word recovery phrase.',
    'importWallet.backup.file': 'Backup file',
    'importWallet.cancelScan': 'Cancel scan',
    'importWallet.scanPointerQr': 'Scan pointer QR',
    'importWallet.backup.scannerAlt': 'Backup-pointer QR scanner',
    'importWallet.backup.pointerLoaded': 'Backup pointer loaded{name}.',
    'importWallet.backup.location': 'Location: {location}',
    'importWallet.backup.useFile': 'Use a file instead',
    'importWallet.backup.chooseFile': 'Choose backup file',
    'importWallet.backup.contents': 'Backup file contents',
    'importWallet.backup.placeholder.version': '"version":1,"kdf":',
    'importWallet.backup.placeholder.kdf': '"name":"argon2id"…',
    'importWallet.backup.overwrite': 'Overwrite if any record collides (advanced)',
    'importWallet.pastePhrase': 'Paste recovery phrase from clipboard',
    'importWallet.scanQr': 'Scan QR',
    'importWallet.phrase.scannerAlt': 'Recovery-phrase QR scanner',
    'importWallet.phrase.fullPlaceholder': 'word word word word word word word word word word word word',
    'importWallet.phrase.placeholder': 'word word word…',
    'importWallet.phrase.freeWalletCount': '{count} / 12 words',
    'importWallet.phrase.wordCount':
        '{count, plural, one {# word entered (use 12, 15, 18, 21, or 24)} other {# words entered (use 12, 15, 18, 21, or 24)}}',
    'importWallet.phrase.bip39Detected': 'BIP39 recovery phrase detected',
    'importWallet.phrase.counterwalletDetected': 'Counterwallet/FreeWallet recovery phrase detected',
    'importWallet.phrase.suggestions': 'BIP39 word suggestions',
    'importWallet.phrase.useWord': 'Use BIP39 word "{word}"',
    'importWallet.phrase.releaseToLoad': 'Release to load',
    'importWallet.phrase.dropHint': 'Drop a .txt file with your recovery phrase to load it here.',
    'importWallet.walletName': 'Wallet name',
    'importWallet.password.fullHint': 'At least {count} characters. Encrypts the wallet on this device.',
    'importWallet.password.hint': 'At least {count} characters.',
    'importWallet.confirmPassword': 'Confirm password',
    'importWallet.confirm': 'Confirm',
    'importWallet.passphrase.toggle': 'This wallet uses a BIP39 passphrase',
    'importWallet.passphrase.help': 'BIP39 passphrase help',
    'importWallet.passphrase.helpBody':
        'The optional 25th word that derives a different wallet from the same recovery phrase. Required to land on the same addresses as the original software wallet. You enter it once here; the wallet stores it, protected by your password, and will not ask for it again on this device. Hardware wallets (Trezor / Ledger) handle passphrases on the device itself; pair a hardware wallet via Add Account → Hardware Signer instead.',
    'importWallet.passphrase.label': 'BIP39 passphrase',
    'importWallet.passphrase.hint': 'Required to derive the same addresses as the original wallet.',
    'importWallet.backToSetup': 'Back to wallet setup',
    'importWallet.openInTab': 'Open in tab',

    // --- token issue ---------------------------------------------
    'issue.reviewTitle': 'Review issue',
    'issue.title': 'Issue token',
    'issue.issuance': 'issuance',
    'issue.success': 'Token issued',
    'issue.broadcastComplete': 'Broadcast complete.',
    'issue.reviewTokenIssue': 'Review token issue',
    'issue.draft.unfinished':
        'Your unfinished issue draft was saved. Restore it to continue. Nothing was submitted.',
    'issue.draft.discardLabel': 'Discard saved draft',
    'issue.ticker': 'Ticker',
    'issue.supply': 'Supply',
    'issue.supplyHint': 'The most that can ever exist.',
    'issue.initialMintOptional': 'Initial mint (optional)',
    'issue.initialMintHeadroom': 'Leaves {amount} to mint later.',
    'issue.initialMintHint':
        'How much exists at creation. Leave blank to mint the whole supply now; a smaller number leaves the rest to mint later.',
    'issue.maxMintOptional': 'Max mint per transaction (optional)',
    'issue.maxMintHint': 'Caps how much can be minted in one transaction. Leave blank for no limit.',
    'issue.divisible': 'Divisible (8 decimal places)',
    'issue.descriptionOptional': 'Description (optional)',
    'issue.descriptionHint': 'Up to 250 characters. Stored on-chain.',
    'issue.lockSupply': 'Lock supply + minting (irreversible)',
    'issue.lockSupplyWarning':
        'Locking minting means the {amount} left under the cap can never be minted. Clear this box to mint it later.',
    'issue.bridgingHint':
        'Bridging is off. After the token exists you can open it to other chains from Manage Token, set how deep a lock must be buried before validators sign it, and freeze both settings for your holders.',
    'issue.boundListHint':
        'One thing to decide now: a token bound to an address allow-list or block-list cannot be bridged, and a bound list can never be cleared. If you may want this token on other chains, do not bind a list to it.',
    'issue.transferOwnershipOptional': 'Transfer ownership to (optional)',
    'issue.transferOwnershipHint':
        'Leave blank to keep control. Transferring ownership does not move the minted tokens; use the field below to send those too.',
    'issue.sendInitialMintOptional': 'Send the initial mint to (optional)',
    'issue.sendInitialMintHint': 'Leave blank to keep the minted tokens at the issuing address.',

    // --- send -----------------------------------------------------
    'send.title': 'Send',
    'send.review': 'Review & send',
    'send.backToEdit': 'Back to edit',
    'send.memoForbiddenChars': 'Memo cannot contain | or ; characters.',
    'send.passwordHint': 'Required to sign.',
    'send.txid': 'Transaction ID',
    'send.testGate.title': 'First send to this address. Test it first?',
    'send.testGate.body':
        "You're sending {amount} {ticker} to a new recipient. A small test send confirms the address works before the full amount goes out.",
    'send.testGate.sendSmall': 'Send a small test first',
    'send.testGate.continue': "I've verified, continue",
    'send.signerMode':
        'This wallet is in signer mode, so it does not send or broadcast. It signs transactions passed in from a watcher wallet. Switch the mode under Settings, Wallet Mode to send from this device.',
    'send.networkFeeValue': 'Network fee: {amount} {ticker}',
    'send.queued.body':
        "Your transaction is signed but couldn't reach the network just now. It's waiting in the queued-transactions banner and won't go out until you broadcast it from there; the wallet reminds you when the network is back. Don't send this payment again.",
    'send.success.broadcastPending': 'Broadcast pending',
    'send.success.broadcastPendingBody':
        'Your transaction is on its way. It will confirm in the next few blocks; you can leave this screen at any time.',
    'send.success.copyTransactionId': 'Copy transaction id',
    'send.success.copy': 'Copy',
    'send.success.viewOnExplorer': 'View on explorer',
    'send.success.sendAnother': 'Send another',
    'send.fields.amount': 'Amount',
    'send.fields.to': 'To',
    'send.fields.chain': 'Chain',
    'send.fields.from': 'From',
    'send.fields.token': 'Token',
    'send.reviewLabel': 'Review send',
    'send.review.createUnsigned': 'Create unsigned transaction',
    'send.review.signOn': 'Sign on {device}',
    'send.review.sign': 'Sign',
    'send.review.submitAction': '{label}: send',
    'send.memoCount': '{used} / {max} characters.',
    'send.advanced.label': 'Advanced send choices',
    'send.advanced.none': 'None',
    'send.advanced.feeBumping': 'Fee bumping',
    'send.advanced.allowed': 'Allowed',
    'send.advanced.notAllowed': 'Not allowed',
    'send.advanced.coinControl': 'Coin control',
    'send.advanced.coinControlEnabled': 'Coin control enabled',
    'send.advanced.coinControlReady': 'Choose exactly which unspent outputs fund this transaction.',
    'send.advanced.coinControlUnavailable': 'Coin control is unavailable while spendable inputs cannot be loaded.',
    'send.advanced.loadingInputs': 'Loading spendable inputs…',
    'send.advanced.inputs': 'Inputs',
    'send.advanced.noInputs': 'No spendable inputs found.',
    'send.advanced.changeAddress': 'Change address',
    'send.advanced.automaticChange': 'Automatic: {address}',
    'send.advanced.changeHint': 'Any leftover native coin returns here.',
    'send.advanced.availableCount': '{count} available',
    'send.advanced.selectAll': 'Select all',
    'send.advanced.clearSelection': 'Clear',
    'send.advanced.dust': 'Dust',
    'send.advanced.dustTitle': 'Below the {sats} sat dust threshold',
    'send.advanced.summaryLabel': 'Coin control summary',
    'send.advanced.selectedTotal': 'Selected total',
    'send.advanced.approxChange': 'Approx. change',
    'send.review.multiTokenPreview':
        'This send moves more than one token, and the balance preview covers a single token at a time. Every recipient and amount is listed under Details below.',
    'send.review.details': 'Details ({count})',
    'send.device.trezor': 'Trezor',
    'send.device.ledger': 'Ledger',
    'send.watcherMode':
        'Watcher mode: this wallet will build an unsigned transaction instead of signing and broadcasting. Bring the result to your Signer-mode wallet to sign.',
    'send.watcherHardware':
        'Source address is paired to {device} on this wallet, but watcher mode does not sign here. Pair the same {device} on your Signer-mode wallet to sign the transaction this step produces.',
    'send.walletUnlocked': 'Wallet unlocked. No password needed.',
    'send.useMax': 'Use max',
    'send.fromAddress': 'From address',
    'send.draft.restore': 'Restore',
    'send.draft.unfinished': 'Your unfinished Send draft was saved. Restore it to continue. Nothing was submitted.',
    'send.draft.discardLabel': 'Discard saved draft',
    'send.draft.discard': 'Discard',
    'send.source.choose': 'Choose source address',
    'send.source.hint': 'Only what this address holds can be sent.',
    'send.source.noAddress': 'No address on this chain. Use Receive to generate one first.',
    'send.destination.placeholder': 'Enter or paste an address or name...',
    'send.paste.checkLabel': 'Check pasted recipient',
    'send.paste.checkHint': 'Compare the first and last 6 characters.',
    'send.saveRecipient.open': 'Save recipient',
    'send.saveRecipient.nameLabel': 'Contact name',
    'send.saveRecipient.save': 'Save contact',
    'send.saveRecipient.saving': 'Saving…',
    'send.saveRecipient.saved': 'Recipient saved to contacts.',
    'send.token.hint': 'Tick. Native coin by default.',
    'send.balance.unavailable': 'Balance unavailable ({error})',
    'send.balance.available': '{amount} {ticker} available',
    'send.recipient.heading': 'Recipient {number}',
    'send.recipient.removeLabel': 'Remove recipient {number}',
    'send.recipient.remove': 'Remove',
    'send.recipient.addressLabel': 'Recipient {number} address',
    'send.recipient.tokenLabel': 'Recipient {number} token',
    'send.recipient.amountLabel': 'Recipient {number} amount',
    'send.recipient.selectToken': 'Select token for recipient {number}',
    'send.recipient.differentToken': 'Different token per recipient',
    'send.recipient.differentTokenOff': 'Off: every recipient gets {token}.',
    'send.recipient.tokenAbove': 'the token above',
    'send.recipient.total':
        'Total: {total} across {count} recipients, in one transaction and one network fee.',
    'send.recipient.add': '+ Add recipient',
    'send.recipient.maximum':
        '{count} recipients is the most one send carries. Use an airdrop to distribute to a longer list.',
    'send.gated.ready':
        'This token has gated content. The unlock key will be securely attached to this send so the recipient can open it. Gated tokens can only be sent to addresses that have made at least one transaction.',
    'send.gated.partial':
        'This token has {total} gated content packs and this wallet holds keys for only {available} of them. The recipient will NOT be able to open the missing pack(s): {missing}… You can still send, or recover the missing keys first (unlock the content once from the address that received it).',
    'send.gated.blocked':
        'This token has gated content, and this wallet holds none of its unlock keys. Sending without the key attached would be rejected by the network, and the recipient could never open the content.',
    'send.gated.softwareSigner':
        "Key recovery needs a software signer (the scan decrypts messages with the address's private key, which this signer cannot do). If this wallet published the content, the key is already stored and this notice will not appear; otherwise recover the key from a software wallet holding this address.",
    'send.gated.passwordLabel': 'Wallet password (scan for keys)',
    'send.gated.passwordHint':
        'Scans messages sent to your addresses for the unlock key and stores it in this wallet.',
    'send.gated.recover': 'Recover keys',
    'send.networkFee': 'Network fee',
    'send.advanced': 'Advanced',
    'send.memo': 'Memo',
    'send.rbf.label': 'Allow fee bumping (replace-by-fee)',
    'send.rbf.helpLabel': 'Replace-by-fee help',
    'send.rbf.help':
        'Allows this unconfirmed transaction to be replaced with one that pays a higher fee, so it can confirm sooner or be cancelled.',
    'send.rbf.enabledHint':
        'Allows this transaction to be sped up or cancelled with a higher fee before confirmation.',
    'send.rbf.unsupported': 'Fee bumping is not supported on {chain}.',
    'send.rbf.thisChain': 'this chain',
    'send.rbf.enabledLabel': 'Replace-by-fee enabled',
    // M2.4: the success card's in-wallet link to the merged History entry.
    // The entry exists the moment this card does (built from the wallet's
    // own pending record), but the network has not necessarily reported it
    // yet, so the hint sets that expectation instead of letting a still-
    // "awaiting network" row read as broken.
    'send.success.viewInHistory': 'View in history',
    'send.success.viewInHistoryHint':
        'It is already in your history. It may still read "Broadcast, '
        + 'awaiting network" for up to a minute before the network reports it.',

    // --- extension banner ----------------------------------------

    // --- xchain: URI intent labels (Cluster L FOLLOWUP 5) ---------
    'uri.intent.send': 'Send',
    'uri.intent.sendTo': 'Send to {address}',
    'uri.intent.sendToken': 'Send {tick}',
    'uri.intent.sendAssetTo': 'Send {tick} to {address}',
    'uri.intent.sendAmount': 'Send {amount} {tick}',
    'uri.intent.sendAmountTo': 'Send {amount} {tick} to {address}',
    'uri.intent.receive': 'Receive',
    'uri.intent.receiveAt': 'Receive at {address}',
    'uri.intent.receiveAsset': 'Receive {tick}',
    'uri.intent.receiveAssetAt': 'Receive {tick} at {address}',
    'uri.intent.receiveAmount': 'Receive {amount} {tick}',
    'uri.intent.receiveAmountAt': 'Receive {amount} {tick} at {address}',
    'uri.intent.execute': 'Call contract #{contract}',
    'uri.intent.executeMethod': 'Call {method} on contract #{contract}',
    'uri.intent.unknown': 'Unrecognized link',

    // --- scan route (Cluster R FOLLOWUP 2: i18n migration beachhead) -
    'scan.title': 'Scan',
    'scan.scannerAlt': 'Scan a QR code',
    'scan.routing': 'Scanned, routing…',
    'scan.pasteLabel': 'Or paste it here',
    'scan.pastePlaceholder': 'xchain:… / bitcoin:… / address / transaction hex',
    'scan.classifyPaste': 'Use pasted text',
    'scan.error.pasteEmpty': 'Paste something first.',
    'scan.error.unknownXchainIntent':
        'xchain: URI was scanned but the intent was not recognized. Try a clearer code.',
    'scan.error.paymentRequest':
        'This payment request does not match a supported chain or valid address.',
    'scan.error.wif':
        'A private key (WIF) was scanned. Use Import Wallet → Import WIF to add it deliberately.',
    'scan.error.mnemonic':
        'A recovery phrase was scanned. Use Import Wallet → Recovery phrase to add it deliberately.',
    'scan.error.xcwChunk':
        'Part {n} of {total} of a multi-frame QR code was scanned. Open the screen that asked for this code and capture every frame there.',
    'scan.error.transactionHex':
        'A signed transaction was scanned. This screen cannot broadcast raw transaction hex. Use a compatible broadcasting tool.',
    'scan.error.backupPointer':
        'A backup pointer was scanned. Start Import Wallet, choose Restore from backup, and scan it there.',
    'scan.error.pairingCode':
        'A wallet pairing code was scanned. Start Pair a watcher or signer, and scan it there.',
    'scan.error.unknown':
        'This QR code contains text the wallet does not know how to use.',

    // --- history --------------------------------------------------
    'history.title': 'History',
    'history.refresh': 'Refresh history',
    'history.refreshing': 'Refreshing history',
    'history.showMore': 'Show more history',
    'history.itemsShown': '{shown} of {total} history items shown',
    'history.showMoreGroupEntries': 'Show more group entries ({shown} of {total} shown)',
    'history.recipients.noHoldersFound': 'No holders found',
    'history.recipients.noRecipientsFound': 'No recipients found',
    'history.recipients.noHoldersBody': 'Token holders appear here after balances are indexed.',
    'history.recipients.noRecipientsBody': 'Matching recipients appear here after history is indexed.',
    'history.loading': 'Loading history',
    'history.empty.noAddressesTitle': 'No addresses yet',
    'history.empty.noAddressesBody': 'Generate a receive address to populate history.',
    'history.empty.noMatchesTitle': 'No results for these filters',
    'history.empty.noMatchesBody': 'Reset the filters to see all history.',
    'history.empty.clearFilters': 'Reset filters',
    'history.empty.noCrossChainTitle': 'No cross-chain actions yet',
    'history.empty.noCrossChainBody':
        'Cross-chain transfers sent or received by this wallet appear here.',
    'history.empty.noActivityTitle': 'No activity yet',
    'history.empty.noActivityBody':
        'Once you send or receive on the selected chains, the activity feed populates.',
    'history.filters.label': 'History filters',
    'history.filters.searchPlaceholder': 'Search action, address, token, txid, memo…',
    'history.filters.searchLabel': 'Search history',
    'history.filters.fromDate': 'From date',
    'history.filters.toDate': 'To date',
    'history.filters.additionalDetails': 'Additional details',
    'history.filters.fiatHelp': 'Show the fiat equivalent for native-coin amounts',
    'history.filters.fiatCurrency': 'Fiat: {currency}',
    'history.filters.showFiat': 'Show fiat',
    'history.filters.groupingMode': 'Grouping mode',
    'history.filters.grouped': 'Grouped',
    'history.filters.flat': 'Flat',
    'history.filters.advanced': 'Advanced filters',
    'history.filters.allActionTypes': 'All action types',
    'history.filters.actionType': 'action type',
    'history.filters.actionTypes': 'Action types',
    'history.filters.allStatuses': 'All statuses',
    'history.filters.status': 'status',
    'history.filters.statusHeader': 'Status',
    'history.filters.noSpecialFilters': 'No special filters',
    'history.filters.filter': 'filter',
    'history.filters.special': 'Special',
    'history.filters.multisigOnly': 'Multisig only',
    'history.filters.allChains': 'All chains',
    'history.filters.datePresets': 'Date range presets',
    'history.filters.last7Days': '7 days',
    'history.filters.last30Days': '30 days',
    'history.filters.allDates': 'All',
    'history.filters.dateZone': 'Day boundaries use local time.',
    'history.filters.activeRange': 'Active range: {from} to {to}',
    'history.filters.anyDate': 'any date',
    'history.filters.clearDateRange': 'Clear date range',
    'history.detail.label': 'Action detail',
    'history.detail.options': 'Action options',
    'history.detail.more': 'More',
    'history.detail.noAdditionalActions': 'No additional actions',
    'history.detail.view': 'Action detail view',
    'history.detail.copyRawJson': 'Copy raw JSON',
    'history.detail.peerHeading': 'Peer · {ticker} #{index}',
    'history.detail.loadingPeer': 'Loading the linked transaction…',
    'history.detail.peerError': "Couldn't load peer: {error}",
    'history.detail.copyPeerRawJson': 'Copy peer raw JSON',
    'history.detail.peerUnavailable':
        'Peer chain not bundled in this wallet; open the block explorer for {ticker} to view {ticker} #{index}.',
    'history.detail.openNewWindow': 'Open in new window',
    'history.contact.saveAs': 'Save {address} as',
    'history.contact.name': 'Contact name',
    'history.contact.save': 'Save',
    'history.copy.clipboard': 'Copy to clipboard',
    'history.copy.copied': 'Copied',
    'history.copy.copiedTitle': 'Copied!',
    'history.copy.actionNumber': 'Copy action number',
    'history.copy.transactionId': 'Copy transaction ID',
    'history.copy.fromAddress': 'Copy from address',
    'history.copy.walletAddress': 'Copy address',
    'history.recipients.showHolders': 'Show holders',
    'history.recipients.showRecipients': 'Show recipients',
    'history.recipients.loadingHolders': 'Loading holders…',
    'history.recipients.loadingRecipients': 'Loading recipients…',
    'history.recipients.saved':
        'Saved {count, plural, one {# address} other {# addresses}} as a single contact "{name}".',
    'history.recipients.holderCount':
        '{count, plural, one {# holder} other {# holders}}',
    'history.recipients.recipientCount':
        '{count, plural, one {# recipient} other {# recipients}}',
    'history.recipients.moreNotShown': '… and {count} more not shown',
    'history.recipients.saveAsContact': 'Save {count} as one contact',
    'history.row.linkedTo': 'Linked to {ticker} #{index}',
    'history.row.block': 'Block {block}',
    'history.row.confirmations': '{count} Confirms',
    'history.row.receivedAt': 'Received at {label}',
    'history.group.latest': 'Latest {when}',
    'history.status.confirmed': 'Confirmed',
    'history.status.failed': 'Failed',
    'history.status.pending': 'Pending',
    'history.export.noMatchingRows': 'No rows match the current filters.',
    'history.export.noRows': 'There are no history rows to export.',
    'history.export.open': 'Export…',
    'history.export.title': 'Export history',
    'history.export.format': 'Format',
    'history.export.csv': 'CSV (RFC-4180; compact, opens in spreadsheets)',
    'history.export.json': 'JSON (preserves the full row including link / raw)',
    'history.export.columns': 'Columns',
    'history.export.rowCount':
        '{count, plural, one {# filtered row will be exported.} other {# filtered rows will be exported.}}',
    'history.export.confirm': 'Export',

    // --- pending (unconfirmed) transactions -----------------------
    // Terminology is fixed: "pending" in every string a user reads,
    // "unconfirmed" only in data and method names. Nothing here may say
    // confirmed or accepted either, because a mempool sighting is
    // pre-validation: the indexer can still reject the action when the
    // block lands, and copy that promises otherwise is a lie the wallet
    // has no way to take back.
    // Backend component names ("indexer", "decoder", "utxo-tracker") stay
    // out of the strings: say "the service" for a backend that is behind or
    // cannot answer, matching humanizeError's backend_behind copy, and keep
    // "the network" for the chain and the mempool, which is what the sibling
    // pending strings above already mean by it.
    'pending.row.awaitingNetwork': 'awaiting network',
    'pending.row.seen': 'pending',
    'pending.row.notSeen': 'not seen by network',
    'pending.row.dropped': 'no longer seen by network',
    'pending.row.replaced': 'replaced',
    'pending.row.confirmed': 'confirmed',
    'pending.row.generic': 'pending',
    // The wallet gave up before the network took the send. Its own record is
    // the only trace, so the row says so plainly rather than "pending".
    'pending.row.failed': 'failed, never sent',

    'pending.detail.sectionLabel': 'Pending transaction',
    'pending.detail.failedSectionLabel': 'Failed transaction',
    'pending.detail.failed': 'Failed before it reached the network',
    'pending.detail.failedHelp':
        'This wallet could not complete the send. Nothing was broadcast, so no coins moved and no fee was paid. You can send again.',
    'pending.detail.technicalDetails': 'Technical details',
    'pending.detail.dismissFailed': 'Remove from history',
    // A transaction this wallet proved into a block that no feed will ever
    // list: a plain coin transfer, or an action the service recorded nothing
    // for. Both say what the block settled and what it did not.
    'pending.detail.confirmedSectionLabel': 'Confirmed transaction',
    'pending.detail.confirmed': 'Confirmed on the network',
    'pending.detail.confirmedHelp':
        'A block carries this transaction. It moved coins only, so the service has no action to report for it.',
    'pending.detail.confirmedNoEffect': 'Confirmed, no effect',
    'pending.detail.confirmedNoEffectHelp':
        'A block carries this transaction, and the service recorded no action for it. Any coins it moved have moved; nothing else took effect.',
    'pending.detail.confirmedBlock': 'Included in block {block}',
    'pending.detail.awaitingNetwork': 'Broadcast, awaiting network',
    'pending.detail.seen': 'Held by the network, waiting for a block',
    'pending.detail.notSeen': 'Not seen by the network',
    'pending.detail.dropped': 'No longer seen by the network',
    'pending.detail.replaced': 'Replaced by a newer transaction',
    'pending.detail.awaitingNetworkHelp':
        'The transaction has been sent. It can take a minute before any node reports holding it.',
    'pending.detail.seenHelp':
        'A node is holding this transaction, and no miner has put it in a block yet.',
    'pending.detail.notSeenHelp':
        'Nothing has reported this transaction since it was broadcast, so it may never have reached the network.',
    'pending.detail.droppedHelp':
        'A node reported this transaction earlier and no longer does, and no block carries it yet.',
    'pending.detail.replacedHelp':
        'This wallet replaced this transaction with a newer one. Follow the replacement instead.',
    'pending.detail.notValidated': 'Pending, not yet validated by the service.',
    'pending.detail.firstSeen': 'First seen by the network {when}',
    'pending.detail.broadcastAt': 'Broadcast from this wallet {when}',
    'pending.detail.replacementTx': 'Replacement transaction: {txHash}',
    'pending.detail.decodedHeading': 'What this transaction does',
    'pending.detail.sendOutput': '{amount} {tick} to {destination}',
    'pending.detail.memo': 'Memo: {memo}',
    'pending.detail.undecodable':
        'This wallet does not read {action} data. The fields below are shown exactly as the network carries them.',
    'pending.detail.localRecordNote':
        'Taken from this wallet\'s own record of the send. The network has not reported the transaction data yet.',
    'pending.detail.noData': 'No action data has been reported for this transaction yet.',

    // M2.5: the amount annotation on a pending row. Verbs still in
    // progress, never a settled figure and never a signed one: the
    // wallet only puts a side on this when it recognized one of the
    // parties as its own, and "moves" is everything it knows otherwise.
    // The caveat travels with the figure as its accessible name, because
    // the styling that sets it apart from the settled amounts below it
    // is not something a screen reader conveys.
    'pending.amount.entry': '{amount} {tick}',
    'pending.amount.separator': ', ',
    'pending.amount.sending': 'sending {amounts}',
    'pending.amount.receiving': 'receiving {amounts}',
    'pending.amount.moving': 'moves {amounts}',
    'pending.amount.caveat': 'Pending, not yet validated by the service: {summary}',

    // --- flow status and error copy -------------------------------
    'flows.biometric.browserUnsupported':
        'This browser does not support the sign-in technology biometric unlock needs.',
    'flows.biometric.deviceUnavailable':
        'This device has no built-in fingerprint, face, or PIN unlock that this browser can use. Set one up in your system settings, then come back.',
    'flows.biometric.probeFailed':
        'This browser could not check whether a built-in unlock method is available.',
    'flows.biometric.genericUnavailable': 'Biometric unlock is not available on this device.',

    'flows.dispenserAddress.self':
        'This is the source address itself, so it can always host its own dispenser.',
    'flows.dispenserAddress.preference':
        'Allowed: this address lets anyone open a dispenser on it.',
    'flows.dispenserAddress.fresh':
        'Allowed: this address has no on-chain history, so anyone may open the first dispenser on it.',
    'flows.dispenserAddress.origin':
        'Allowed: your source address opened a dispenser here before, so it may open another.',
    'flows.dispenserAddress.ownerOnly': 'This address only lets its owner open dispensers.',
    'flows.dispenserAddress.unknown':
        'Could not confirm this address accepts your dispenser; the network will decide. If it refuses, the network fee is lost.',

    'flows.pairPartner.unavailableHelp':
        'Pairing applies to Watcher and Signer wallets. Pick one of those modes first, then pair this wallet with its other half.',
    'flows.pairPartner.pairSigner': 'Pair a signer',
    'flows.pairPartner.pairWatcher': 'Pair a watcher',
    'flows.pairPartner.watcherHelp':
        'This wallet watches your coins and builds unsigned transactions. Pair it with the offline wallet that holds the same recovery phrase and signs them.',
    'flows.pairPartner.signerHelp':
        'This wallet signs transactions offline. Pair it with the online wallet that holds the same recovery phrase and watches your coins.',
    'flows.pairPartner.modeMismatch':
        'This wallet is in {localMode} mode, so its partner must be in {partnerMode} mode. The wallet you scanned is in {scannedMode} mode.',
    'flows.pairPartner.noSharedChains':
        'The two wallets have no chain in common, so there is nothing to compare. Switch on at least one matching chain in both wallets and try again.',
    'flows.pairPartner.seedMismatch':
        'These two wallets were made from different recovery phrases ({chains} does not match). Restore both halves from the same phrase and pair again.',
    'flows.pairPartner.paired':
        'Paired. Both wallets come from the same recovery phrase and agree on {count, plural, one {# chain} other {# chains}}.',

    'flows.protocolFee.freeLabel': 'This action has no protocol fee',
    'flows.protocolFee.freeHint':
        'Only the network fee applies, so there is nothing to pay on top of it.',
    'flows.protocolFee.forfeit':
        'The fee is sent on-chain and is not refunded if the network rejects this transaction.',
    'flows.protocolFee.conditionalForfeit':
        'If this action charges one, it is sent on-chain and is not refunded if the network rejects this transaction.',
    'flows.protocolFee.amount': "This action's protocol fee is {amount} XCHAIN.",
    'flows.protocolFee.paidIn': 'Protocol fee is paid in {ticker}',
    'flows.protocolFee.paidInPlural': 'Protocol fees are paid in {ticker}',
    'flows.protocolFee.onlyWay':
        '{ticker} is the only way to pay a protocol fee on this chain.',
    'flows.protocolFee.unverifiedNotice':
        'The amount is exact, but the network does not check contract actions in advance, so it cannot tell you beforehand whether this one will be accepted. If it is rejected, the fee is still spent.',
    'flows.protocolFee.toggleLabel': 'Pay protocol fee in {ticker} instead of XCHAIN',

    'flows.rbf.unsupportedBuild': 'RBF replacement is not supported by this build.',
    'flows.rbf.noEntry': 'No entry to replace.',
    'flows.rbf.noHash': 'No transaction hash on this entry.',
    'flows.rbf.alreadyConfirmed': 'Already confirmed.',
    'flows.rbf.actionUnsupported': '{action} actions are not RBF-replaceable.',
    'flows.rbf.notAllowed': 'This transaction did not allow fee replacement.',
    'flows.rbf.nothingToUndo': 'Nothing to undo.',
    'flows.rbf.cancelConfirmed': 'The cancellation already confirmed.',

    'flows.signRisk.alwaysConfirm':
        "You've set the wallet to always require explicit cross-check confirm on hardware signs.",
    'flows.signRisk.multisig':
        'Multisig contributions deserve an explicit cross-check. Your cosigners trust this signature.',
    'flows.signRisk.firstRecipient':
        "First-time recipient. Confirm the address on your device matches what's shown here.",
    'flows.signRisk.largeAmount':
        'Large amount ({amount} sats). Confirm both path and address on your device.',

    'flows.pasteIntegrity.changed': 'Clipboard contents changed between paste and re-read.',
};

// Default export so the lazy locale loader (`import.meta.glob(..., {
// import: 'default' })` in i18n/index.js) can pull this dictionary as a
// code-split chunk. The named `en` export stays for existing consumers.
export default en;
