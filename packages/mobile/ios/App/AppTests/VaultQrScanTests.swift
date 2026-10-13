// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Holds qrScanStart / qrScanStop and their events to the plugin contract,
// driving the plugin methods the way the bridge does. A fake camera and screen
// stand in where the simulator has none; the no-camera case uses the real one.

import AVFoundation
import Capacitor
import UIKit
import XCTest
@testable import App

/// A scanner screen that opens and closes on command and records what it was asked.
private final class FakeSurface: QrScanSurface {
    var onRead: ((String?) -> Void)?
    var onClose: ((QrScanCloseReason) -> Void)?
    var cameraStarts = true
    /// Holds the open until the test calls finishOpen, to land events mid-opening.
    var holdOpen = false
    var finishOpen: (() -> Void)?
    var closes = 0

    func open(_ done: @escaping (Bool) -> Void) {
        let finish = { done(self.cameraStarts) }
        if holdOpen {
            finishOpen = finish
        } else {
            DispatchQueue.main.async(execute: finish)
        }
    }

    func close(_ done: @escaping () -> Void) {
        closes += 1
        DispatchQueue.main.async { done() }
    }
}

/// A device with a camera whose permission state the test sets.
private final class FakeEnvironment: QrScanEnvironment {
    var status = AVAuthorizationStatus.authorized
    var camera = true
    var cameraStarts = true
    var holdOpen = false
    var pendingRequest: ((Bool) -> Void)?
    var requests = 0
    var surfaces: [FakeSurface] = []

    func cameraStatus() -> AVAuthorizationStatus { status }
    func requestCamera(_ done: @escaping (Bool) -> Void) {
        requests += 1
        pendingRequest = done
    }
    func hasCamera() -> Bool { camera }
    func makeSurface() -> QrScanSurface? {
        let surface = FakeSurface()
        surface.cameraStarts = cameraStarts
        surface.holdOpen = holdOpen
        surfaces.append(surface)
        return surface
    }
}

final class VaultQrScanTests: XCTestCase {

    // MARK: - Helpers

    private func pluginCall(_ method: String, _ options: [String: Any] = [:],
                            success: @escaping ([String: Any]) -> Void,
                            error: @escaping (String?) -> Void) -> CAPPluginCall {
        CAPPluginCall(
            callbackId: "test-\(method)", methodName: method,
            options: JSTypes.coerceDictionaryToJSObject(options) ?? [:],
            success: { result, _ in success(result?.data ?? [:]) },
            error: { err in error(err?.message) }
        )!
    }

    /// Runs a plugin method and waits for it to settle: (resolved data, reject message).
    private func run(_ plugin: XChainVaultPlugin, _ method: String) -> (data: [String: Any]?, error: String?) {
        let done = expectation(description: "\(method) settles")
        var data: [String: Any]?
        var error: String?
        let call = pluginCall(method, success: { data = $0; done.fulfill() }, error: { error = $0; done.fulfill() })
        switch method {
        case "qrScanStart": plugin.qrScanStart(call)
        default: plugin.qrScanStop(call)
        }
        wait(for: [done], timeout: 5)
        return (data, error)
    }

    /// Subscribes to a plugin event the way the bridge's addListener does, collecting payloads.
    private func listen(_ plugin: XChainVaultPlugin, _ event: String) -> () -> [[String: Any]] {
        var received: [[String: Any]] = []
        // The bridge creates the listener table when it loads a plugin; a bare instance has none.
        if plugin.eventListeners == nil { plugin.eventListeners = NSMutableDictionary() }
        let call = pluginCall("addListener", ["eventName": event],
                              success: { received.append($0) }, error: { _ in })
        call.keepAlive = true
        plugin.addEventListener(event, listener: call)
        return { received }
    }

    /// Lets queued main-thread work run.
    private func settle() {
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
    }

    private func fakePlugin(_ environment: FakeEnvironment) -> XChainVaultPlugin {
        let plugin = XChainVaultPlugin()
        plugin.qrScan = QrScanCoordinator(environment: environment)
        return plugin
    }

    // MARK: - Pure rules

    func testPermissionMapping() {
        XCTAssertEqual(QrCameraPermission(.authorized), .granted)
        XCTAssertEqual(QrCameraPermission(.notDetermined), .ask)
        XCTAssertEqual(QrCameraPermission(.denied), .refused)
        XCTAssertEqual(QrCameraPermission(.restricted), .refused)
    }

    func testRepeatFilterSendsEachAppearanceOnce() {
        func feed(_ reads: [String?]) -> [String] {
            var filter = QrRepeatFilter()
            return reads.compactMap { filter.admit($0) }
        }
        XCTAssertEqual(feed(["A", "A", "B", "B", "A"]), ["A", "B", "A"])
        XCTAssertEqual(feed(["A", "A", "A"]), ["A"])
        XCTAssertEqual(feed(["A", nil, "A"]), ["A", "A"], "a code that leaves and returns counts again")
        XCTAssertEqual(feed([nil, nil]), [])
    }

    // MARK: - Real camera stack

    func testStartRejectsUnavailableWithoutACamera() throws {
        #if targetEnvironment(simulator)
        XCTAssertNil(VaultQrScannerViewController.backCamera(), "the simulator has no capture device")
        #else
        try XCTSkipIf(VaultQrScannerViewController.backCamera() != nil, "this device has a camera")
        #endif
        let plugin = XChainVaultPlugin()
        let outcome = run(plugin, "qrScanStart")
        XCTAssertNil(outcome.data)
        XCTAssertEqual(outcome.error, "unavailable")
        XCTAssertFalse(plugin.qrScan.isOpen)
    }

    func testStopWithNothingOpenResolves() {
        let outcome = run(XChainVaultPlugin(), "qrScanStop")
        XCTAssertNil(outcome.error)
        XCTAssertNotNil(outcome.data)
    }

    // MARK: - Contract through a fake camera

    func testStartResolvesStartedAndASecondStartIsBusy() {
        let environment = FakeEnvironment()
        let plugin = fakePlugin(environment)
        let first = run(plugin, "qrScanStart")
        XCTAssertNil(first.error)
        XCTAssertEqual(first.data?["started"] as? Bool, true)
        XCTAssertEqual(run(plugin, "qrScanStart").error, "busy")
        XCTAssertEqual(environment.surfaces.count, 1, "the busy start opened nothing")
    }

    func testRefusedPermissionRejectsDenied() {
        for status in [AVAuthorizationStatus.denied, .restricted] {
            let environment = FakeEnvironment()
            environment.status = status
            let outcome = run(fakePlugin(environment), "qrScanStart")
            XCTAssertEqual(outcome.error, "denied", "\(status.rawValue)")
            XCTAssertTrue(environment.surfaces.isEmpty)
        }
    }

    func testUndecidedPermissionAsksOnce() {
        for (granted, expected) in [(false, "denied"), (true, nil)] as [(Bool, String?)] {
            let environment = FakeEnvironment()
            environment.status = .notDetermined
            let plugin = fakePlugin(environment)
            let done = expectation(description: "start settles")
            var error: String?
            let call = pluginCall("qrScanStart", success: { _ in done.fulfill() }, error: { error = $0; done.fulfill() })
            plugin.qrScanStart(call)
            settle()
            XCTAssertEqual(environment.requests, 1)
            environment.pendingRequest?(granted)
            wait(for: [done], timeout: 5)
            XCTAssertEqual(error, expected, "granted=\(granted)")
        }
    }

    func testNoCameraRejectsUnavailableBeforeAskingPermission() {
        let environment = FakeEnvironment()
        environment.camera = false
        environment.status = .notDetermined
        XCTAssertEqual(run(fakePlugin(environment), "qrScanStart").error, "unavailable")
        XCTAssertEqual(environment.requests, 0, "a device with no camera never shows the prompt")
    }

    func testCameraThatWillNotStartRejectsUnavailableAndFreesTheSlot() {
        let environment = FakeEnvironment()
        environment.cameraStarts = false
        let plugin = fakePlugin(environment)
        XCTAssertEqual(run(plugin, "qrScanStart").error, "unavailable")
        XCTAssertEqual(environment.surfaces.first?.closes, 1, "the half-open scanner was taken down")
        XCTAssertFalse(plugin.qrScan.isOpen)
    }

    func testFramesAreSentOncePerAppearance() {
        let environment = FakeEnvironment()
        let plugin = fakePlugin(environment)
        let frames = listen(plugin, "qrFrame")
        XCTAssertNil(run(plugin, "qrScanStart").error)
        let surface = environment.surfaces[0]
        for read in ["A", "A", "B", "B", nil, "B", "A"] as [String?] { surface.onRead?(read) }
        XCTAssertEqual(frames().compactMap { $0["value"] as? String }, ["A", "B", "B", "A"])
    }

    func testCancelSendsClosedOnceAndFreesTheSlot() {
        let environment = FakeEnvironment()
        let plugin = fakePlugin(environment)
        let closed = listen(plugin, "qrScanClosed")
        XCTAssertNil(run(plugin, "qrScanStart").error)
        let surface = environment.surfaces[0]
        surface.onClose?(.cancelled)
        // Racing closes after the first one send nothing.
        surface.onClose?(.error)
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        settle()
        XCTAssertEqual(closed().map { $0["reason"] as? String }, ["cancelled"])
        XCTAssertEqual(surface.closes, 1)
        XCTAssertFalse(plugin.qrScan.isOpen)
        surface.onRead?("late")
        XCTAssertNil(run(plugin, "qrScanStart").error, "a new scan can open after a cancel")
    }

    func testBackgroundingSendsInterrupted() {
        let environment = FakeEnvironment()
        let plugin = fakePlugin(environment)
        let closed = listen(plugin, "qrScanClosed")
        XCTAssertNil(run(plugin, "qrScanStart").error)
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        settle()
        XCTAssertEqual(closed().map { $0["reason"] as? String }, ["interrupted"])
        XCTAssertEqual(environment.surfaces[0].closes, 1)
    }

    func testSessionErrorSendsError() {
        let environment = FakeEnvironment()
        let plugin = fakePlugin(environment)
        let closed = listen(plugin, "qrScanClosed")
        XCTAssertNil(run(plugin, "qrScanStart").error)
        environment.surfaces[0].onClose?(.error)
        settle()
        XCTAssertEqual(closed().map { $0["reason"] as? String }, ["error"])
    }

    func testStopClosesWithoutAClosedEvent() {
        let environment = FakeEnvironment()
        let plugin = fakePlugin(environment)
        let closed = listen(plugin, "qrScanClosed")
        let frames = listen(plugin, "qrFrame")
        XCTAssertNil(run(plugin, "qrScanStart").error)
        XCTAssertNil(run(plugin, "qrScanStop").error)
        let surface = environment.surfaces[0]
        XCTAssertEqual(surface.closes, 1)
        surface.onRead?("after stop")
        settle()
        XCTAssertTrue(closed().isEmpty)
        XCTAssertTrue(frames().isEmpty)
        XCTAssertFalse(plugin.qrScan.isOpen)
    }

    func testStopDuringThePermissionPromptRejectsStopped() {
        let environment = FakeEnvironment()
        environment.status = .notDetermined
        let plugin = fakePlugin(environment)
        let done = expectation(description: "start settles")
        var error: String?
        plugin.qrScanStart(pluginCall("qrScanStart", success: { _ in done.fulfill() },
                                      error: { error = $0; done.fulfill() }))
        settle()
        XCTAssertNil(run(plugin, "qrScanStop").error)
        environment.pendingRequest?(true)
        wait(for: [done], timeout: 5)
        XCTAssertEqual(error, "stopped")
        XCTAssertTrue(environment.surfaces.isEmpty, "nothing opens after the SPA stopped the scan")
        XCTAssertFalse(plugin.qrScan.isOpen)
    }

    func testCloseDuringOpeningIsSentAfterTheStartResolves() {
        let environment = FakeEnvironment()
        environment.holdOpen = true
        let plugin = fakePlugin(environment)
        var order: [String] = []
        let closedCall = pluginCall("addListener", ["eventName": "qrScanClosed"],
                                    success: { order.append("closed:\($0["reason"] as? String ?? "")") }, error: { _ in })
        closedCall.keepAlive = true
        plugin.eventListeners = NSMutableDictionary()
        plugin.addEventListener("qrScanClosed", listener: closedCall)
        let done = expectation(description: "start settles")
        plugin.qrScanStart(pluginCall("qrScanStart", success: { _ in order.append("started"); done.fulfill() },
                                      error: { _ in done.fulfill() }))
        settle()
        // The app backgrounds while the scanner is still opening: nothing is sent yet.
        NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
        settle()
        XCTAssertEqual(order, [])
        environment.surfaces[0].finishOpen?()
        wait(for: [done], timeout: 5)
        settle()
        XCTAssertEqual(order, ["started", "closed:interrupted"])
        XCTAssertFalse(plugin.qrScan.isOpen)
    }
}
