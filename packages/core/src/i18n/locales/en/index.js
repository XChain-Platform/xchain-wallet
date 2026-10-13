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
    'common.clear': 'Clear',
    'common.copyTransactionId': 'Copy transaction ID',
    'common.tryAgain': 'Try again',
    'common.openNetworkSettings': 'Open Network settings',
    'common.done': 'Done',
    'common.loading': 'Loading…',
    'common.password': 'Password',
    'common.confirm': 'Confirm',
    'common.settingsUnavailable': 'Settings unavailable.',
    'common.edit': 'Edit',
    'common.estimateUnavailable': 'Estimate unavailable',
    'common.networkFeeUnavailable': 'Network fee estimate unavailable.',
    'common.notAvailable': 'n/a',
    'common.preview': 'Preview',
    'common.review': 'Review',
    'common.watcherBuildsUnsigned':
        'Watcher mode: this wallet will build an unsigned transaction. Sign it on your Signer-mode wallet, then bring the signed transaction to a Full-mode wallet to broadcast.',
    'common.contactName': 'Contact name',

    // --- shared components ---------------------------------------
    'adsNotice.title': 'Automatic Donation System',
    'adsNotice.subtitle':
        'XChain Platform includes an Automatic Donation System (ADS) that supports continued development.',
    'adsNotice.defaultBehavior':
        'ADS is on by default. It sets aside a small amount when you send a transaction and sends it as one donation once it adds up.',
    'adsNotice.optional':
        "You don't need to donate to use XChain Platform.",
    'adsNotice.settings':
        'Choose the amount and frequency under Settings → Automatic Donation System. ADS can also be turned off entirely there.',
    'adsNotice.continue': 'Continue',
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
    'settings.network.switchError': "Couldn't switch networks. Try again.",
    'settings.undoSend.label': 'Hold signed sends before broadcast',
    'settings.undoSend.hintUnavailable':
        "This build can't hold sends. The preference is saved for a build that supports it.",
    'settings.undoSend.hintAvailable':
        "When enabled, holds each signed send for the duration below so you can cancel it before broadcast. A duration of 0 doesn't hold sends.",
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
    'accountPicker.error.load': "Couldn't load accounts. Try again.",
    'accountPicker.loading': 'Loading accounts…',
    'accountPicker.loadingLabel': 'Loading accounts',

    // --- action routes -------------------------------------------
    'actionDetail.back': 'Back to history',
    'actionDetail.title': 'Action',
    'actionDetail.empty.title': 'No action selected',
    'actionDetail.empty.body': 'Action details appear here after one is selected.',
    'actionDetail.offline':
        'You are offline. Showing saved action details. Network actions will be available when your connection returns.',
    'actionsMenu.more': 'More actions',
    'actionsMenu.title': 'Token actions',
    'actionsMenu.unavailable': 'Unavailable: {reason}',

    // --- alerts --------------------------------------------------
    'alerts.empty.title': 'No alerts',
    'alerts.empty.body': "You're all caught up.",
    'alerts.unreadCount': '{count} unread',
    'alerts.markAllRead': 'Mark all read',
    'alerts.clear': 'Clear alerts',
    'alerts.unread': 'Unread',
    'alerts.read': 'Read',
    'alerts.markRead': 'Mark read',
    'alerts.markReadLabel': 'Mark {title} read',

    // --- bridged tokens ------------------------------------------
    'bridgeOrigin.onChainName': 'On-chain token name: {tick}',
    'bridgeOrigin.from': 'Bridged from {origin}',

    'loading.error.title': "The wallet couldn't start.",
    'loading.error.body': "Something stopped the wallet from opening. Your wallet data hasn't been changed.",
    'loading.error.recovery':
        "Choose Try again. If the wallet still doesn't open, contact support before clearing any wallet data.",

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
    'market.refreshPrices': 'Refresh prices',
    'market.stalePrice': 'The latest trade is over 24 hours old. Check the price before placing an order.',
    'market.loading': 'Loading market',
    'market.panels': 'Market panels',
    'market.change24hLabel': '24-hour change. {change}',

    'multisig.share.title': 'Share this wallet as a cosigner',
    'multisig.share.instructions':
        'Give these values to the person creating the multisig. In their wallet they add a cosigner with origin "External xpub" and paste each one into the field of the same name. They are public keys: they show the shared address but can\'t spend from it.',
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
    'routeNotFound.body': "This page doesn't exist or is no longer available.",
    'routeNotFound.backToHome': 'Back to Home',

    // --- signer selection ---------------------------------------
    'signerSelect.choose': 'Choose signer',
    'signerSelect.title': 'Signer',
    'signerSelect.intro':
        "Choose where this operation derives its keys. This choice doesn't share recovery words or hardware secrets.",
    'signerSelect.watcherNote':
        "Watch-only mode remains active. Selecting a key source here doesn't enable local transaction signing.",

    // --- rename forms -------------------------------------------
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
        "Don't do this unless you have your recovery phrase or an encrypted backup file to hand.",
    'vaultUnavailable.wipeConfirm': 'Type WIPE to confirm',

    // --- signature verification ---------------------------------
    'verifySignature.title': 'Verify signature',
    'verifySignature.valid': 'Valid signature. Signature matches this message and address.',
    'verifySignature.invalid': "Invalid signature. Signature doesn't match this message and address.",
    'verifySignature.malformed': 'Malformed signature. Enter a base64-encoded signature.',
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
    'walletDetails.created': 'Created',
    'walletDetails.demoWallet': 'Demo wallet (throwaway)',
    'walletDetails.id': 'ID',
    'walletDetails.upgradeRecovery': 'Upgrade recovery phrase',
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
    'home.updatingBalances': 'Updating balances…',
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
    'home.createToken': 'Create token',
    'home.markets': 'Markets',
    'home.messaging': 'Messaging',
    'home.addresses': 'Addresses',
    'home.contracts': 'Contracts',
    'home.staking': 'Staking',
    'home.sendOffline': 'Send needs a network connection',
    'home.settings': 'Settings',
    'home.lockWallet': 'Lock wallet',
    'home.signer.region': 'Signer-mode home',
    'home.signer.title': 'Signer mode',
    'home.signer.body':
        "This wallet only signs transactions from a paired Watcher wallet. Send / Receive / balances aren't available. Switch the wallet's mode in Settings → Wallet Mode if you want full-wallet behaviour back.",
    'home.signer.signTransaction': 'Sign a transaction',
    'home.signer.signMessage': 'Sign a message',
    'home.signer.verifySignature': 'Verify a signature',

    // --- contract execution --------------------------------------
    'execute.review.title': 'Review contract call',
    'execute.loadingAddresses': 'Loading addresses…',
    'execute.success': 'Method call broadcast.',
    'execute.executeOn':
        'Call on {network}',
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
        "Permanent: the encrypted bytes live on-chain forever and the gate can't be removed later, only the key re-shared. One transaction publishes the file and records your recovery copy of the key; there is no key-less window.",
    'gatedPublish.watcherHint':
        'Watcher mode: this builds an unsigned transaction. The pack key stays in THIS wallet either way.',
    'gatedPublish.gatedContent': 'Gated content',
    'gatedPublish.formHint.beforeToken': 'Publish a file that only holders of',
    'gatedPublish.formHint.afterToken':
        'can read. The file is encrypted before it touches the chain; the key travels automatically with every normal send of the token.',
    'gatedPublish.ownerMissing.beforeAddress': "This wallet doesn't hold the owner address",
    'gatedPublish.ownerMissing.afterAddress':
        'for {tick}. Only the token owner can publish gated files.',
    'gatedPublish.fileLimit': 'File (up to about {bytes} bytes)',
    'gatedPublish.fileToPublish': 'File to publish',
    'gatedPublish.titleOptional': 'Title (optional)',
    'gatedPublish.titleField': 'Title',
    'gatedPublish.memoOptional': 'Memo (optional)',
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
        "I understand the encrypted file is published on-chain forever and the gate can't be removed later.",

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
    'governance.error.addresses': "Couldn't load governance addresses. Try again.",
    'governance.error.polls': "Couldn't load governance polls. Try again.",
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
    'importWallet.wif.fullTitle': 'Import a private key',
    'importWallet.wif.title': 'Import private key',
    'importWallet.wif.subtitle':
        'Import one WIF private key as a wallet. Pick the matching chain so the correct address is derived.',
    'importWallet.wif.tab': 'Private key',
    'importWallet.wif.key': 'WIF private key',
    'importWallet.wif.chain': 'Private key chain',
    'importWallet.wif.ack': "I understand this key isn't recoverable from a recovery phrase.",
    'importWallet.freeWallet.fullSubtitle':
        'Enter your 12-word FreeWallet recovery phrase. XChain Platform can detect BIP39 or the legacy Counterwallet/FreeWallet format automatically.',
    'importWallet.freeWallet.subtitle':
        'Enter your 12-word FreeWallet recovery phrase.',
    'importWallet.backup.addFullSubtitle':
        'Restore an encrypted backup as a new wallet. Your existing wallets stay in place.',
    'importWallet.backup.replaceFullSubtitle':
        'Choose a `.xchain-wallet` backup. Then enter its file, wallet, and device passwords.',
    'importWallet.backup.addSubtitle':
        'Restore as a new wallet. Your existing wallets stay in place.',
    'importWallet.backup.replaceSubtitle':
        'Choose a backup file, then enter the three passwords below.',
    'importWallet.phrase.fullSubtitle':
        'Enter a BIP39 recovery phrase with 12, 15, 18, 21, or 24 words, or a 12-word Counterwallet recovery phrase. XChain Platform detects the format.',
    'importWallet.phrase.subtitle':
        'Enter a recovery phrase with 12, 15, 18, 21, or 24 words.',
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
    'importWallet.phrase.scannerAlt':
        'Recovery phrase QR scanner',
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
    'importWallet.password.fullHint':
        'At least {count} characters. Encrypts this wallet on this device.',
    'importWallet.password.hint': 'At least {count} characters.',
    'importWallet.confirmPassword': 'Confirm password',
    'importWallet.passphrase.toggle': 'This wallet uses a BIP39 passphrase',
    'importWallet.passphrase.help': 'BIP39 passphrase help',
    'importWallet.passphrase.helpBody':
        'This extra secret combines with your recovery phrase to recreate the same wallet. It stays behind your password here; hardware wallets request it on the device and connect through Add Account, then Hardware Signer.',
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
    'issue.ticker': 'Ticker',
    'issue.tickerTaken': 'Ticker "{ticker}" already exists on this network.',
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
        "One thing to decide now: a token bound to an address allow-list or block-list can't be bridged, and a bound list can never be cleared. If you may want this token on other chains, don't bind a list to it.",
    'issue.transferOwnershipOptional': 'Transfer ownership to (optional)',
    'issue.transferOwnershipHint':
        "Leave blank to keep control. Transferring ownership doesn't move the minted tokens; use the field below to send those too.",
    'issue.sendInitialMintOptional': 'Send the initial mint to (optional)',
    'issue.sendInitialMintHint': 'Leave blank to keep the minted tokens at the issuing address.',

    // --- send -----------------------------------------------------
    'send.title': 'Send',
    'send.empty.title': 'This wallet has no coins to send yet.',
    'send.empty.body': 'Receive funds on this chain before creating a send.',
    'send.review': 'Review and send',
    'send.backToEdit': 'Edit payment',
    'send.memoForbiddenChars': "A memo can't include a vertical bar (|) or semicolon (;).",
    'send.passwordHint': 'Enter your wallet password to sign this transaction.',
    'send.txid': 'Transaction ID',
    'send.testGate.title': 'First payment to this address. Send a small test first?',
    'send.testGate.body':
        'You are sending {amount} {ticker} to a new recipient. A small test payment helps you confirm the address before sending the full amount.',
    'send.testGate.sendSmall': 'Send a small test first',
    'send.testGate.continue': 'Continue with the full amount',
    'send.signerMode':
        "This wallet is in signer mode. It can sign transactions from a watch-only wallet, but it can't send them to the network. To send from this device, change the mode under Settings, Wallet mode.",
    'send.networkFeeValue': 'Network fee: {amount} {ticker}',
    'send.queued.body':
        "Your transaction is signed but couldn't reach the network. It's waiting in the queued-transactions banner and only goes out when you broadcast it from there. The wallet reminds you when the network is back. Don't send this payment again.",
    'send.success.broadcastPending': 'Broadcast pending',
    'send.success.broadcastPendingBody':
        "The network accepted your transaction. It's waiting for confirmation, which usually takes a few blocks. You can leave this screen.",
    'send.success.copy': 'Copy',
    'send.success.viewOnExplorer': 'View in block explorer',
    'send.success.sendAnother': 'Send another',
    'send.fields.amount': 'Amount',
    'send.fields.to': 'To',
    'send.fields.chain': 'Chain',
    'send.fields.from': 'From',
    'send.fields.token': 'Token',
    'send.reviewLabel': 'Review payment',
    'send.review.createUnsigned': 'Create transaction for signing',
    'send.review.signOn': 'Sign on {device}',
    'send.review.sign': 'Sign',
    'send.review.submitAction': '{label}',
    'send.memoCount':
        '{used, number} / {max, number} {used, plural, one {byte} other {bytes}}',
    'send.advanced.label': 'Advanced send choices',
    'send.advanced.none': 'None',
    'send.advanced.feeBumping': 'Fee bumping',
    'send.advanced.allowed': 'Allowed',
    'send.advanced.notAllowed': 'Not allowed',
    'send.advanced.coinControl': 'Coin control',
    'send.advanced.coinControlEnabled': 'Coin control enabled',
    'send.advanced.coinControlReady': 'Choose exactly which unspent outputs fund this transaction.',
    'send.advanced.coinControlUnavailable': "Coin control is unavailable while spendable inputs can't be loaded.",
    'send.advanced.loadingInputs': 'Loading spendable inputs…',
    'send.advanced.inputs': 'Inputs',
    'send.advanced.noInputs': 'No spendable inputs found.',
    'send.advanced.changeAddress': 'Change address',
    'send.advanced.automaticChange': 'Automatic: {address}',
    'send.advanced.changeHint': 'Any leftover native coin returns here.',
    'send.advanced.availableCount': '{count} available',
    'send.advanced.selectAll': 'Select all',
    'send.advanced.dust': 'Dust',
    'send.advanced.dustTitle': 'Below the {sats} sat dust threshold',
    'send.advanced.summaryLabel': 'Coin control summary',
    'send.advanced.selectedTotal': 'Selected total',
    'send.advanced.approxChange': 'Approx. change',
    'send.review.multiTokenPreview':
        'This payment includes more than one token. The balance preview shows one token at a time, but every recipient and amount appears under Details.',
    'send.review.details': 'Details ({count})',
    'send.device.trezor': 'Trezor',
    'send.device.ledger': 'Ledger',
    'send.watcherMode':
        'Watch-only mode creates a transaction without signing or sending it. Move the result to your signer wallet to sign and send it.',
    'send.watcherHardware':
        "This address is paired with {device}, but a watch-only wallet can't sign. Pair the same {device} with your signer wallet to sign the transaction.",
    'send.walletUnlocked': 'Wallet unlocked. No password needed.',
    'send.useMax': 'Use max',
    'send.fromAddress': 'From address',
    'send.draft.restore': 'Restore',
    'send.draft.unfinished': 'Your unfinished payment was saved as a draft. Restore it to continue. Nothing was sent.',
    'send.draft.discardLabel': 'Discard saved draft',
    'send.draft.discard': 'Discard',
    'send.source.choose': 'Choose source address',
    'send.source.hint': 'Only what this address holds can be sent.',
    'send.source.noAddress': 'No address on this chain. Use Receive to generate one first.',
    'send.offline.body': 'Sending needs a network connection. Your cached balance remains available.',
    'send.offline.title': 'Sending needs a network connection',
    'send.destination.placeholder': 'Enter or paste an address or name…',
    'send.paste.checkLabel': 'Check pasted recipient',
    'send.paste.checkHint': 'Compare the first and last 6 characters.',
    'send.saveRecipient.open': 'Save recipient',
    'send.saveRecipient.save': 'Save contact',
    'send.saveRecipient.saving': 'Saving…',
    'send.saveRecipient.saved': 'Recipient saved to contacts.',
    'send.token.hint': "Choose the asset to send. The network's own coin is selected by default.",
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
        'Total: {total} across {count, plural, one {# recipient} other {# recipients}}, in one transaction and one network fee.',
    'send.recipient.add': '+ Add recipient',
    'send.recipient.maximum':
        '{count, plural, one {You can include up to # recipient in one payment.} other {You can include up to # recipients in one payment.}} Create another payment for any additional recipients.',
    'send.gated.ready':
        'This token includes protected content. Its unlock key will be attached securely so the recipient can open the content. You can send it only to an address that has already made a transaction.',
    'send.gated.partial':
        "This token includes {total, plural, one {# protected content pack} other {# protected content packs}}, but this wallet has unlock keys for only {available}. The recipient can't open the missing {missingCount, plural, one {pack} other {packs}}: {missing}… You can continue, or recover the missing keys by opening the content once from the address that received it.",
    'send.gated.blocked':
        "This token includes protected content, but this wallet has none of its unlock keys. The network will reject a payment without the key, and the recipient won't be able to open the content.",
    'send.gated.softwareSigner':
        'Recovering the key requires a software wallet because it must decrypt messages with the private key. Use a software wallet that holds this address to recover the key.',
    'send.gated.passwordLabel': 'Wallet password',
    'send.gated.passwordHint':
        'Scans messages sent to your addresses for the unlock key and stores it in this wallet.',
    'send.gated.recover': 'Recover keys',
    'send.networkFee': 'Network fee',
    'send.advanced': 'Advanced',
    'send.memo': 'Memo',
    'send.rbf.label': 'Allow a higher network fee later',
    'send.rbf.helpLabel': 'Learn about changing the network fee',
    'send.rbf.help':
        'Before confirmation, you can replace this transaction with one that pays a higher network fee. This can speed it up or cancel it.',
    'send.rbf.enabledHint':
        'You can speed up or cancel this transaction by paying a higher network fee before confirmation.',
    'send.rbf.unsupported': "Changing the network fee later isn't supported on {chain}.",
    'send.rbf.thisChain': 'this chain',
    // M2.4: the success card's in-wallet link to the merged History entry.
    // The entry exists the moment this card does (built from the wallet's
    // own pending record), but the network has not necessarily reported it
    // yet, so the hint sets that expectation instead of letting a still-
    // "awaiting network" row read as broken.
    'send.success.viewInHistory': 'View in history',
    'send.success.viewInHistoryHint':
        'The transaction already appears in History. Its network status may take up to a minute to update.',

    // --- shell ---------------------------------------------------
    'shell.markets.selectAsset': 'Select coin or token',
    'shell.markets.back': 'Back to markets',
    'shell.privateKeyQr': 'Private key QR',
    'shell.messageSent': 'Message sent',
    'shell.cannotOpenLink': "Can't open link",
    'shell.unknownState': 'unknown state "{state}"',

    // --- desktop update banner ----------------------------------
    'desktopUpdate.checking': 'Checking for updates…',
    'desktopUpdate.current': 'XChain Wallet is up to date.',
    'desktopUpdate.availableVersion': 'Version {version} is available.',
    'desktopUpdate.available': 'A newer version is available.',
    'desktopUpdate.downloading': 'Downloading update…',
    'desktopUpdate.downloadProgress': 'Downloading update… {progress}%',
    'desktopUpdate.verifying': 'Verifying the downloaded update…',
    'desktopUpdate.ready': 'Update is ready to restart.',
    'desktopUpdate.restartBlocked': 'Finish the current wallet operation before restarting.',
    'desktopUpdate.checkError': "Couldn't check for updates. Check your connection and try again.",
    'desktopUpdate.installError':
        "This update couldn't be downloaded or verified, so it wasn't installed. "
        + 'Your wallet is untouched. See docs.xchain.io for steps to verify a release.',
    'desktopUpdate.download': 'Download update',
    'desktopUpdate.restart': 'Restart to update',
    'desktopUpdate.retry': 'Retry',
    'desktopUpdate.dismissLabel': 'Dismiss update notice',
    'desktopUpdate.dismiss': 'Dismiss',

    // --- extension banner ----------------------------------------
    'extensionBanner.activeTitle': 'Using your extension wallet.',
    'extensionBanner.activeBody':
        'Signing and account access route through the XChain Wallet extension on this site.',
    'extensionBanner.switchBack': 'Switch back',
    'extensionBanner.detectedTitle': 'XChain Wallet extension detected.',
    'extensionBanner.detectedBody':
        'Use your extension wallet on this site instead of the web app.',
    'extensionBanner.connecting': 'Connecting…',
    'extensionBanner.useExtension': 'Use extension wallet',
    'extensionBanner.dismissLabel': 'Dismiss extension notice',
    'extensionBanner.notNow': 'Not now',

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
        "This payment request doesn't match a supported chain or valid address. Check the request and scan again, or paste the address instead.",
    'scan.error.wif':
        'This is a private key (WIF). In XChain Platform, open Import wallet and choose Import WIF.',
    'scan.error.mnemonic':
        'This is a recovery phrase. In XChain Platform, open Import wallet and choose Recovery phrase.',
    'scan.error.xcwChunk':
        'Part {n} of {total} of a multi-frame QR code was scanned. Open the screen that asked for this code and capture every frame there.',
    'scan.error.transactionHex':
        "A signed transaction was scanned. This screen can't broadcast raw transaction hex. Use a compatible broadcasting tool.",
    'scan.error.backupPointer':
        'This is a backup pointer. In XChain Platform, open Import wallet, choose Encrypted backup, and scan it there.',
    'scan.error.pairingCode':
        'This is a wallet pairing code. In XChain Platform, open Pair a watcher or signer and scan it there.',
    'scan.error.unknown':
        "This QR code contains text the wallet doesn't know how to use. Scan a supported payment or transaction code, or paste it below instead.",

    // --- history --------------------------------------------------
    'history.title': 'History',
    'history.refresh': 'Refresh history',
    'history.refreshing': 'Refreshing history',
    'history.offline.cached': 'You are offline. Showing the last saved history. Network actions will be available when your connection returns.',
    'history.offline.empty': 'You are offline. Connect to load history and use network actions.',
    'history.offline.refreshFailed': "History didn't refresh. Showing the last saved history.",
    'history.offline.refreshTitle': 'Refreshing history needs a network connection',
    'history.showMore': 'Show more history',
    'history.itemsShown':
        '{shown, number} of {total, plural, one {# history item} other {# history items}} shown',
    'history.showMoreGroupEntries': 'Show more group entries ({shown} of {total} shown)',
    'history.recipients.noHoldersFound': 'No holders yet',
    'history.recipients.noRecipientsFound': 'No recipients yet',
    'history.recipients.noHoldersBody': 'Token holders appear here after balances are indexed.',
    'history.recipients.noRecipientsBody': 'Matching recipients appear here after history is indexed.',
    'history.loading': 'Loading history',
    'history.empty.noAddressesTitle': 'No addresses yet',
    'history.empty.noAddressesBody': 'History appears here after you generate an address and send or receive funds.',
    'history.empty.noMatchesTitle': 'No results for these filters',
    'history.empty.noSearchResultsTitle': 'No results for "{query}"',
    'history.empty.noMatchesBody': 'Matching history appears here after you reset or change the filters.',
    'history.empty.clearFilters': 'Reset filters',
    'history.empty.noCrossChainTitle': 'No cross-chain actions yet',
    'history.empty.noCrossChainBody':
        'Cross-chain transfers appear here after you send or receive one.',
    'history.empty.noActivityTitle': 'No activity yet',
    'history.empty.noActivityBody':
        'Activity appears here after you send or receive on a selected chain.',
    'history.filters.label': 'History filters',
    'history.filters.toggle': 'Filters ({count})',
    'history.filters.searchPlaceholder': 'Search action, address, token, txid, memo…',
    'history.filters.searchLabel': 'Search history',
    'history.filters.clearSearch': 'Clear history search',
    'history.filters.fromDate': 'From date',
    'history.filters.toDate': 'To date',
    'history.filters.additionalDetails': 'Additional details',
    'history.filters.fiatHelp': "Show local-currency values for the network's own coin.",
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
    'history.contact.save': 'Save',
    'history.copy.clipboard': 'Copy to clipboard',
    'history.copy.copied': 'Copied',
    'history.copy.copiedTitle': 'Copied!',
    'history.copy.actionNumber': 'Copy action number',
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
    'history.row.confirmations':
        '{count, plural, one {# Confirmation} other {# Confirmations}}',
    'history.row.receivedAt': 'Received at {label}',
    'history.group.latest': 'Latest {when}',
    'history.status.confirmed': 'Confirmed',
    'history.status.failed': 'Failed',
    'history.status.pending': 'Pending',
    'history.export.noMatchingRows': 'No rows match the current filters.',
    'history.export.open': 'Export…',
    'history.export.title': 'Export history',
    'history.export.format': 'Format',
    'history.export.csv': 'CSV (RFC-4180; compact, opens in spreadsheets)',
    'history.export.json': 'JSON (preserves the full row including link / raw)',
    'history.export.columns': 'Columns',
    'history.export.rowCount':
        '{count, plural, one {# filtered row will be exported.} other {# filtered rows will be exported.}}',
    'history.export.confirm': 'Export',
    'history.export.preparing': 'Preparing…',
    'history.export.progress': 'Preparing {completed} of {total} rows…',
    'history.export.elapsed': '{seconds} seconds elapsed.',
    'history.export.slow': 'Export is taking longer than expected. Cancel, narrow the history filters, and try again.',

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
    // The wallet gave up before the network took the send. Its own record is
    // the only trace, so the row says so plainly rather than "pending".
    'pending.row.failed': 'failed, never sent',

    'pending.detail.sectionLabel': 'Pending transaction',
    'pending.detail.failedSectionLabel': 'Failed transaction',
    'pending.detail.failed': 'Failed before it reached the network',
    'pending.detail.failedHelp':
        "This wallet couldn't complete the send. Nothing was broadcast, so no coins moved and no fee was paid. You can send again.",
    'pending.detail.technicalDetails': 'Technical details',
    'pending.detail.dismissFailed': 'Remove from history',
    // A transaction this wallet proved into a block that no feed will ever
    // list: a plain coin transfer, or an action the service recorded nothing
    // for. Both say what the block settled and what it did not.
    'pending.detail.confirmedSectionLabel': 'Confirmed transaction',
    'pending.detail.confirmed': 'Confirmed on the network',
    'pending.detail.confirmedHelp':
        'This transaction is in the permanent network record. It moved coins only, so there is no other action to show.',
    'pending.detail.confirmedNoEffect': 'Confirmed, no effect',
    'pending.detail.confirmedNoEffectHelp':
        'This transaction is in the permanent network record, but it did not complete an action. Any coin movement still took effect.',
    'pending.detail.confirmedBlock': 'Included in block {block}',
    'pending.detail.awaitingNetwork': 'Broadcast, awaiting network',
    'pending.detail.seen': 'Held by the network, waiting for a block',
    'pending.detail.notSeen': 'Not seen by the network',
    'pending.detail.dropped': 'No longer seen by the network',
    'pending.detail.replaced': 'Replaced by a newer transaction',
    'pending.detail.awaitingNetworkHelp':
        'The transaction has been sent. It can take a minute before the network reports it.',
    'pending.detail.seenHelp':
        "The network has this transaction, but it's still waiting to be added to its permanent record.",
    'pending.detail.notSeenHelp':
        "The network hasn't reported this transaction since it was sent, so it may never have arrived.",
    'pending.detail.droppedHelp':
        "The network reported this transaction earlier but no longer does, and it isn't in the permanent record.",
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
        "This wallet doesn't read {action} data. The fields below are shown exactly as the network carries them.",
    'pending.detail.localRecordNote':
        "Taken from this wallet's own record of the send. The network hasn't reported the transaction data yet.",
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

    // --- browser extension ---------------------------------------
    'extension.approval.loading': 'Loading approval request…',
    'extension.approval.unsupported': 'Unsupported approval request type.',
    'extension.approval.reject': 'Reject',
    'extension.approval.requestingSite': 'Requesting site',

    'extension.connect.title': 'Connect to XChain Wallet?',
    'extension.connect.approve': 'Connect',
    'extension.connect.declaredName': 'The site calls itself',
    'extension.connect.permissions': 'Requested permissions',
    'extension.connect.permission.accounts':
        'View the accounts you select, including their addresses and balances',
    'extension.connect.permission.chains': 'Use only the chains you select below',
    'extension.connect.permission.signing':
        'Ask separately before signing any message or transaction',
    'extension.connect.chains': 'Chains',
    'extension.connect.chains.requestedHint':
        'Choose from the chains this site requested. You can change this later.',
    'extension.connect.chains.hint':
        'Pick which chains this site can see. You can change this later.',
    'extension.connect.chains.allow': 'Allow {chain} {network}',
    'extension.connect.accounts.hint': 'Pick which accounts this site can see.',
    'extension.connect.accounts.share': 'Share {name}',
    'extension.connect.accounts.primary':
        'This site can see your primary account.',

    'extension.sign.source': 'Source',
    'extension.sign.declaredName': 'The site calls itself: {name}',
    'extension.sign.signInAs': 'Sign in as',
    'extension.sign.noSignInAddress': 'This site has no address it may sign in with.',
    'extension.sign.checkingWalletMode': 'Checking wallet mode…',
    'extension.sign.passwordHint': 'Required to sign. Your password stays in this window.',
    'extension.sign.alwaysAllow':
        'Always allow this site. You can revoke this in Connected sites.',
    'extension.sign.warningNoun.message': 'message',
    'extension.sign.signingPaths': 'Signing paths',
    'extension.sign.action.reading': 'Reading this action…',
    'extension.sign.action.unavailable':
        "This action couldn't be described. Approve only if you know exactly what it does.",
    'extension.sign.signInTo': 'Sign in to',
    'extension.sign.warningNoun.signIn': 'sign-in',
    'extension.sign.oneTimeCode': 'One-time code',
    'extension.sign.controlCharacters':
        'Control characters are displayed safely. The original {noun} text is what you will sign.',
    'extension.sign.coSignRequest': 'Co-sign request',
    'extension.sign.decodingRequest': 'Decoding request…',
    'extension.sign.trustSource': 'Only approve it if you trust the source.',
    'extension.sign.agentAccount': 'Agent account',
    'extension.sign.coSignerAccount': 'Co-signer account',
    'extension.sign.policyRefusal': 'The co-signer will refuse it even if you approve.',
    'extension.sign.confirmThreshold':
        'Above the policy confirm-threshold: review carefully before approving.',


    // --- errors ---------------------------------------------------
    // --- flow status and error copy -------------------------------
    'flows.biometric.browserUnsupported': "This browser doesn't support the sign-in technology biometric unlock needs.",
    'flows.biometric.deviceUnavailable':
        'This device has no built-in fingerprint, face, or PIN unlock that this browser can use. Set one up in your system settings, then come back.',
    'flows.biometric.probeFailed': "This browser couldn't check whether a built-in unlock method is available.",
    'flows.biometric.genericUnavailable': "Biometric unlock isn't available on this device.",

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
        "Couldn't confirm this address accepts your dispenser; the network will decide. If it refuses, the network fee is lost.",

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
        "These two wallets were made from different recovery phrases ({chains} doesn't match). Restore both halves from the same phrase and pair again.",
    'flows.pairPartner.paired':
        'Paired. Both wallets come from the same recovery phrase and agree on {count, plural, one {# chain} other {# chains}}.',

    'flows.protocolFee.freeLabel': 'This action has no protocol fee',
    'flows.protocolFee.freeHint':
        'Only the network fee applies, so there is nothing to pay on top of it.',
    'flows.protocolFee.forfeit': "The fee is sent on-chain and isn't refunded if the network rejects this transaction.",
    'flows.protocolFee.conditionalForfeit':
        "If this action charges one, it's sent on-chain and isn't refunded if the network rejects this transaction.",
    'flows.protocolFee.amount': "This action's protocol fee is {amount} XCHAIN.",
    'flows.protocolFee.paidIn': 'Protocol fee is paid in {ticker}',
    'flows.protocolFee.paidInPlural': 'Protocol fees are paid in {ticker}',
    'flows.protocolFee.onlyWay':
        '{ticker} is the only way to pay a protocol fee on this chain.',
    'flows.protocolFee.unverifiedNotice':
        "The amount is exact, but the network doesn't check contract actions in advance, so it can't tell you beforehand whether this one will be accepted. If it's rejected, the fee is still spent.",
    'flows.protocolFee.toggleLabel': 'Pay protocol fee in {ticker} instead of XCHAIN',

    'flows.rbf.unsupportedBuild': "RBF replacement isn't supported by this build.",
    'flows.rbf.noEntry': 'No entry to replace.',
    'flows.rbf.noHash': 'No transaction hash on this entry.',
    'flows.rbf.alreadyConfirmed': 'Already confirmed.',
    'flows.rbf.actionUnsupported': "{action} actions aren't RBF-replaceable.",
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
