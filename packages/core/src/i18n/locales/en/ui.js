// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `ui.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // Copy moved out of JSX literals by the i18n sweep.
    'ui.qrScanner.scanWithCamera': 'Scan with camera',
    'ui.qrScanner.scanningPointTheCameraAt': 'Scanning… point the camera at a QR code.',
    'ui.qrScanner.opensTheCameraToRead': 'Opens the camera to read a QR code.',
    'ui.qrScanner.qrScanner': 'QR scanner',
    'ui.qrScanner.cameraScanningRequiresA': 'Camera scanning requires a',
    'ui.qrScanner.secureContext': 'secure context',
    'ui.qrScanner.httpsOr': '(HTTPS, or',
    'ui.qrScanner.localhost': 'localhost',
    'ui.qrScanner.thisPageIsLoadedFrom': '). This page is loaded from',
    'ui.qrScanner.whichBrowsersTreatAsInsecure': 'which browsers treat as insecure, so',
    'ui.qrScanner.getusermedia': 'getUserMedia',
    'ui.qrScanner.and': 'and',
    'ui.qrScanner.barcodedetector': 'BarcodeDetector',
    'ui.qrScanner.areBlockedEitherOpenThe': 'are blocked. Either open the wallet via',
    'ui.qrScanner.https': 'https://',
    'ui.qrScanner.or': 'or',
    'ui.qrScanner.httpLocalhost': 'http://localhost',
    'ui.qrScanner.orAddThisOriginTo': ", or add this origin to Chrome's",
    'ui.qrScanner.chromeFlagsUnsafelyTreatInsecure':
        'chrome://flags/#unsafely-treat-insecure-origin-as-secure',
    'ui.qrScanner.scanningWithTheCameraIs':
        "Scanning with the camera isn't available on this device yet. Paste the code below instead.",
    'ui.qrScanner.thisBrowserCannotScanQr':
        "This browser can't scan QR codes with the camera. Chrome, Edge and other Chromium browsers can; here, paste the code below instead.",
    'ui.qrScanner.cameraAccessIsNotAvailable':
        "Camera access isn't available in this browser. Paste the code below instead.",
    'ui.qrScanner.xchainWalletUsesTheCamera':
        'XChain Wallet uses the camera only to scan QR codes while this scanner is open. You can paste the code instead.',
    'ui.qrScanner.continueToCamera': 'Continue to camera',
    'ui.qrScanner.startingCamera': 'Starting camera…',
    'ui.feeSelector.feePriorityHelpLabel': 'Fee priority help',
    'ui.feeSelector.pickHowFastThisTransaction':
        'Pick how fast this transaction confirms. Faster fees cost more; Custom sets an exact rate.',
    'ui.feeSelector.min': 'min',
    'ui.feeSelector.feeEstimateUnavailableForThis': 'Fee estimate unavailable for this network.',
    'ui.feeSelector.slow': 'Slow',
    'ui.feeSelector.normal': 'Normal',
    'ui.feeSelector.fast': 'Fast',
    'ui.feeSelector.custom': 'Custom',
    'ui.feeSelector.networkFeeAmount': 'Network fee amount',
    'ui.feeSelector.editExactFeeAmount': 'Edit exact fee amount',
    'ui.feeSelector.selectToEditTheExact': 'Select to edit the exact fee',
    'ui.feeSelector.customFeeRate': 'Custom fee rate ({unit})',
    'ui.feeSelector.editFeeRate': 'Edit fee rate ({unit})',
    'ui.feeSelector.selectToEditTheFee': 'Select to edit the fee rate',
    'ui.feeSelector.liveFeeEstimateUnavailableUsing':
        'Live fee estimate unavailable. Using safe default rates. Custom fees remain available.',
    'ui.animatedQrFrames.animatedQr': 'Animated QR',
    'ui.animatedQrFrames.preparing': 'Preparing {qrAlt}',
    'ui.animatedQrFrames.frame': 'Frame',
    'ui.animatedQrFrames.resumeAnimation': 'Resume animation',
    'ui.animatedQrFrames.pauseAnimation': 'Pause animation',
    'ui.animatedQrFrames.resume': 'Resume',
    'ui.animatedQrFrames.pause': 'Pause',
    'ui.animatedQrFrames.previousFrame': 'Previous frame',
    'ui.animatedQrFrames.prev': 'Prev',
    'ui.animatedQrFrames.nextFrame': 'Next frame',
    'ui.chainPicker.selectANetwork': 'Select a network',
    'ui.addressCombobox.contact': 'Contact',
    'ui.addressCombobox.recent': 'Recent',
    'ui.formErrorSummary.formErrors': 'Form errors',
    'ui.formErrorSummary.fixThisField': 'Fix this field:',
    'ui.formErrorSummary.fixTheseFields': 'Fix these {length} fields:',
    'ui.iconSelect.select': 'Select…',
    'ui.iconSelect.options': 'Options',
    'ui.copyButton.copyValue': 'Copy value',
    'ui.infoTip.moreInfo': 'More info',
    'ui.multisigBadge.of': '-of-',
    'ui.verifiedBadge.details': '{label} details',
    'ui.feeSelector.customValueText': 'Custom: {rate} {unit}',
    'ui.feeSelector.speedValueText': '{speed}: {amount}',
    'ui.feeSelector.speedValueTextEta': '{speed}: {amount} · ~{eta} min',
    'ui.feeSelector.networkFeeAmountTicker': 'Network fee amount ({ticker})',
};

addEnglish(messages);

export default messages;
