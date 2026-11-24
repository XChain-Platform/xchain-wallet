// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import UIKit
import WebKit

@MainActor
final class FoldPublisher {
    enum HingeState { case absent, unknown, closed, partial, open }

    struct State: Equatable {
        let posture: String
        let division: CGRect
        let orientation: String
        let display: String
    }

    struct Cancellation {
        let cancel: @MainActor () -> Void
    }

    struct Environment {
        var observeSize: @MainActor (WKWebView, @escaping () -> Void) -> Cancellation
        var observeTraits: @MainActor (WKWebView, @escaping () -> Void) -> Cancellation
        var observeHinge: @MainActor (WKWebView, @escaping (HingeState) -> Void) -> Cancellation?
        var divisionFrame: @MainActor (WKWebView) -> CGRect?
        var bounds: @MainActor (WKWebView) -> CGRect
        var safeAreaInsets: @MainActor (WKWebView) -> UIEdgeInsets
        var installBootstrap: @MainActor (WKWebView, String) -> Void
        var evaluateJavaScript: @MainActor (WKWebView, String) -> Void
        var applyInsets: @MainActor (WKWebView, UIEdgeInsets) -> Void
        var log: @MainActor (String) -> Void

        static var live: Self {
            Self(
                observeSize: { webView, changed in
                    let bounds = webView.observe(\.bounds, options: [.new]) { _, _ in
                        MainActor.assumeIsolated { changed() }
                    }
                    let safeArea = webView.observe(\.safeAreaInsets, options: [.new]) { _, _ in
                        MainActor.assumeIsolated { changed() }
                    }
                    return Cancellation {
                        bounds.invalidate()
                        safeArea.invalidate()
                    }
                },
                observeTraits: { webView, changed in
                    if #available(iOS 17.0, *) {
                        let registration = webView.registerForTraitChanges([
                            UITraitHorizontalSizeClass.self,
                            UITraitVerticalSizeClass.self,
                        ]) { (_: WKWebView, _: UITraitCollection) in
                            changed()
                        }
                        return Cancellation { [weak webView] in
                            webView?.unregisterForTraitChanges(registration)
                        }
                    }
                    let traits = webView.observe(\.traitCollection, options: [.new]) { _, _ in
                        MainActor.assumeIsolated { changed() }
                    }
                    return Cancellation { traits.invalidate() }
                },
                observeHinge: { webView, changed in
                    guard #available(iOS 27.1, *) else { return nil }
                    let interaction = UIHingeInteraction { _, update in
                        changed(FoldPublisher.mappedHingeState(update.hinge?.status))
                    }
                    webView.addInteraction(interaction)
                    return Cancellation { [weak webView, weak interaction] in
                        guard let interaction else { return }
                        webView?.removeInteraction(interaction)
                    }
                },
                divisionFrame: { webView in
                    guard #available(iOS 27.1, *) else { return nil }
                    return FoldPublisher.divisionFrame { kind in
                        webView.reservedRegions(kind: kind)
                    }
                },
                bounds: { $0.bounds },
                safeAreaInsets: { $0.safeAreaInsets },
                installBootstrap: { webView, script in
                    webView.configuration.userContentController.addUserScript(
                        WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
                    )
                },
                evaluateJavaScript: { webView, script in webView.evaluateJavaScript(script) },
                applyInsets: { webView, insets in webView.scrollView.scrollIndicatorInsets = insets },
                log: { print($0) }
            )
        }
    }

    private weak var webView: WKWebView?
    private let environment: Environment
    private var cancellations: [Cancellation] = []
    private var hingeState = HingeState.absent
    private var isStarted = false
    private var didInstallBootstrap = false

    init(webView: WKWebView, environment: Environment = .live) {
        self.webView = webView
        self.environment = environment
    }

    func start() {
        guard !isStarted, let webView else { return }
        isStarted = true
        cancellations = [
            environment.observeSize(webView) { [weak self] in self?.publish() },
            environment.observeTraits(webView) { [weak self] in self?.publish() },
        ]
        if let hinge = environment.observeHinge(webView, { [weak self] state in
            self?.hingeState = state
            self?.publish()
        }) {
            cancellations.append(hinge)
        }
        publish(installBootstrap: !didInstallBootstrap)
    }

    func stop() {
        guard isStarted else { return }
        cancellations.forEach { $0.cancel() }
        cancellations.removeAll()
        isStarted = false
    }

    @available(iOS 27.1, *)
    nonisolated static func mappedHingeState(_ status: UIHinge.Status?) -> HingeState {
        guard let status else { return .absent }
        switch status {
        case .unknown: return .unknown
        case .closed: return .closed
        case .partiallyOpen: return .partial
        case .fullyOpen: return .open
        @unknown default: return .unknown
        }
    }

    @available(iOS 27.1, *)
    static func divisionFrame(
        query: (UIView.ReservedRegion.Kind) -> [UIView.ReservedRegion]
    ) -> CGRect? {
        query(.division).first?.frame
    }

    nonisolated static func state(status: HingeState, division: CGRect?) -> State {
        let frame = division ?? .zero
        let posture: String
        switch status {
        case .absent, .closed: posture = "closed"
        case .partial: posture = "partial"
        case .open: posture = "open"
        case .unknown: posture = division == nil ? "open" : "partial"
        }
        return State(
            posture: posture,
            division: frame,
            orientation: frame.isEmpty ? "none" : frame.height >= frame.width ? "vertical" : "horizontal",
            display: status == .absent || status == .closed ? "outer" : "inner"
        )
    }

    nonisolated static func bootstrapScript(json: String?) -> String? {
        FoldScript.bootstrapScript(json: json)
    }

    nonisolated static func publishScript(json: String?) -> String? {
        FoldScript.publishScript(json: json)
    }

    nonisolated static func indicatorInsets(for safeAreaInsets: UIEdgeInsets) -> UIEdgeInsets {
        safeAreaInsets
    }

    private func publish(installBootstrap: Bool = false) {
        guard let webView else { return }
        let state = Self.state(status: hingeState, division: environment.divisionFrame(webView))
        let frame = state.division
        let json = FoldPayload.json(
            posture: state.posture, orientation: state.orientation,
            x: frame.minX, y: frame.minY, width: frame.width, height: frame.height,
            display: state.display
        )
        if installBootstrap, let script = Self.bootstrapScript(json: json) {
            environment.installBootstrap(webView, script)
            didInstallBootstrap = true
        }
        if let script = Self.publishScript(json: json) {
            environment.evaluateJavaScript(webView, script)
        }
        let insets = Self.indicatorInsets(for: environment.safeAreaInsets(webView))
        environment.applyInsets(webView, insets)
        let bounds = environment.bounds(webView)
        if let line = FoldPayload.line(
            posture: state.posture, orientation: state.orientation,
            x: frame.minX, y: frame.minY, width: frame.width, height: frame.height,
            display: state.display,
            viewportWidth: bounds.width, viewportHeight: bounds.height
        ) {
            environment.log(line)
        }
    }
}
