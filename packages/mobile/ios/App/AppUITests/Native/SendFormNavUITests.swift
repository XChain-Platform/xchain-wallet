import XCTest

final class SendFormNavUITests: XCTestCase {
    func testSendFormValuesSurviveDuoFoldCapture() {
        executionTimeAllowance = 600

        guard
            let seedPath = ProcessInfo.processInfo.environment["XCHAIN_UITEST_SEED_FILE"],
            !seedPath.isEmpty
        else {
            XCTFail("XCHAIN_UITEST_SEED_FILE is required")
            return
        }

        let phrase: String
        do {
            phrase = try String(contentsOfFile: seedPath, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            XCTFail("XCHAIN_UITEST_SEED_FILE could not be read")
            return
        }
        guard phrase.split(whereSeparator: { $0.isWhitespace }).count >= 12 else {
            XCTFail("XCHAIN_UITEST_SEED_FILE does not contain a recovery phrase")
            return
        }
        defer { UIPasteboard.general.items = [] }

        let app = XCUIApplication()
        app.launch()

        let password = "WalletPass1!"
        guard importWallet(app, phrase: phrase, password: password) else {
            return
        }

        let networkSelection = NetworkSwitchNav.select(
            app,
            network: "Testnet",
            password: password
        )
        guard networkSelection == .switched || networkSelection == .alreadyActive else {
            XCTFail("The funded wallet could not select the Litecoin test network")
            return
        }

        guard SendFormNav.open(app, timeout: 60) else {
            XCTFail("Funded balance on the Litecoin test network")
            return
        }
        guard SendFormNav.fill(
            app,
            to: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
            amount: "0.0001"
        ) else {
            XCTFail("Send form values could not be entered")
            return
        }

        let expected = [
            "to": "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
            "amount": "0.0001",
        ]
        let values = SendFormNav.fieldValues(app)
        XCTAssertEqual(values, expected)

        let before = DuoFoldPlan.Capture(
            fields: values,
            scrollTop: 0,
            confirmOpen: false,
            detailKey: nil
        )
        let after = DuoFoldPlan.Capture(
            fields: values,
            scrollTop: 0,
            confirmOpen: false,
            detailKey: nil
        )
        XCTAssertEqual(
            DuoFoldPlan.survivalFailures(before: before, after: after),
            []
        )

        var changedValues = values
        changedValues["amount"] = "0.0002"
        let changed = DuoFoldPlan.Capture(
            fields: changedValues,
            scrollTop: 0,
            confirmOpen: false,
            detailKey: nil
        )
        XCTAssertEqual(
            DuoFoldPlan.survivalFailures(before: before, after: changed),
            ["field:amount"]
        )
    }

    private func importWallet(
        _ app: XCUIApplication,
        phrase: String,
        password: String
    ) -> Bool {
        guard reachImportChoice(app) else {
            return failImport("Import Wallet choice", app: app, safeToDescribe: true)
        }

        let start = exactButton(app, "Import Wallet")
        guard start.exists && start.isEnabled else {
            return failImport("Import Wallet button", app: app, safeToDescribe: true)
        }
        tap(start)

        let passwordField = app.secureTextFields.matching(
            NSPredicate(format: "label ==[c] %@", "Password")
        ).firstMatch
        let confirmField = app.secureTextFields.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Confirm")
        ).firstMatch
        guard passwordField.waitForExistence(timeout: 20) else {
            return failImport("Password field", app: app, safeToDescribe: true)
        }
        guard confirmField.waitForExistence(timeout: 20) else {
            return failImport("Confirm password field", app: app, safeToDescribe: true)
        }
        guard focus(passwordField) else {
            return failImport("Password field focus", app: app, safeToDescribe: true)
        }
        passwordField.typeText(password)
        guard dismissKeyboard(app) else {
            return failImport("Password keyboard dismissal", app: app, safeToDescribe: true)
        }
        guard focus(confirmField) else {
            return failImport("Confirm password field focus", app: app, safeToDescribe: true)
        }
        confirmField.typeText(password)
        guard dismissKeyboard(app) else {
            return failImport("Confirm password keyboard dismissal", app: app, safeToDescribe: true)
        }

        let phraseField = app.textViews.matching(
            NSPredicate(format: "label ==[c] %@", "Recovery phrase")
        ).firstMatch
        guard phraseField.waitForExistence(timeout: 20) else {
            return failImport("Recovery phrase field", app: app, safeToDescribe: true)
        }
        for _ in 0..<6 where !phraseField.isHittable {
            app.webViews.firstMatch.swipeDown()
        }
        guard focus(phraseField) else {
            return failImport("Recovery phrase field focus", app: app, safeToDescribe: true)
        }

        UIPasteboard.general.setItems(
            [["public.utf8-plain-text": phrase]],
            options: [
                .localOnly: true,
                .expirationDate: Date().addingTimeInterval(240),
            ]
        )
        guard pasteViaMenu(into: phraseField, app: app) else {
            return failImport("Recovery phrase paste menu", app: app, safeToDescribe: false)
        }
        guard waitUntil(timeout: 10, condition: {
            wordCount(phraseField) >= 12
        }) else {
            leaveSensitiveImport(app)
            return failImport("Recovery phrase paste", app: app, safeToDescribe: false)
        }
        guard dismissKeyboard(app) else {
            leaveSensitiveImport(app)
            return failImport("Recovery phrase keyboard dismissal", app: app, safeToDescribe: false)
        }

        let submit = exactButton(app, "Import")
        for _ in 0..<8 where !submit.isHittable {
            app.webViews.firstMatch.swipeUp()
        }
        guard submit.exists && submit.isEnabled else {
            leaveSensitiveImport(app)
            return failImport("Import submit button", app: app, safeToDescribe: false)
        }
        tap(submit)

        let donations = app.staticTexts.matching(
            NSPredicate(format: "label ==[c] %@", "Automatic Donations")
        ).firstMatch
        guard donations.waitForExistence(timeout: 120) else {
            leaveSensitiveImport(app)
            return failImport("Automatic Donations notice", app: app, safeToDescribe: false)
        }

        let continueButton = exactButton(app, "Continue")
        guard waitUntil(timeout: 20, condition: {
            continueButton.exists && continueButton.isHittable && continueButton.isEnabled
        }) else {
            return failImport("Automatic Donations Continue", app: app, safeToDescribe: true)
        }
        continueButton.tap()
        settleAfterImport(app)

        guard waitUntil(timeout: 90, condition: {
            exactButton(app, "Send").exists
                || exactButton(app, "Home").exists
                || exactButton(app, "Balances").exists
        }) else {
            return failImport("imported wallet home", app: app, safeToDescribe: true)
        }
        return true
    }

    private func reachImportChoice(_ app: XCUIApplication) -> Bool {
        for _ in 0..<16 {
            let importWallet = exactButton(app, "Import Wallet")
            if importWallet.exists {
                return true
            }
            if acceptLicenseIfPresent(app) {
                continue
            }
            var advanced = false
            for label in ["Skip", "Get started", "Done", "Next"] {
                let button = exactButton(app, label)
                if button.exists && button.isHittable && button.isEnabled {
                    button.tap()
                    advanced = true
                    _ = waitUntil(timeout: 2) {
                        exactButton(app, "Import Wallet").exists || !button.exists
                    }
                    break
                }
            }
            if !advanced {
                RunLoop.current.run(until: Date().addingTimeInterval(0.5))
            }
        }
        return exactButton(app, "Import Wallet").exists
    }

    private func acceptLicenseIfPresent(_ app: XCUIApplication) -> Bool {
        let accept = exactButton(app, "Accept and continue")
        guard accept.exists else { return false }

        let agreement = app.descendants(matching: .any).matching(
            NSPredicate(format: "label BEGINSWITH[c] %@", "I have read and agree")
        ).firstMatch
        let terms = app.descendants(matching: .any).matching(
            NSPredicate(format: "label ==[c] %@", "License terms")
        ).firstMatch
        guard waitUntil(timeout: 30, condition: {
            if agreement.exists && agreement.isEnabled { return true }
            if terms.exists && terms.isHittable {
                terms.swipeUp(velocity: .fast)
            } else {
                app.swipeUp(velocity: .fast)
            }
            return false
        }) else {
            return false
        }

        if agreement.elementType == .staticText || agreement.elementType == .other {
            agreement.coordinate(
                withNormalizedOffset: CGVector(dx: 0, dy: 0.5)
            ).withOffset(CGVector(dx: -24, dy: 0)).tap()
        } else {
            agreement.tap()
        }
        guard waitUntil(timeout: 10, condition: {
            accept.isHittable && accept.isEnabled
        }) else {
            return false
        }
        accept.tap()
        return true
    }

    private func settleAfterImport(_ app: XCUIApplication) {
        for _ in 0..<10 {
            var advanced = false
            for label in ["Skip", "Get started", "Done", "Not now", "Maybe later"] {
                let button = exactButton(app, label)
                if button.exists && button.isHittable && button.isEnabled {
                    button.tap()
                    advanced = true
                    RunLoop.current.run(until: Date().addingTimeInterval(0.5))
                    break
                }
            }
            if !advanced { return }
        }
    }

    private func pasteViaMenu(
        into field: XCUIElement,
        app: XCUIApplication
    ) -> Bool {
        for _ in 0..<3 {
            field.press(forDuration: 1.2)
            if let paste = pasteControl(app, timeout: 5) {
                paste.tap()
                allowPasteIfPresent()
                return true
            }
            field.tap()
            if let paste = pasteControl(app, timeout: 5) {
                paste.tap()
                allowPasteIfPresent()
                return true
            }
        }
        return false
    }

    private func pasteControl(
        _ app: XCUIApplication,
        timeout: TimeInterval
    ) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            for query in [app.menuItems, app.buttons] {
                let paste = query.matching(
                    NSPredicate(format: "label ==[c] %@", "Paste")
                ).firstMatch
                if paste.exists && paste.isHittable {
                    return paste
                }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return nil
    }

    private func allowPasteIfPresent() {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons.matching(
            NSPredicate(format: "label ==[c] %@", "Allow Paste")
        ).firstMatch
        if allow.waitForExistence(timeout: 3) && allow.isHittable {
            allow.tap()
        }
    }

    private func dismissKeyboard(_ app: XCUIApplication) -> Bool {
        if app.keyboards.count == 0 { return true }

        let dismissPredicate = NSPredicate(
            format: "label ==[c] 'Done' OR label ==[c] 'Hide keyboard' OR label ==[c] 'Return'"
        )
        for query in [app.toolbars.buttons, app.keyboards.buttons, app.buttons] {
            let dismiss = query.matching(dismissPredicate).firstMatch
            if dismiss.exists && dismiss.isHittable {
                dismiss.tap()
                if waitUntil(timeout: 5, condition: { app.keyboards.count == 0 }) {
                    return true
                }
            }
        }

        let title = app.staticTexts.matching(
            NSPredicate(format: "label ==[c] %@", "Import Wallet")
        ).firstMatch
        if title.exists && title.isHittable {
            title.tap()
        }
        if waitUntil(timeout: 5, condition: { app.keyboards.count == 0 }) {
            return true
        }

        let window = app.windows.firstMatch
        if window.exists {
            window.coordinate(
                withNormalizedOffset: CGVector(dx: 0.5, dy: 0.075)
            ).tap()
        }
        return waitUntil(timeout: 5) { app.keyboards.count == 0 }
    }

    private func focus(_ element: XCUIElement) -> Bool {
        tap(element)
        if waitUntil(timeout: 5, condition: { hasKeyboardFocus(element) }) {
            return true
        }
        element.coordinate(
            withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
        ).tap()
        return waitUntil(timeout: 5) { hasKeyboardFocus(element) }
    }

    private func hasKeyboardFocus(_ element: XCUIElement) -> Bool {
        element.exists && (element.value(forKey: "hasKeyboardFocus") as? Bool == true)
    }

    private func leaveSensitiveImport(_ app: XCUIApplication) {
        UIPasteboard.general.items = []
        let back = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Back to wallet setup")
        ).firstMatch
        if back.exists {
            tap(back)
            if waitUntil(timeout: 5, condition: { !back.exists }) {
                return
            }
        }
        app.terminate()
    }

    private func wordCount(_ field: XCUIElement) -> Int {
        guard let value = field.value as? String else { return 0 }
        return value.split(whereSeparator: { $0.isWhitespace }).count
    }

    private func exactButton(
        _ app: XCUIApplication,
        _ label: String
    ) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(format: "label ==[c] %@", label)
        ).firstMatch
    }

    private func tap(_ element: XCUIElement) {
        if element.isHittable && element.isEnabled {
            element.tap()
        } else {
            element.coordinate(
                withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)
            ).tap()
        }
    }

    private func waitUntil(
        timeout: TimeInterval,
        condition: () -> Bool
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        } while Date() < deadline
        return condition()
    }

    private func failImport(
        _ step: String,
        app: XCUIApplication,
        safeToDescribe: Bool
    ) -> Bool {
        if !safeToDescribe {
            UIPasteboard.general.items = []
        }
        XCTFail("Wallet import failed at \(step)")
        if safeToDescribe {
            let attachment = XCTAttachment(string: app.debugDescription)
            attachment.name = "Wallet import UI at \(step)"
            attachment.lifetime = .deleteOnSuccess
            add(attachment)
        }
        return false
    }
}
