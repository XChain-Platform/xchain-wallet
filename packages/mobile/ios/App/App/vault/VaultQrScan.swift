// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The logic behind `qrScanStart` / `qrScanStop` on the XChainVault plugin.
//
// WKWebView has no BarcodeDetector, so the shared QR screen cannot read a code
// on iOS. This file decides whether a scan may open (camera present, permission
// granted, no scan already open), forwards each newly read payload as a
// `qrFrame` event, and reports a scanner that closes on its own as
// `qrScanClosed`. The camera and the screen sit behind two small protocols so
// tests can drive every rule without a camera. Scanned values are never logged.

import AVFoundation
import UIKit

/// Why a scanner closed without the SPA asking, as sent in `qrScanClosed`.
enum QrScanCloseReason: String {
    case cancelled
    case interrupted
    case error
}

/// Why `qrScanStart` refused, as the reject message the SPA matches on.
enum QrScanRefusal: String, Error {
    case denied
    case unavailable
    case busy
    /// The SPA called `qrScanStop` before this start settled.
    case stopped
}

/// What the system camera permission means for a scan.
enum QrCameraPermission: Equatable {
    case granted
    case ask
    case refused

    init(_ status: AVAuthorizationStatus) {
        switch status {
        case .authorized:
            self = .granted
        case .notDetermined:
            self = .ask
        // Denied by the user and restricted by policy both need Settings to change.
        case .denied, .restricted:
            self = .refused
        @unknown default:
            self = .refused
        }
    }
}

/// Drops a read that repeats the one before it, so a code held in view is sent once.
/// A nil read means no code is in view, so the same code counts again when it returns.
struct QrRepeatFilter {
    private var last: String?

    mutating func admit(_ read: String?) -> String? {
        defer { last = read }
        guard let read = read, read != last else { return nil }
        return read
    }
}

/// The on-screen scanner as the coordinator sees it. Every member is used on the main thread.
protocol QrScanSurface: AnyObject {
    /// Each payload the camera reads, or nil when no code is in view.
    var onRead: ((String?) -> Void)? { get set }
    /// The scanner closing on its own: the Cancel button, a camera error, or iOS taking the camera away.
    var onClose: ((QrScanCloseReason) -> Void)? { get set }
    /// Puts the scanner on screen and starts the camera; reports false if the camera did not start.
    func open(_ done: @escaping (Bool) -> Void)
    /// Stops the camera and takes the scanner off screen.
    func close(_ done: @escaping () -> Void)
}

/// The device facts and actions a scan needs; tests inject a fake.
protocol QrScanEnvironment {
    func cameraStatus() -> AVAuthorizationStatus
    func requestCamera(_ done: @escaping (Bool) -> Void)
    func hasCamera() -> Bool
    func makeSurface() -> QrScanSurface?
}

/// The real camera and the real screen.
struct SystemQrScanEnvironment: QrScanEnvironment {
    /// The view controller the scanner is presented over, read when a scan starts.
    let host: () -> UIViewController?

    func cameraStatus() -> AVAuthorizationStatus {
        AVCaptureDevice.authorizationStatus(for: .video)
    }

    func requestCamera(_ done: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .video, completionHandler: done)
    }

    func hasCamera() -> Bool {
        VaultQrScannerViewController.backCamera() != nil
    }

    func makeSurface() -> QrScanSurface? {
        guard let host = host() else { return nil }
        return VaultQrScannerViewController.make(host: host)
    }
}

/// One scan at a time, from permission to teardown. Confined to the main thread.
final class QrScanCoordinator {

    /// Where events go; the plugin points this at notifyListeners.
    var emit: ((String, [String: Any]) -> Void)?

    private let environment: QrScanEnvironment
    private var surface: QrScanSurface?
    private var starting = false
    /// Bumped by every start and stop, so a start that outlives a stop can tell.
    private var generation = 0
    /// A close that arrived while the start was still settling, sent once it settles.
    private var deferredClose: QrScanCloseReason?
    private var filter = QrRepeatFilter()
    private var backgroundObserver: NSObjectProtocol?

    init(environment: QrScanEnvironment) {
        self.environment = environment
    }

    deinit {
        if let observer = backgroundObserver { NotificationCenter.default.removeObserver(observer) }
    }

    /// True while a scanner is opening or open.
    var isOpen: Bool { surface != nil || starting }

    /// Opens the scanner, then reports nil, or the refusal the start is rejected with.
    func start(_ done: @escaping (QrScanRefusal?) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        // Only one scanner can be open at a time.
        guard !isOpen else { done(.busy); return }
        // No camera means nothing to ask permission for, so this is checked first.
        guard environment.hasCamera() else { done(.unavailable); return }

        starting = true
        generation += 1
        let attempt = generation
        switch QrCameraPermission(environment.cameraStatus()) {
        case .granted:
            present(attempt, done)
        case .refused:
            starting = false
            done(.denied)
        case .ask:
            environment.requestCamera { granted in
                DispatchQueue.main.async {
                    // The SPA stopped the scan while the permission prompt was up.
                    guard attempt == self.generation else { done(.stopped); return }
                    if granted {
                        self.present(attempt, done)
                    } else {
                        self.starting = false
                        done(.denied)
                    }
                }
            }
        }
    }

    /// Closes whatever is open without sending `qrScanClosed`: the SPA asked for it.
    func stop(_ done: @escaping () -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        generation += 1
        starting = false
        deferredClose = nil
        guard let open = surface else { done(); return }
        detach()
        open.close(done)
    }

    private func present(_ attempt: Int, _ done: @escaping (QrScanRefusal?) -> Void) {
        // The capture graph cannot be built, or there is no screen to show it on.
        guard let made = environment.makeSurface() else {
            starting = false
            done(.unavailable)
            return
        }
        made.onRead = { [weak self, weak made] read in
            guard let self = self, let made = made else { return }
            self.read(read, from: made)
        }
        made.onClose = { [weak self, weak made] reason in
            guard let self = self, let made = made else { return }
            self.closedItself(made, reason)
        }
        surface = made
        filter = QrRepeatFilter()
        watchBackground()

        made.open { [weak self] running in
            guard let self = self else { return }
            // The SPA stopped the scan while it was opening; stop already closed it.
            guard attempt == self.generation else { done(.stopped); return }
            self.starting = false
            // The camera did not start, so the scanner comes straight back down.
            guard running else {
                self.detach()
                made.close {}
                done(.unavailable)
                return
            }
            done(nil)
            if let reason = self.deferredClose {
                self.deferredClose = nil
                self.finish(made, reason)
            }
        }
    }

    private func read(_ read: String?, from source: QrScanSurface) {
        // Reads from a closed scanner, or before the start has resolved, are not sent.
        guard source === surface, !starting else { return }
        guard let value = filter.admit(read) else { return }
        emit?("qrFrame", ["value": value])
    }

    private func closedItself(_ source: QrScanSurface, _ reason: QrScanCloseReason) {
        // A scanner already torn down sends nothing, so each open ends in at most one event.
        guard source === surface else { return }
        // The start has not resolved yet; the close is sent right after it does.
        if starting {
            if deferredClose == nil { deferredClose = reason }
            return
        }
        finish(source, reason)
    }

    private func finish(_ source: QrScanSurface, _ reason: QrScanCloseReason) {
        detach()
        source.close {}
        emit?("qrScanClosed", ["reason": reason.rawValue])
    }

    /// Forgets the open scanner so nothing it says afterwards is forwarded.
    private func detach() {
        surface?.onRead = nil
        surface?.onClose = nil
        surface = nil
        if let observer = backgroundObserver {
            NotificationCenter.default.removeObserver(observer)
            backgroundObserver = nil
        }
    }

    /// iOS takes the camera away in the background, so the scan ends as interrupted.
    private func watchBackground() {
        guard backgroundObserver == nil else { return }
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self = self, let open = self.surface else { return }
            self.closedItself(open, .interrupted)
        }
    }
}
