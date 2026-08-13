# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Label changes now queue an on-chain sync automatically and ask for the wallet password once per unlock, so renaming many addresses costs one publish instead of one each.
- `android-applinks-verify.sh` provisions a Google Play emulator image, installs the app and asserts the Android App Links verdict, refusing images that cannot answer.
- `upload-listing-assets.mjs` uploads the pinned iOS listing screenshots to App Store Connect, so publishing no longer needs a signed-in console session.
- A Windows CI job now performs the desktop install-and-update swap on native x64 hardware and files the result as its own evidence, alongside the human-observed rehearsal it can never replace.

### Fixed
- The desktop update offer now survives being made before the wallet is unlocked.
- `sign.sh` launches the packaged app before writing the manifest, so a build that cannot start cannot be signed.
- The launch probe fails shut when it cannot run, so signing over SSH can no longer pass a broken macOS release.
- A Linux `.deb` with no compiled native addon is refused before signing.
- `reproduce.sh` forwards the staging feed URL into the pinned container, so a staging rehearsal can be built the same way as a release.
- The desktop builder config no longer claims the project has no native dependencies, since a Linux install compiles `tiny-secp256k1`.
- `sign.sh --passphrase-file` lets a staging rehearsal sign without a pinentry, refuses that flag on production, and fails closed if it cannot read the file's permissions.
- The demo-endpoint gate now explains why a chain is absent instead of guessing a cause.
- The listing screenshot harness enrols simulator biometry so a "No fingerprint or face is set up" screen is never captured.
- The lint rule for trivial strings now describes its real whitespace, digits, and punctuation class instead of implying letters are allowed.
- Component props that ship user-visible copy are now covered by the user-facing-copy lint rule.
- The App Links code comment now correctly states the manifest lists Google's app-signing certificate, not both signing certificates.
- The literal-string lint rule now flags literals inside JSX expression containers, closing a gap its own docs claimed was already covered.
- The lint rule header now lists all ten user-facing attributes and the correct technical-attribute exemption.
- The English locale interpreter is documented correctly: it renders through formatjs with the full ICU grammar, not a lightweight subset.
- Multisig signing no longer leaks internal crypto jargon into user-facing copy.

## [0.337.0] - 2026-08-07

### Fixed
- Two wallet screens spoke raw protocol at the user where plain wording belonged.
- The multisig scheme picker described its own options in protocol jargon.
- Contract consent lines rendered as bare opcodes and pairing errors reached the dialog unformatted.
- Release verification accepted a good signature from any key in the keyring instead of only the release key.
- The pre-signing dev-mock check reported success without saying whether it had read anything.
- The release manifest dropped files that ship inside the archives it describes.
- The architecture gate trusted an artifact's filename instead of reading its payload.
- The artifact-set gate had no shape for a rehearsal set, so a rehearsal could not be signed.
- The iOS lane attached its build to the wrong store version and could not run its export at all.
- The Android CI gate built a bundle nobody ships.
- Native binaries failed to build after the pnpm 11 upgrade moved where settings are read from.

### Added
- Releases can be signed and published one distribution lane at a time.
- A Chrome Web Store upload lane, with checks on the listing collateral it uploads.
- The release-signing key is published on two channels and pinned in the repo.
- Store screenshots record which build they depict and are held to it.
- `tools/release/bump-version.mjs` writes the release version into every place that declares it.

### Changed
- SECURITY.md states what has actually been signed and how to check it.
- The demo-endpoint gate stopped certifying chains whose indexers cannot show a new balance.

## [0.336.0] - 2026-08-05

### Fixed
- Send's Max amount was priced against a transaction the wallet was not going to build.
- Every action form was briefly on screen fully loaded with no source address selected.
- Restoring a backup onto the device it now lives on failed, and three surfaces stated recovery facts they did not know.
- The extension re-implemented the imported-WIF address rule instead of asking core, so the two could disagree.
- Controls across the DEX filters and other surfaces sat under the 24px tap-target floor.
- iOS universal links opened the app but did not reach the wallet screen they named.
- The Android App Link claim covered a wider path range than the deep-link parser accepts.
- The ManageToken Dispensers tab never showed open dispensers.

### Added
- Mobile ships its own launcher icon and splash screen in place of the Capacitor defaults.
- The release path refuses to publish artifacts that were never signed.
- The standalone ISSUE form gained a Max mint per transaction field.
- The Android release ceremony verifies the built bundle's manifest before any key touches it.

### Changed
- Mainnet protocol activations move to 2026-08-07.
- `fast-uri` pinned past the host-confusion advisory.

## [0.334.0] - 2026-08-01

### Fixed
- The About panel and diagnostic dump now report the correct build version.
- Fixed fiat amounts occasionally rendering in scientific notation, and added CI checks for signer compatibility, address integrity, and plain-language action labels.

### Added
- The address form now offers a Purpose option (Receive or Dispenser) that batch-generates dispenser addresses with matching labels.
- Send, Mint, and Destroy now show a decoded confirmation page before signing instead of a raw preview.
- Creating a dispenser can now generate its address on the spot from the address screen.
- Added governance-poll notifications for tokens you hold, with a setting to flag binding polls.
- Added deep links that open a contract's Execute form prefilled with the method and parameters.
- Contract Execute forms can now read a contract's published method interface and show a method picker with named parameters, falling back to manual entry when none is published.
- The wallet now syncs its list of supported chains from a signed registry at boot, verifying the signature before applying updates.
- Added an account management screen for automated agent accounts, currently Bitcoin only.
- Added a command palette (Cmd/Ctrl+K) for quickly navigating and starting actions.
- Added global keyboard shortcuts for locking, sending, and opening settings, plus a shortcuts help screen.

### Added
- Internal: added end-to-end tests to the CI pipeline and a code-coverage check, with no user-facing change.

### Changed
- User-facing copy across staking, contract, poll, and dispenser screens no longer uses internal networking terminology.
- Accessibility scans now also cover the license, recovery-phrase, and donation-consent screens.

### Fixed
- Fixed a bug where a failed transaction on an already-unlocked wallet showed no error at all, making the Sign button look unresponsive.
- Fixed several onboarding screens that had silently broken the automated test suite.
- Fixed the Contract Execute form crashing on a malformed contract interface, and cleared stale fields when switching methods.
- Fixed the desktop app failing to load in both development and packaged builds due to a module-format mismatch.
- Fixed a hardware-wallet dependency pinned to an outdated version that could break on a clean install.

## [0.333.1] - 2026-07-16

### Fixed
- Send now converts decimal amounts to sats using exact integer math instead of floating-point multiplication.
- Contract-call copy was rewritten in plain language.
- The contracts list empty state was rewritten in plain language.
- A new derivation-parity test now pins every per-coin address parameter against the SDK's network table.


## [0.333.0] - 2026-06-20

### Security

- **Web shell no longer caches the wallet password in `sessionStorage`.**
- **SIWX challenge now binds the wallet-stamped page origin (v2 wire format, breaking).**
- Force transitive dependency `tar` to `>=7.5.7` (resolves to 7.5.15) via a `pnpm.overrides` pin to clear the high-severity hardlink path-traversal advisory (GHSA-34x7-hfp2-rc4v).
- Bump transitive dependency `tmp` from 0.2.5 to 0.2.7 to clear the path-traversal advisory (GHSA-ph9p-34f9-6g65).

### Added

- Added periodic refresh of the supported-chain registry.
- A single active-network setting (Mainnet, Testnet, or Regtest) now controls which chains are shown and queried across the whole wallet, replacing per-surface chain toggles.
- Settings gained a Network section for picking the active network.
- The wallet can show live native-coin prices, gated behind an opt-in Privacy setting that names the data source.
- The token detail page now shows the real chain logo instead of a placeholder letter, and lays out its metadata as a table.

### Changed

- Transaction terminology throughout the wallet was rewritten in plain language.

### Fixed

- Fixed the hardware-signer status indicator never settling down to its normal polling rate.
- Fixed incorrect type documentation for native-fee and encoder options, with no user-facing change.
- Fixed a P2SH/P2WSH spending bug on the online-signing path.
- Fixed P2SH/P2WSH reveal-script derivation on the online-signing path.
- Fixed a rare IndexedDB error that could occur when the wallet database was reopened while an old connection was still closing.

## [0.332.0] - 2026-05-21

### Added
- The locked screen now offers a "Forgot password?" option: with a type-to-confirm safety step, a user with no recovery phrase or backup can wipe local wallet data from this device and start over, even while locked out.

## [0.331.0] - 2026-05-01

### Added
- Added a compact "extension" layout for the browser popup alongside the existing small, full, and sidebar layouts.
- The Tokens tab now shows every non-native asset, and the NFTs tab now filters by having an image instead of by divisibility.
- Demo wallets gained sample tokens and NFTs across all three demo chains, with realistic balances and images.
- Demo activity and DeFi position lists now render sample content instead of placeholders.
- Added optional Pin and Hide row affordances, off by default in Display settings.

### Changed
- The network-reachability banner now only shows for real, unlocked wallets.
- The demo-mode banner moved into a per-wallet status row with an "Exit demo & wipe" action.
- The onboarding license screen was redesigned with clearer callouts for irreversibility and seed-phrase responsibility.
- The developer layout picker now uses a dropdown and remembers its position.
- Sidebar and tab-bar layout switching now follows the actual window size instead of the browser viewport.
- Removed the redundant network label from balance and activity rows, since the network is already set globally in Settings.
- Auto-lock is now skipped for the demo wallet, whose password can't be recovered; the locked screen instead offers a wipe-and-start-over escape for it.

### Fixed
- Fixed a crash in Send caused by a variable being read before it was initialized.
- Fixed a missing package export that broke some imports.

## [0.330.0] - 2026-04-30

### Added
- The airdrop recipients form now supports drag-and-drop CSV/TXT upload, matching every other file-upload form in the wallet.

## [0.329.0] - 2026-04-30

### Added
- NFT cards in the Collectibles view now fetch and show real images instead of a placeholder letter.
- The Language & Region setting now offers every supported language and applies a change immediately, including after a settings restore.

### Changed
- The scan screen was migrated to the wallet's translation system, the first route to do so.

## [0.328.0] - 2026-04-29

### Added
- Developer diagnostic logs now persist across restarts so they aren't lost between debugging sessions.
- Advanced users can register a custom, non-bundled chain from Developer Mode.
- History entries for DIVIDEND and AIRDROP actions can now show their full recipient list, with an option to save everyone as one contact.

## [0.327.0] - 2026-04-29

### Added
- On desktop, a pending transaction can now be opened in its own separate window that keeps its own navigation and auto-lock state.

## [0.326.0] - 2026-04-29

### Added
- Restoring an encrypted backup can now add it as a new wallet alongside existing ones, instead of only being able to overwrite.

## [0.325.0] - 2026-04-29

### Added
- Internal error-code and permission documentation is now generated automatically so it can't drift out of date.

## [0.324.0] - 2026-04-29

### Added
- Signed PSBT replies in the compressed BBQr-Z QR format can now be scanned directly, so hardware wallets that default to that format no longer need to be switched to another one.

## [0.323.0] - 2026-04-29

### Changed
- Both sides of a cross-chain LINK action now display together as one linked card in transaction history instead of as two separate entries.

## [0.322.0] - 2026-04-29

### Added
- The token detail page now shows an asset's description, creator, supply, market price, and lock status, pulling an image from the description when one is available.

## [0.321.0] - 2026-04-29

### Added
- Diagnostic dumps now include recent log entries to make troubleshooting easier.

### Changed
- The BIP39 passphrase option in wallet creation and import now explains that hardware wallets handle passphrases on the device itself.

## [0.320.0] - 2026-04-29

### Fixed
- History now correctly identifies the other party's address for incoming messages and order fills instead of showing your own address.
- Tooltips near the edge of the screen now reposition themselves so they don't get cut off.

### Added
- The wallet-import drop zone now also accepts a photo of a recovery-phrase QR code, not just plain text.

## [0.319.0] - 2026-04-29

### Added
- The transaction history timeline now shows a confirmation count once a transaction is confirmed.
- Draft saving and clearer error recovery were extended to the Issue Token and Dispenser forms.

### Changed
- Demo wallets now activate on test networks instead of mainnet.

## [0.318.0] - 2026-04-29

### Changed
- The in-progress form draft retention period is now configurable in Settings, Privacy (Off, 1 hour, 24 hours, or 7 days) instead of being fixed at 24 hours.

## [0.317.0] - 2026-04-29

### Added
- High-risk hardware-wallet signs, such as large amounts, new recipients, or multisig approvals, now require an explicit on-screen confirmation before submitting.

## [0.316.0] - 2026-04-29

### Fixed
- The wallet now cleanly rejects connection requests from apps asking for an unsupported protocol version instead of silently claiming to support it.

## [0.315.0] - 2026-04-29

### Fixed
- Fixed a bug where switching wallets while on a non-Home screen could overwrite the other wallet's saved screen position.

## [0.314.0] - 2026-04-29

### Fixed
- Removing a wallet now also clears its saved last-viewed screen.

## [0.313.0] - 2026-04-29

### Changed
- Added a documentation accuracy check to the pre-release checklist.

## [0.312.0] - 2026-04-29

### Added
- Added a governance section to the contributing guide explaining how decisions are made and when to open an issue first.

## [0.311.0] - 2026-04-29

### Added
- The About panel now links directly to the release-verification guide, not just the reproducible-builds guide.

## [0.310.0] - 2026-04-29

### Added
- Demo wallets now show realistic sample balances and transaction history instead of appearing empty.

## [0.309.0] - 2026-04-29

### Added
- The full open-source license text can now be viewed inline in Settings, About, instead of requiring a trip to the repository.

## [0.308.0] - 2026-04-29

### Added
- Demo wallets now automatically expire and clean up after 24 hours, with a countdown shown in the banner.

## [0.307.0] - 2026-04-29

### Changed
- The demo-mode banner now stays visible across every screen on web and desktop, not just Home.

## [0.306.0] - 2026-04-29

### Added
- Adding or removing an entry on the connected-sites blocklist is now recorded in an audit log.

## [0.305.0] - 2026-04-29

### Added
- The connected-sites blocklist now supports wildcard entries to block a whole domain at once.

## [0.304.0] - 2026-04-29

### Fixed
- The per-site signing rate limit now persists across restarts instead of resetting.

## [0.303.0] - 2026-04-29

### Added
- The per-site signing rate limit is now configurable in Settings.

## [0.302.0] - 2026-04-29

### Changed
- The backup-reminder card on Home now takes you directly to the Backup settings section instead of the Settings root.

## [0.301.0] - 2026-04-29

### Added
- Disconnecting a site now shows an Undo option to restore the connection.

## [0.300.0] - 2026-04-29

### Added
- PSBTs can now be signed by scanning a QR code, in addition to pasting or uploading a file.

## [0.299.0] - 2026-04-29

### Fixed
- Fixed the private-key view screen, which was supposed to show a QR code but never rendered one.

## [0.298.0] - 2026-04-29

### Added
- PSBT signing now supports hardware wallets, not just software keys.

## [0.297.0] - 2026-04-29

### Added
- Added a "Reset list preferences" option in Display settings to clear remembered list filters.

## [0.296.0] - 2026-04-29

### Added
- Added an in-wallet toggle to turn off haptic feedback, separate from the OS-level reduced-motion setting.

## [0.295.0] - 2026-04-29

### Changed
- The backup-verification quiz now asks about more recovery-phrase positions for longer, 24-word phrases.

## [0.294.0] - 2026-04-29

### Added
- A prompt now appears when the network reconnects if there are transactions queued from being offline, so the user can broadcast them.

## [0.293.0] - 2026-04-29

### Fixed
- The queued-broadcast list from offline sign attempts now survives an app restart instead of being lost.

## [0.292.0] - 2026-04-29

### Added
- A transaction that fails to broadcast after signing is now automatically queued for retry instead of being lost.

## [0.291.0] - 2026-04-29

### Added
- Home, History, and the token detail page now show a "data may be stale" label when balances or history haven't refreshed recently.

## [0.290.0] - 2026-04-28

### Changed
- Developer Mode's log viewer now captures real wallet activity, such as vault, signing, and network events, not just console output.

## [0.289.0] - 2026-04-28

### Added
- The wallet now offers a one-tap prompt to bulk-hide tokens it detects as likely spam.

## [0.288.0] - 2026-04-28

### Changed
- History export now uses a single dialog to choose format, columns, and date range instead of separate buttons.

## [0.287.0] - 2026-04-28

### Removed
- Removed an unused balance-list component that had already been replaced elsewhere in the app.

## [0.286.0] - 2026-04-28

### Added
- Added a Display settings panel for managing pinned and hidden tokens in one place.

## [0.285.0] - 2026-04-28

### Added
- Added a dedicated Scan screen that reads a QR code and routes automatically to Send, Receive, or PSBT signing based on what it detects.

## [0.284.0] - 2026-04-28

### Changed
- Diagnostic dumps now redact custom endpoint URLs, and the About panel can preview a dump before copying it.

## [0.283.0] - 2026-04-28

### Added
- `xchain:` links now deep-link directly into the browser extension popup, not just the web wallet.

## [0.282.0] - 2026-04-28

### Added
- Hardware-wallet firmware version data can now be refreshed at runtime instead of relying only on the bundled copy, with signature verification.

## [0.281.0] - 2026-04-28

### Changed
- The license re-acceptance prompt now also covers adding a new wallet to an already-unlocked vault, so a license update can't be skipped from that entry point.

## [0.280.0] - 2026-04-28

### Fixed
- Connected apps now actually receive account and network-change notifications from the wallet, instead of subscribing and never hearing back.

## [0.279.0] - 2026-04-28

### Changed
- The example dApp now demonstrates handling "blocked by user" and "rate limited" responses from the wallet.

## [0.278.0] - 2026-04-28

### Added
- `xchain:` links now describe themselves in plain, localized language (for example, "Send 0.5 BTC to bc1qxy...0wlh") instead of raw data.

## [0.277.0] - 2026-04-28

### Changed
- Diagnostic dumps now include which app shell, build, and paired devices were running, making support tickets easier to diagnose.

## [0.276.0] - 2026-04-28

### Changed
- Extended hardware-wallet firmware advisories to the remaining transaction-signing forms.

## [0.275.0] - 2026-04-28

### Changed
- Extended hardware-wallet firmware advisories to four more transaction-signing forms.

## [0.274.0] - 2026-04-28

### Changed
- Hardware-wallet firmware advisories and derivation-path warnings now appear on the Send form; more forms will follow.

## [0.273.0] - 2026-04-28

### Fixed
- Fixed inconsistent or invisible keyboard-focus outlines on several buttons and controls.

## [0.272.0] - 2026-04-28

### Changed
- The queued-broadcast banner now stays visible across every screen instead of only on Home.

## [0.271.0] - 2026-04-28

### Added
- `xchain:` links now deep-link into the web wallet and prefill the Send form.

## [0.270.0] - 2026-04-28

### Changed
- Notifications now cap at 3 visible at once, with a counter showing how many more are queued.

## [0.269.0] - 2026-04-28

### Added
- Auto-lock on inactivity now also works on the desktop app, not just web and the browser extension.

## [0.268.0] - 2026-04-28

### Added
- The sidebar's Settings button now opens Settings directly, and the sidebar shows the active wallet's name.

## [0.267.0] - 2026-04-28

### Changed
- Ledger hardware-wallet support was split into its own internal package, with no user-facing behavior change.

## [0.266.0] - 2026-04-28

### Changed
- Trezor hardware-wallet support was split into its own internal package, with no user-facing behavior change.

## [0.265.0] - 2026-04-28

### Added
- The desktop app now supports opening multiple windows at once, sharing the same unlocked wallet.

## [0.264.0] - 2026-04-28

### Added
- Added a bottom tab bar for narrow windows, with a "More" menu for less-used sections.

## [0.263.0] - 2026-04-28

### Added
- Added a left-hand sidebar navigation for wider windows on web and desktop.

## [0.262.0] - 2026-04-28

### Fixed
- Fixed the pay-to-order form so a watch-only wallet correctly builds an unsigned transaction paying the matched seller.

## [0.261.0] - 2026-04-28

### Changed
- The token admin form's destructive action now reads as a neutral "Build unsigned transaction" step for watch-only wallets.

## [0.260.0] - 2026-04-28

### Added
- Contract execution forms now support watch-only wallets by building an unsigned transaction instead of signing.

## [0.259.0] - 2026-04-28

### Added
- Contract deployment now supports watch-only wallets.

## [0.258.0] - 2026-04-28

### Added
- Contract fund deposit and withdrawal forms now support watch-only wallets.

## [0.257.0] - 2026-04-28

### Added
- Delegation and revocation forms now support watch-only wallets.

## [0.256.0] - 2026-04-28

### Added
- The unstake and claim-rewards forms now support watch-only wallets.

## [0.255.0] - 2026-04-28

### Added
- The cross-chain swap form now supports watch-only wallets.

## [0.254.0] - 2026-04-28

### Added
- The swap form now supports watch-only wallets.

## [0.253.0] - 2026-04-28

### Added
- The stake form now supports watch-only wallets.

## [0.252.0] - 2026-04-28

### Added
- The cross-chain link form now supports watch-only wallets.

## [0.251.0] - 2026-04-28

### Added
- The advanced actions form now supports watch-only wallets for any action type.

## [0.250.0] - 2026-04-28

### Changed
- Airdrops are now clearly blocked on watch-only wallets with an explanation, instead of breaking partway through, since an airdrop needs a broadcast step the watcher can't observe.

## [0.249.0] - 2026-04-28

### Added
- The dividend form now supports watch-only wallets.

## [0.248.0] - 2026-04-28

### Added
- The broadcast form now supports watch-only wallets.

## [0.247.0] - 2026-04-28

### Added
- The destroy-token form now supports watch-only wallets.

## [0.246.0] - 2026-04-28

### Added
- The dispenser form now supports watch-only wallets.

## [0.245.0] - 2026-04-28

### Added
- The mint form now supports watch-only wallets.

## [0.244.0] - 2026-04-28

### Added
- The issue-token form now supports watch-only wallets, the first action form to gain this.

## [0.243.0] - 2026-04-28

### Changed
- Internal refactor: the unsigned-transaction result view used by watch-only wallets was extracted into a shared, reusable component, with no user-facing change.

## [0.242.0] - 2026-04-28

### Changed
- Laid the internal groundwork for watch-only wallet support across every action form, with no user-facing change yet.

## [0.241.0] - 2026-04-28

### Added
- Unsigned transactions built by a watch-only wallet can now also be exported as BBQr QR codes for compatible hardware signers, in addition to the wallet's native format.

## [0.240.0] - 2026-04-28

### Added
- Added internal test tooling to simulate hardware wallets without a physical device, with no user-facing change.

## [0.239.0] - 2026-04-28

### Changed
- Watch-only mode now clarifies that a hardware wallet chosen as a source address must be paired on the separate signing wallet, not this one.

## [0.238.0] - 2026-04-28

### Added
- The desktop app now supports signing and verifying PSBTs and messages, closing a gap where only web and the browser extension could.

## [0.237.0] - 2026-04-28

### Added
- Signed transactions can now be broadcast directly from within the wallet instead of requiring an external tool.

## [0.236.0] - 2026-04-28

### Added
- Added a simplified home screen for signing-only wallets, with just Sign a PSBT, Sign a message, and Verify a signature.

## [0.235.0] - 2026-04-28

### Added
- Watch-only wallets can now build an unsigned Send transaction, ready to be signed elsewhere and broadcast later.

## [0.234.0] - 2026-04-28

### Added
- Added a Wallet Mode setting (Full, Watch-only, or Signing-only) that will progressively unlock different behavior in upcoming releases.

## [0.233.0] - 2026-04-28

### Changed
- Reorganized internal test configuration files into a single directory, with no user-facing change.

## [0.232.0] - 2026-04-28

### Changed
- Recorded a decision to keep the current state-management approach rather than adopt a different internal architecture, with no user-facing change.

## [0.231.0] - 2026-04-28

### Changed
- Added internal tooling for testing against a local test network, with no user-facing change.

## [0.230.0] - 2026-04-28

### Changed
- Added internal release-signing tooling, with no user-facing change.

## [0.229.0] - 2026-04-28

### Added
- Added the groundwork for automatically refreshing the supported-chain list, plus a manual "Refresh now" option in Network settings.

## [0.228.0] - 2026-04-28

### Changed
- Internal verification pass on the cross-chain link display in transaction history, with no user-facing change.

## [0.227.0] - 2026-04-28

### Added
- PSBTs can now be signed via BBQr QR codes from popular hardware-wallet apps, in addition to the wallet's own format.

## [0.226.0] - 2026-04-28

### Changed
- Internal verification pass on the browser extension's side-panel mode, with no user-facing change.

## [0.225.0] - 2026-04-28

### Added
- Unlocking a wallet now resumes on the screen you last viewed instead of always returning to Home.

## [0.224.0] - 2026-04-28

### Changed
- Added a wallet glossary to the documentation, with no user-facing change.

## [0.223.0] - 2026-04-28

### Changed
- Added a maintainers and governance document to the repository, with no user-facing change.

## [0.222.0] - 2026-04-28

### Changed
- Added a step-by-step guide for verifying a downloaded release is authentic, with no user-facing change.

## [0.221.0] - 2026-04-28

### Changed
- Added a reproducible-builds overview document, with no user-facing change.

## [0.220.0] - 2026-04-28

### Added
- Added the ability to block a connected site's origin so it can never reconnect or request a signature.

## [0.219.0] - 2026-04-28

### Added
- Added a per-site rate limit on signing requests to prevent a misbehaving app from spamming sign prompts.

## [0.218.0] - 2026-04-28

### Changed
- Reworked internal styling to support right-to-left languages in a future release, with no visible change yet.

## [0.217.0] - 2026-04-28

### Changed
- Added an internal lint rule to help developers find hardcoded text that should be translatable, with no user-facing change.

## [0.216.0] - 2026-04-28

### Changed
- Reorganized the translation system to support pluralization and more languages, with no user-facing change yet.

## [0.215.0] - 2026-04-27

### Added
- Added a developer-mode log console for viewing recent app activity inside the wallet.

## [0.214.0] - 2026-04-27

### Added
- Test networks can now be activated for an existing wallet from Developer Mode, deriving addresses for it automatically.

## [0.213.0] - 2026-04-27

### Added
- Added a Developer Mode option to auto-approve localhost app connections; signing still always requires approval.

## [0.212.0] - 2026-04-27

### Added
- In-progress form entries, like an unfinished Send, are now saved as a draft you can resume for up to 24 hours.

## [0.211.0] - 2026-04-27

### Added
- Several error messages now offer a one-click fix, such as "Use Max" for an amount error or "Clear" for an unrecognized paste.

## [0.210.0] - 2026-04-27

### Added
- Added contextual help icons next to some of the wallet's more confusing controls, such as the fee tier picker and derivation path.

## [0.209.0] - 2026-04-27

### Added
- Several forms, including PSBT signing, contact import, and backup restore, now support drag-and-drop file uploads, not just click-to-browse.

## [0.208.0] - 2026-04-27

### Added
- Added subtle haptic feedback for key actions like a successful send, unlock, or an error, honoring the reduced-motion setting.

## [0.207.0] - 2026-04-27

### Added
- History and balance lists now remember which chains you last filtered to.

## [0.206.0] - 2026-04-27

### Added
- History entries now offer a "Save as contact" prompt for addresses you've transacted with but haven't saved yet.

## [0.205.0] - 2026-04-27

### Fixed
- Auto-lock now actually uses the timeout configured in Settings instead of always locking after a fixed 5 minutes.

## [0.204.0] - 2026-04-27

### Fixed
- Auto-lock on inactivity now also applies to the web wallet, not just the browser extension.

## [0.203.0] - 2026-04-27

### Changed
- Clarified the internal hardware-wallet firmware advisory data format, with no user-facing change.

## [0.202.0] - 2026-04-27

### Changed
- The hardware-wallet address verification screen now clearly explains to check both the derivation path and the address on your device, with device-specific guidance.

## [0.201.0] - 2026-04-27

### Added
- Added a warning banner during hardware-wallet signing when the device's firmware is outdated or has a known issue.

## [0.200.0] - 2026-04-27

### Changed
- The wallet now clearly explains when a browser doesn't support pairing a Ledger device, instead of letting the attempt silently fail.

## [0.199.0] - 2026-04-27

### Changed
- Added an internal pre-release testing checklist, with no user-facing change.

## [0.198.0] - 2026-04-27

### Changed
- Added developer documentation for the wallet's dApp-connection API, with no user-facing change.

## [0.197.0] - 2026-04-27

### Changed
- Added an internal architecture overview document, with no user-facing change.

## [0.196.0] - 2026-04-27

### Changed
- Added a Code of Conduct to the repository.

## [0.195.0] - 2026-04-27

### Changed
- Added a contributing guide to the repository.

## [0.194.0] - 2026-04-27

### Added
- Published a security vulnerability disclosure policy.

## [0.193.0] - 2026-04-27

### Added
- Added a "Copy diagnostics" button in the About panel to help with troubleshooting.

## [0.192.0] - 2026-04-27

### Changed
- Desktop deep links now parse into structured data instead of being passed through unparsed, with no user-facing change.

## [0.191.0] - 2026-04-27

### Added
- The web wallet can now register itself as a handler for `xchain:` links in supporting browsers.

## [0.190.0] - 2026-04-27

### Changed
- Added internal support for parsing `xchain:` links with an explicit chain and asset, with no user-facing change yet.

## [0.189.0] - 2026-04-27

### Added
- Added a high-contrast color theme that follows the operating system's accessibility setting.

## [0.188.0] - 2026-04-27

### Changed
- Added a shared internal component for accessible status and error messages, with no user-facing change.

## [0.187.0] - 2026-04-27

### Added
- Added a "skip to main content" link and clearer page structure for screen-reader and keyboard users.

## [0.186.0] - 2026-04-27

### Added
- Onboarding now opens with a license agreement screen that must be scrolled through and accepted before continuing.

## [0.185.0] - 2026-04-27

### Added
- Added subtle entrance animations to the welcome screen, honoring the reduced-motion setting.

## [0.184.0] - 2026-04-27

### Added
- Added a banner on Home for demo wallets, with a one-tap "Exit demo & wipe" option.

## [0.183.0] - 2026-04-27

### Added
- Onboarding now offers a "Try in demo mode" button that creates a temporary demo wallet instantly.

Closes G058.

## [0.182.0] - 2026-04-27

### Added
- Added the ability to export transaction history as CSV or JSON, respecting the currently applied filters.

## [0.181.0] - 2026-04-27

### Added
- Added a status timeline to the transaction detail view, showing Broadcast, Mempool, and Confirmed stages.

## [0.180.0] - 2026-04-27

### Changed
- The NFTs tab now shows a dedicated grid view instead of a plain row list.

## [0.179.0] - 2026-04-27

### Added
- Balance rows can now be hidden, with a "Show N hidden" option to bring them back.

## [0.178.0] - 2026-04-27

### Added
- Balance rows can now be pinned to the top of the list.

## [0.177.0] - 2026-04-27

### Added
- Added a backup reminder card on Home that appears if a wallet's recovery phrase hasn't been verified.

## [0.176.0] - 2026-04-27

### Added
- Creating a wallet now quizzes you on a few words from your recovery phrase before finishing, to confirm you saved it correctly.

## [0.175.0] - 2026-04-27

### Added
- Restoring a wallet now supports importing an encrypted backup file, not just a recovery phrase.

## [0.174.0] - 2026-04-27

### Added
- Added the ability to import a single private key, with a clear warning that it isn't covered by the recovery phrase backup.

## [0.173.0] - 2026-04-27

### Added
- Restoring a wallet now supports scanning a QR code or dragging in a text file for the recovery phrase.

## [0.172.0] - 2026-04-27

### Added
- Added optional BIP39 passphrase (a 25th word) support when creating or restoring a wallet.

## [0.171.0] - 2026-04-27

### Added
- Creating a wallet now lets you choose a 12-word or 24-word recovery phrase.

## [0.170.0] - 2026-04-27

### Added
- Added a "last synced" indicator and a banner listing transactions queued for broadcast.

## [0.169.0] - 2026-04-27

### Added
- Added an offline/degraded connection banner that shows when the wallet can't reach the network.

## [0.168.0] - 2026-04-27

### Changed
- Internal verification pass on the dApp connection feature, with no user-facing change.

## [0.167.0] - 2026-04-27

### Changed
- The private-key view's clipboard auto-clear delay is now configurable (0 to 600 seconds) in Settings, instead of fixed at 60 seconds.

## [0.166.0] - 2026-04-27

### Fixed
- The "view private key" screen is now actually reachable from the address list.

## [0.165.0] - 2026-04-27

### Changed
- Added internal test coverage for hardware-wallet and watch-only address protections on the private-key view, with no behavior change.

## [0.164.0] - 2026-04-27

### Added
- Added a "Sign PSBT" screen that accepts a pasted or typed unsigned transaction and signs it.

## [0.163.0] - 2026-04-27

### Changed
- Cancelling a hardware-wallet signature now shows a calm "Transaction cancelled" message instead of an error.

## [0.162.0] - 2026-04-27

### Changed
- The Send confirmation screen now shows a fuller success summary with an explorer link and a "Send another" shortcut.

## [0.161.0] - 2026-04-27

### Added
- Added temporary notification toasts, with "undo" support for deleting a contact or clearing history filters.

## [0.160.0] - 2026-04-27

### Added
- Tapping a balance now opens a dedicated token detail page with its own Send/Receive actions and holder list.

## [0.159.0] - 2026-04-27

### Added
- Added advanced search and filtering to transaction history, including by type, status, and date range.

## [0.158.0] - 2026-04-27

### Added
- Related transaction history entries, such as a token issuance and its mints, now group into a single expandable card.

## [0.157.0] - 2026-04-27

### Added
- Empty balance and history lists now show a helpful prompt with a one-tap Receive button.

## [0.156.0] - 2026-04-27

### Changed
- Loading balances, history, and addresses now show placeholder skeleton rows instead of plain "Loading..." text.

## [0.155.0] - 2026-04-27

### Changed
- Added an internal loading-placeholder component, with no user-facing change yet.

## [0.154.0] - 2026-04-27

### Added
- Added the ability to publish encrypted wallet labels and contacts on-chain from Settings, Backup.

## [0.153.0] - 2026-04-27

### Added
- When a wallet has multiple signers, adding a new address or account now lets you choose which signer to use.

## [0.152.0] - 2026-04-27

### Added
- Added a dry-run restore tool in Settings, Backup to test whether a recovery phrase matches before relying on it.

## [0.151.0] - 2026-04-27

### Added
- Added a seed-phrase reveal flow in Settings, Backup, protected by your password and a tap-to-reveal blur.

## [0.150.0] - 2026-04-27

### Added
- Added a Verify Signature screen to confirm a signature was produced by a given address.

## [0.149.0] - 2026-04-27

### Added
- Added a Sign Message screen for signing arbitrary text with a wallet address.

## [0.148.0] - 2026-04-27

### Added
- Added a duress passphrase: entering it on the unlock screen looks like a normal wrong password but silently arms a 24-hour signing freeze.

## [0.147.0] - 2026-04-27

### Added
- Added a panic mode that freezes all signing for 24 hours by default when activated from Settings, Safety.

## [0.146.0] - 2026-04-27

### Added
- Added biometric unlock, such as Touch ID or Windows Hello, as an alternative to typing your password.

## [0.145.0] - 2026-04-27

### Added
- The wallet now blurs its contents automatically when the window loses focus, if enabled in Privacy settings.

## [0.144.0] - 2026-04-27

### Added
- Repeated failed unlock attempts now trigger an escalating timed lockout instead of unlimited retries.

## [0.143.0] - 2026-04-27

### Added
- Password fields now warn when Caps Lock is on.

## [0.142.0] - 2026-04-27

### Fixed
- The Send form's fee tier now defaults to whatever you last chose in Settings, Fees for that chain.

## [0.141.0] - 2026-04-27

### Changed
- Fee estimates now use live network data when available, falling back to placeholder rates otherwise.

## [0.140.0] - 2026-04-26

### Fixed
- Fixed the custom fee input for DOGE to accept the displayed unit instead of requiring the internal unit.

## [0.139.0] - 2026-04-26

### Added
- Added a Replace-by-fee toggle to the Send form.

## [0.138.0] - 2026-04-26

### Added
- Added a fee tier picker, Low, Normal, or Fast, plus Custom, to the Send form.

## [0.137.0] - 2026-04-26

### Added
- Pending transactions in History now offer Speed Up and Cancel buttons; using them today shows a clear not-yet-supported message while full replacement support is being built.

## [0.136.0] - 2026-04-26

### Added
- Added a "Request payment" option on Receive for specifying an amount, asset, memo, and expiry, plus Share buttons for the address and payment request.

### Fixed
- Fixed a crash when opening a Settings section.

## [0.135.0] - 2026-04-26

### Added
- The Send form gained a Max button, a fiat/native currency toggle, and a real placeholder fee estimate shown in the preview.

## [0.134.0] - 2026-04-26

### Added
- Sending an unusually large amount to a new recipient now prompts a "send a small test first" safety check.

## [0.133.0] - 2026-04-26

### Added
- The Send form's address field now highlights the first and last characters for easy comparison, warns if a pasted address may have changed, and flags addresses that look suspiciously similar to a known one.

## [0.132.0] - 2026-04-26

### Added
- The Send form's recipient field now autocompletes from your contacts and send history, and warns if a pasted value looks like a private key instead of an address.

## [0.131.0] - 2026-04-26

### Added
- Added a raw transaction data viewer on sign screens, available only in Developer Mode.

## [0.130.0] - 2026-04-26

### Changed
- Sign screens now show which chain a transaction will be signed on and which app requested it, and collapse technical details by default.

## [0.129.0] - 2026-04-26

### Added
- The balance-change preview now also appears on dApp-triggered sign requests, not just wallet-initiated sends.

## [0.128.0] - 2026-04-26

### Added
- The Send confirmation screen now shows a preview of how your balances will change before you sign.

## [0.127.0] - 2026-04-26

### Changed
- Added an internal component for previewing balance changes, not yet wired into any screen.

## [0.126.0] - 2026-04-26

### Changed
- Added the internal groundwork for a transaction preview simulator, with no user-facing change yet.

## [0.125.0] - 2026-04-26

### Changed
- Redesigned Settings as a scannable list; most sections now show a short summary and open into their own page instead of showing everything at once.

## [0.124.0] - 2026-04-26

### Changed
- Internal: centralized the rule that hides test networks unless Developer Mode is on, with no user-facing change.

## [0.123.0] - 2026-04-26

### Added
- Unlocked several previously "Coming soon" settings: reduced motion, on-blur privacy blur, large-send confirmation threshold, panic mode, and backup reminders.

## [0.122.0] - 2026-04-26

### Removed
- Removed the read-only keyboard shortcuts preview panel from Settings.

## [0.121.0] - 2026-04-26

### Added
- Creating a wallet now ends with a one-time screen to enable or decline the automatic donation feature.

## [0.120.0] - 2026-04-26

### Added
- Added a read-only preview of planned keyboard shortcuts to Settings.

## [0.119.0] - 2026-04-26

### Added
- The This Wallet settings panel now supports fully removing a wallet, with a typed-name confirmation.

## [0.118.0] - 2026-04-26

### Added
- Added a Contacts export/import panel in Settings for bulk backing up or restoring your address book.

## [0.117.0] - 2026-04-26

### Added
- Added a Connected Sites panel in Settings to view and disconnect apps the wallet has approved.

## [0.116.0] - 2026-04-26

### Added
- Added a Backup panel in Settings for exporting an encrypted wallet backup file.

## [0.115.0] - 2026-04-26

### Added
- Added the Automatic Donation System panel in Settings, with per-chain amount, threshold, and lifetime stats.

## [0.114.0] - 2026-04-26

### Added
- Added a Developer Mode panel in Settings; enabling it also reveals test networks in Network & Endpoints.

## [0.113.0] - 2026-04-26

### Added
- Added a Network & Endpoints panel in Settings for customizing each chain's explorer, encoder, and hub URLs.

## [0.112.0] - 2026-04-26

### Added
- Added a Fees panel in Settings for setting a per-chain fee strategy and replace-by-fee default.

## [0.111.0] - 2026-04-26

### Added
- Added a Notifications panel in Settings for transaction, receipt, dispenser, order, and price alerts.

## [0.110.0] - 2026-04-26

### Added
- Added a Safety panel in Settings for the auto-lock timeout and send-grace period.

## [0.109.0] - 2026-04-26

### Added
- Added a Privacy panel in Settings for Tor routing, change-address rotation, and hiding small balances.

## [0.108.0] - 2026-04-26

### Added
- Added a Language & Region panel in Settings for language and fiat currency.

## [0.107.0] - 2026-04-26

### Added
- Added an Appearance panel in Settings with a theme picker.

## [0.106.0] - 2026-04-26

### Added
- Added an About panel in Settings showing wallet version, license, and related documentation links.

## [0.105.0] - 2026-04-26

### Changed
- Laid the groundwork for a full Settings page with a section for every setting; most sections are still placeholders.

## [0.104.0] - 2026-04-26

### Added
- Added support for multiple wallets and multiple accounts per wallet.

### Changed
- Reorganized the main menu and simplified navigation to a single back button per screen.

## [0.103.0] - 2026-04-25

### Fixed
- Major stability pass: fixed the wallet to run reliably on a plain local-network connection by rewriting the crypto layer to not depend on browser Web Crypto.

### Added
- Added a large automated test suite covering the crypto and core wallet logic.

### Changed
- Refreshed the visual design system with a proper icon set and adaptive compact and full layouts.

## [1.0.0-rc.6] - 2026-04-24

### Changed
- Pre-launch: prepared the accessibility audit request packet for an external vendor, targeting WCAG 2.2 AA; no code changes.

## [1.0.0-rc.5] - 2026-04-24

### Changed
- Pre-launch: prepared the security audit request packet for an external vendor; no code changes.

## [1.0.0-rc.4] - 2026-04-24

### Added
- Multi-frame QR codes now offer manual Previous and Next controls and pause auto-advancing when the reduced-motion accessibility setting is on.

## [1.0.0-rc.3] - 2026-04-24

### Changed
- Pre-launch: published a privacy policy for the browser extension and prepared the Chrome Web Store submission checklist; no code changes.

## [1.0.0-rc.2] - 2026-04-24

### Changed
- Pre-launch: hardened the browser extension's manifest and added an automated audit to catch manifest problems before submission.

## [1.0.0-rc.1] - 2026-04-24

### Changed
- Pre-launch build closed: camera scanning, a dedicated address list, hardware-friendly multisig signing, an accessibility audit gate, and a reproducible-build gate all shipped ahead of the release candidate. Remaining before general availability: an external security audit, an external accessibility audit, and Chrome Web Store submission.

## [0.101.0] - 2026-04-24

### Changed
- Added internal reproducible-build checks, with no user-facing change.

## [0.100.0] - 2026-04-24

### Fixed
- Added an internal accessibility audit tool and fixed several missing labels for screen readers.

## [0.99.0] - 2026-04-24

### Added
- A wallet can now hold multiple separate multisig configurations instead of just one.

## [0.98.0] - 2026-04-24

### Added
- Multisig signing now supports a hardware-friendly transaction format for software wallets; hardware wallet support for this format is not yet available.

## [0.97.0] - 2026-04-24

### Added
- Added a dedicated Addresses screen listing every address the wallet has generated, with multisig badges and a filter.

## [0.96.0] - 2026-04-24

### Added
- Multisig signing can now scan a QR code with the camera, not just paste text.

## [0.95.0] - 2026-04-24

### Changed
- Marks the completion of a major feature milestone: smart contracts, BTC staking, cross-chain actions, and multisig wallets (all three signature schemes) are now built.

## [0.94.0] - 2026-04-24

### Added
- Multisig wallets now show a threshold and scheme badge across Receive, History, Home, and the signing screen.

## [0.93.0] - 2026-04-24

### Added
- Local signing for multisig now supports both MuSig2 and classical schemes; hardware wallet support for MuSig2 shows a clear not-yet-supported message.

## [0.92.0] - 2026-04-24

### Added
- Multisig cosigners can now exchange signing data via QR code, in addition to pasting it.

## [0.91.0] - 2026-04-24

### Added
- Added the underlying tracking system for coordinating multisig signatures across cosigners and wallet restarts.

## [0.90.0] - 2026-04-24

### Added
- Multisig wallets can now show a dedicated receive address and QR code on the Receive screen.

## [0.89.0] - 2026-04-24

### Added
- Added a multisig wallet creation flow supporting all three signature schemes.

## [0.88.0] - 2026-04-24

### Added
- Added ready-made cross-chain action templates that pre-fill the multi-action composer.

## [0.87.0] - 2026-04-24

### Added
- Added a dedicated form for cross-chain swaps.

## [0.86.0] - 2026-04-24

### Added
- Added a composer for building and signing several cross-chain actions in one sequence.

## [0.85.0] - 2026-04-24

### Added
- Added a form for linking two actions together across chains.

## [0.84.0] - 2026-04-24

### Added
- History now threads together both sides of a cross-chain link into one connected view.

## [0.83.0] - 2026-04-24

### Added
- Added an operator and validator dashboard for staking, including a quick-publish tool for broadcast feeds.

## [0.82.0] - 2026-04-24

### Added
- Added forms for delegating and revoking a staking signing key.

## [0.81.0] - 2026-04-24

### Added
- Added forms for unstaking and claiming staking rewards.

## [0.80.0] - 2026-04-24

### Added
- Added a form for staking, Tier 1 and Tier 2; Tier 3 is not yet available.

## [0.79.0] - 2026-04-24

### Added
- Added a staking dashboard showing your stake, delegation, and pending rewards.

## [0.78.0] - 2026-04-24

### Added
- Added forms for depositing to and withdrawing from a smart contract.

## [0.77.0] - 2026-04-24

### Added
- Added a form for calling a smart contract method.

## [0.76.0] - 2026-04-24

### Added
- Added a form for deploying a smart contract.

## [0.75.0] - 2026-04-24

### Added
- Added a contract detail page showing its state, balances, and execution history.

## [0.74.0] - 2026-04-24

### Added
- Added a Contracts section for browsing deployed smart contracts, available when the wallet holds a BTC address.

## [0.73.0] - 2026-04-24

### Added
- Added encrypted messaging: an inbox, a compose screen, and contact integration.

## [0.72.0] - 2026-04-24

### Added
- Added per-market trade history, a way to pay pending COINPAY obligations, a token swap form, and dispenser-availability badges on the markets list.

## [0.71.0] - 2026-04-24

### Added
- Added a full markets and trading experience: browse markets, a watchlist, a live chart, an order book, recent trades, and placing or cancelling limit orders.

## [0.70.0] - 2026-04-24

### Added
- Extended hardware-wallet signing to the dispenser and airdrop forms, and added hardware-wallet support to the desktop app.

## [0.69.0] - 2026-04-24

### Added
- Extended hardware-wallet signing to seven more forms: issue, mint, destroy, token admin, broadcast, dividend, and the advanced action form.

## [0.68.0] - 2026-04-24

### Changed
- Laid the groundwork for hardware-wallet signing on the Send form; full end-to-end signing still needs a connection step that lands next.

## [0.67.0] - 2026-04-24

### Changed
- Added the internal plumbing that lets hardware wallets sign transactions through the background process, plus shared status and confirmation UI for future sign screens.

## [0.66.0] - 2026-04-23

### Changed
- Added the internal conversion logic needed for Trezor and Ledger to sign real transactions and messages; not yet connected to any screen.

## [0.65.0] - 2026-04-23

### Added
- Added a generic "Advanced action" form for submitting any wallet action directly, and a guided migration path for FreeWallet users moving to a standard wallet.

## [0.64.0] - 2026-04-23

### Added
- Added an Airdrop flow: build a recipient list, then distribute a token to everyone on it, resumable if you close the wallet partway through.

## [0.63.0] - 2026-04-23

### Added
- Added a form for paying dividends to token holders, with a live preview of eligible holder count and total payout.

## [0.62.0] - 2026-04-23

### Added
- Added a dispenser browsing screen and the ability to buy from a token-paid dispenser.

## [0.61.0] - 2026-04-23

### Added
- Added a "My dispensers" list and detail page, including the ability to cancel a dispenser you created.

## [0.60.0] - 2026-04-23

### Added
- Added a form for creating a dispenser that sells your token for native coin or a fiat-priced amount.

## [0.59.0] - 2026-04-23

### Added
- Added a form for broadcasting a message or an oracle price feed update.

## [0.58.0] - 2026-04-23

### Added
- Added packaging so the desktop app can produce real installers on Windows, macOS, and Linux, plus support for deep links, reproducible builds, and auto-update checks.

## [0.57.0] - 2026-04-23

### Added
- Hardware-wallet pairing now works on the desktop app too, using the same browser-based connection methods as the extension and web wallet.

## [0.56.0] - 2026-04-23

### Added
- The desktop app now remembers your unlock across restarts using the operating system's secure keychain, instead of asking for your password every launch.

## [0.55.0] - 2026-04-23

### Changed
- Laid the groundwork for the desktop app: it now runs the same wallet interface as the browser extension and web wallet, with keys kept out of the visible window process.

## [0.54.0] - 2026-04-23

### Changed
- Housekeeping: removed the placeholder CI workflow and synchronized version numbers across every part of the wallet, with no user-facing change.

## [0.53.0] - 2026-04-23

### Added
- Added support for pairing Trezor and Ledger hardware wallets, plus a private-key view and export screen; actually signing a transaction with a hardware wallet is not yet available.

## [0.52.0] - 2026-04-23

### Changed
- Added internal infrastructure for hardware-wallet pairing, firmware checks, device records, and address cross-check UI, not yet connected to any physical device.

## [0.51.0] - 2026-04-23

### Added
- Added a new Actions menu with standalone forms for issuing, minting, and destroying tokens, plus locking supply, updating a description, and transferring ownership.

## [0.50.0] - 2026-04-23

### Added
- Added the Create a Token wizard to Home, with all six token templates now interactive and able to sign and broadcast.

## [0.49.0] - 2026-04-23

### Added
- Added the initial Create a Token wizard scaffold (template, chain, details, preview, sign steps); not yet reachable from the app, and signing is stubbed.

## [0.48.0] - 2026-04-23

### Added
- The sign-confirmation screen can now show a plain-English preview for token issuance, minting, destroying, and batched actions.

## [0.47.0] - 2026-04-23

### Changed
- Internal: made the wallet's SDK actually work in the browser build for both the extension and web app, with no user-facing change.

## [0.46.0] - 2026-04-23

### Added
- Unified the extension popup and web app to share the same screens; the popup gained Send and the web app gained Receive.

## [0.45.0] - 2026-04-22

### Added
- Wired up the real blockchain SDK, added onboarding to the browser extension, and added an accessibility testing gate.

## [0.44.0] - 2026-04-22

### Changed
- The sign-confirmation screen now shows a plain-English summary and warnings for Send and Sweep, instead of raw data.

## [0.43.0] - 2026-04-22

### Added
- Added the ability to create or import a wallet from the web app, and to send from it.

## [0.42.0] - 2026-04-22

### Added
- The web app is now a real interface with the same navigation as the browser extension, and detects when the browser extension is also installed.

## [0.41.0] - 2026-04-22

### Changed
- Internal test coverage added for the dApp connection bridge, plus a manual testing guide for reviewers, with no user-facing change.

## [0.40.0] - 2026-04-22

### Added
- Added the approval popup window that appears when a connected app requests a connection or a signature.

## [0.39.0] - 2026-04-22

### Added
- Added a Receive screen with a QR code to the browser extension.

## [0.38.0] - 2026-04-22

### Added
- Added a functional unlock screen and a Home screen with balances, plus lock and auto-lock after inactivity.

## [0.37.0] - 2026-04-22

### Added
- Added the browser extension's popup shell with basic navigation between screens.

## [0.36.0] - 2026-04-22

### Changed
- Moved the desktop app's development to a later phase, after hardware-wallet support, so it launches with its full feature set; no change to the extension or web wallet.

## [0.35.0] - 2026-04-22

### Added
- Added the wallet's visual design system: buttons, inputs, badges, and other shared UI building blocks.

## [0.34.0] - 2026-04-22

### Added
- Added the wallet's branding: product name, logo, colors, and chain icons.

## [0.33.0] - 2026-04-22

### Changed
- Internal: set up the build pipeline for the browser extension and web app, with no UI yet.

## [0.32.0] - 2026-04-22

### Added
- Added a placeholder response for cross-chain parallel actions requested by a connected app, since that feature isn't built yet.

## [0.31.0] - 2026-04-22

### Changed
- Internal: documented and started auditing third-party dependencies for security issues.

## [0.30.0] - 2026-04-22

### Added
- Added the core dApp-connection bridge: connecting a website to the wallet, viewing accounts and balances, and signing messages, transactions, and sign-in requests.

## [0.29.0] - 2026-04-22

### Added
- Added the ability to scan a recovery phrase for previously used addresses when restoring a wallet.

## [0.28.0] - 2026-04-22

### Added
- Added a diagnostic report generator for troubleshooting, with sensitive data such as keys, addresses, and balances excluded.

## [0.27.0] - 2026-04-22

### Added
- Added offline and degraded-connection detection, plus the ability to queue a signed transaction for broadcast later if the network isn't reachable.

## [0.26.0] - 2026-04-22

### Added
- Added the ability to sign transactions from an imported private key, not just from the wallet's recovery phrase.

## [0.25.0] - 2026-04-22

### Added
- Automatic donations are now actually included in transactions when enabled, using placeholder addresses until real ones are configured before mainnet launch.

## [0.24.0] - 2026-04-22

### Added
- Added support for a wallet backed only by a single imported private key, with no recovery phrase; sending from it isn't available yet.

## [0.23.0] - 2026-04-22

### Changed
- Added a chunked QR-code transport for large signing data, laying groundwork for air-gapped signing; not yet connected to any screen.

## [0.22.0] - 2026-04-22

### Added
- Added the ability to sync encrypted address labels and contacts on-chain so they survive a wallet restore.

## [0.21.0] - 2026-04-22

### Added
- Added a dry-run restore check to verify a recovery phrase matches the current wallet before committing to it.

## [0.20.0] - 2026-04-22

### Added
- Added encrypted wallet backup file export and import.

## [0.19.0] - 2026-04-22

### Added
- Added the ability to view and export a private key.

## [0.18.0] - 2026-04-22

### Changed
- Added the internal accounting logic for the Automatic Donation System; not yet wired into actual transactions.

## [0.17.0] - 2026-04-22

### Changed
- Added internal URI and QR-code content parsing and detection, for links, private keys, recovery phrases, and addresses; with no user-facing change yet.

## [0.16.0] - 2026-04-22

### Changed
- Submitted transactions now track their lifecycle status internally, laying groundwork for a future history and status display.

## [0.15.0] - 2026-04-22

### Added
- Added a temporary, in-memory demo wallet for trying the app without creating a real one.

## [0.14.0] - 2026-04-22

### Added
- Added standalone flows for signing a message and signing a PSBT.

## [0.13.0] - 2026-04-22

### Added
- Added the ability to import a single private key into an existing wallet.

## [0.12.0] - 2026-04-22

### Changed
- Added the browser extension's background service and its internal message-handling API, plus the web app's local storage layer.

## [0.11.0] - 2026-04-22

### Changed
- Added the browser extension's storage layer and a step that reconciles addresses with their signing keys after a schema update.

## [0.10.0] - 2026-04-22

### Added
- Added the ability to derive a new receive address, fetch balances and history, and batch multiple signing operations under one password unlock.

## [0.9.0] - 2026-04-22

### Added
- Added Send and Sweep as simple, ready-made actions, plus default fee and donation settings seeded per chain.

## [0.8.0] - 2026-04-22

### Added
- Added the ability to import an existing recovery phrase, and unified transaction submission into a single reusable flow.

## [0.7.0] - 2026-04-22

### Added
- Added the core flows for creating and unlocking a wallet.

## [0.6.0] - 2026-04-22

### Changed
- Added the internal pipeline for building, signing, and broadcasting a transaction end-to-end.

## [0.5.0] - 2026-04-22

### Changed
- Added the per-chain SDK connection registry and completed the software signer's address derivation and signing methods.

## [0.4.0] - 2026-04-22

### Changed
- Added the encrypted local storage layer and support for importing legacy Counterwallet recovery phrases.

## [0.3.0] - 2026-04-22

### Changed
- Added the dApp-connection interface definitions, a reference test app, the wallet's core data schemas, the supported-chains registry, and the signer interface.

## [0.2.0] - 2026-04-22

### Changed
- Internal: set up the project's workspace structure, CI skeleton, and package scaffolding.

## [0.1.0] - 2026-04-22

### Added
- Repository seeded with standard XChain Platform project metadata: `LICENSE.md`, `NOTICE.md`, `README.md`, `CHANGELOG.md`, `package.json`, `.gitignore`
