// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The full-screen camera view behind `qrScanStart`: a live preview, a hint line
// and a Cancel button, reading QR codes with Apple's own detector
// (AVCaptureMetadataOutput). It only reports what it reads and when it closes;
// QrScanCoordinator decides what reaches the SPA. Nothing here logs a value.

import AVFoundation
import UIKit

final class VaultQrScannerViewController: UIViewController, QrScanSurface, AVCaptureMetadataOutputObjectsDelegate {

    var onRead: ((String?) -> Void)?
    var onClose: ((QrScanCloseReason) -> Void)?

    private enum Phase {
        case idle, opening, open, closing, closed
    }

    private let session: AVCaptureSession
    private let output: AVCaptureMetadataOutput
    private weak var host: UIViewController?
    /// Starting and stopping the camera blocks, so it never runs on the main thread.
    private let sessionQueue = DispatchQueue(label: "io.xchain.wallet.ios.qrscan", qos: .userInitiated)
    private let preview: AVCaptureVideoPreviewLayer
    private var phase = Phase.idle
    /// Closes asked for while the scanner was still opening or closing, run when that finishes.
    private var closeWaiters: [() -> Void] = []
    /// Camera error and interruption watchers, live while the scanner is up.
    private var sessionObservers: [NSObjectProtocol] = []

    /// The camera a scan uses: the back wide-angle camera, else any video camera.
    static func backCamera() -> AVCaptureDevice? {
        AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(for: .video)
    }

    /// Builds the capture graph, or nil when the camera or the QR detector cannot be attached.
    static func make(host: UIViewController) -> VaultQrScannerViewController? {
        guard let camera = backCamera(), let input = try? AVCaptureDeviceInput(device: camera) else { return nil }
        let session = AVCaptureSession()
        // The camera feed has to attach to the session.
        guard session.canAddInput(input) else { return nil }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        // The detector has to attach too.
        guard session.canAddOutput(output) else { return nil }
        session.addOutput(output)
        // QR has to be among the codes this camera can detect; it is the only type asked for.
        guard output.availableMetadataObjectTypes.contains(.qr) else { return nil }
        output.metadataObjectTypes = [.qr]
        return VaultQrScannerViewController(session: session, output: output, host: host)
    }

    private init(session: AVCaptureSession, output: AVCaptureMetadataOutput, host: UIViewController) {
        self.session = session
        self.output = output
        self.host = host
        self.preview = AVCaptureVideoPreviewLayer(session: session)
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
        isModalInPresentation = true
        output.setMetadataObjectsDelegate(self, queue: .main)
    }

    required init?(coder: NSCoder) {
        nil
    }

    deinit {
        sessionObservers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    // MARK: - Screen

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)

        let hint = UILabel()
        hint.text = "Point the camera at a QR code"
        hint.textColor = .white
        hint.font = .preferredFont(forTextStyle: .body)
        hint.adjustsFontForContentSizeCategory = true
        hint.numberOfLines = 0
        hint.textAlignment = .center

        let hintBackdrop = UIView()
        hintBackdrop.backgroundColor = UIColor.black.withAlphaComponent(0.6)
        hintBackdrop.layer.cornerRadius = 12
        hintBackdrop.addSubview(hint)

        var style = UIButton.Configuration.filled()
        style.title = "Cancel"
        style.baseBackgroundColor = UIColor.black.withAlphaComponent(0.6)
        style.baseForegroundColor = .white
        style.cornerStyle = .capsule
        style.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 28, bottom: 12, trailing: 28)
        style.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
            var updated = attributes
            updated.font = .preferredFont(forTextStyle: .headline)
            return updated
        }
        let cancel = UIButton(configuration: style)
        cancel.accessibilityIdentifier = "qr-scan-cancel"
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        for item in [hintBackdrop, hint, cancel] { item.translatesAutoresizingMaskIntoConstraints = false }
        view.addSubview(hintBackdrop)
        view.addSubview(cancel)

        // The hint sits under the top safe area and the Cancel button above the bottom one,
        // so neither hides behind the notch, the Dynamic Island or the home indicator.
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            hintBackdrop.topAnchor.constraint(equalTo: safe.topAnchor, constant: 24),
            hintBackdrop.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
            hintBackdrop.leadingAnchor.constraint(greaterThanOrEqualTo: safe.leadingAnchor, constant: 16),
            hint.topAnchor.constraint(equalTo: hintBackdrop.topAnchor, constant: 10),
            hint.bottomAnchor.constraint(equalTo: hintBackdrop.bottomAnchor, constant: -10),
            hint.leadingAnchor.constraint(equalTo: hintBackdrop.leadingAnchor, constant: 16),
            hint.trailingAnchor.constraint(equalTo: hintBackdrop.trailingAnchor, constant: -16),
            cancel.bottomAnchor.constraint(equalTo: safe.bottomAnchor, constant: -24),
            cancel.centerXAnchor.constraint(equalTo: safe.centerXAnchor),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview.frame = view.bounds
        alignPreviewToInterface()
    }

    /// Turns the preview with the interface, since the app allows landscape on every device.
    private func alignPreviewToInterface() {
        guard let connection = preview.connection,
              let orientation = view.window?.windowScene?.interfaceOrientation else { return }
        if #available(iOS 17.0, *) {
            let angle: CGFloat
            switch orientation {
            case .landscapeRight: angle = 0
            case .portraitUpsideDown: angle = 270
            case .landscapeLeft: angle = 180
            default: angle = 90
            }
            if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
        } else {
            guard connection.isVideoOrientationSupported else { return }
            switch orientation {
            case .landscapeRight: connection.videoOrientation = .landscapeRight
            case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
            case .landscapeLeft: connection.videoOrientation = .landscapeLeft
            default: connection.videoOrientation = .portrait
            }
        }
    }

    @objc private func cancelTapped() {
        onClose?(.cancelled)
    }

    // MARK: - QrScanSurface

    func open(_ done: @escaping (Bool) -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        // There is nothing to present over, so the scan cannot open.
        guard phase == .idle, let host = host else { done(false); return }
        phase = .opening

        // A camera error mid-scan closes the scanner as an error.
        sessionObservers.append(NotificationCenter.default.addObserver(
            forName: .AVCaptureSessionRuntimeError, object: session, queue: .main
        ) { [weak self] _ in
            self?.onClose?(.error)
        })
        // iOS took the camera away (a call, or iPad multitasking), so the preview would sit frozen.
        sessionObservers.append(NotificationCenter.default.addObserver(
            forName: .AVCaptureSessionWasInterrupted, object: session, queue: .main
        ) { [weak self] _ in
            self?.onClose?(.interrupted)
        })

        // The camera warms up while the scanner animates in; the start settles when both are done.
        let ready = DispatchGroup()
        var running = false
        ready.enter()
        sessionQueue.async {
            self.session.startRunning()
            running = self.session.isRunning
            ready.leave()
        }
        ready.enter()
        var presented = false
        let shown = { if !presented { presented = true; ready.leave() } }
        topmost(from: host).present(self, animated: true, completion: shown)
        // UIKit refuses a presentation silently while another is mid-flight and never calls back.
        if presentingViewController == nil { shown() }
        ready.notify(queue: .main) {
            self.phase = .open
            done(running && self.presentingViewController != nil)
            // A close asked for during the opening runs now, unless the callback above already closed.
            if self.phase == .open && !self.closeWaiters.isEmpty { self.dismissNow() }
        }
    }

    func close(_ done: @escaping () -> Void) {
        dispatchPrecondition(condition: .onQueue(.main))
        switch phase {
        case .idle, .closed:
            done()
        case .opening, .closing:
            closeWaiters.append(done)
        case .open:
            closeWaiters.append(done)
            dismissNow()
        }
    }

    private func dismissNow() {
        phase = .closing
        sessionObservers.forEach { NotificationCenter.default.removeObserver($0) }
        sessionObservers = []
        output.setMetadataObjectsDelegate(nil, queue: nil)

        // Closing settles only after the screen is gone and the capture device is released.
        let teardown = DispatchGroup()
        teardown.enter()
        sessionQueue.async {
            self.session.stopRunning()
            teardown.leave()
        }
        teardown.enter()
        if let presenter = presentingViewController {
            presenter.dismiss(animated: true) { teardown.leave() }
        } else {
            teardown.leave()
        }
        teardown.notify(queue: .main) {
            self.phase = .closed
            let waiters = self.closeWaiters
            self.closeWaiters = []
            waiters.forEach { $0() }
        }
    }

    /// The view controller currently on top, so the scanner never presents under another one.
    private func topmost(from root: UIViewController) -> UIViewController {
        var top = root
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }

    // MARK: - AVCaptureMetadataOutputObjectsDelegate

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
                        from connection: AVCaptureConnection) {
        // Reads only count while the scanner is up.
        guard phase == .opening || phase == .open else { return }
        // An empty set means the code left the view.
        guard !metadataObjects.isEmpty else { onRead?(nil); return }
        // The first QR code carrying text; a binary-only code has no string and is skipped.
        let text = metadataObjects.lazy
            .compactMap { $0 as? AVMetadataMachineReadableCodeObject }
            .filter { $0.type == .qr }
            .compactMap { $0.stringValue }
            .first
        if let text = text { onRead?(text) }
    }
}
