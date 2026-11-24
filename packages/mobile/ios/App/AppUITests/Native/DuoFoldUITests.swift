import XCTest

final class DuoFoldUITests: XCTestCase {
    private let password = "WalletPass1!"
    private let recipient = "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx"
    private let amount = "0.0001"

    func testAmountComparisonIgnoresGroupingAndUnitSuffix() {
        XCTAssertTrue(sameDecimal("0.001 TLTC", "0.001"))
        XCTAssertTrue(sameDecimal("1,000 TLTC", "1000"))
        XCTAssertFalse(sameDecimal("0.001 TLTC", "0.002"))
    }

    func testDuoFoldPreservesHomeSendAndConfirmation() {
        executionTimeAllowance = 600

        guard let entries = DuoFoldFixture.load() else {
            XCTFail("The measured Duo fold fixture could not be loaded")
            return
        }
        let measured = entries.compactMap { entry -> (String, Double, Double, DuoFoldPlan.Division)? in
            guard case let .measured(name, width, height, division) = entry else {
                return nil
            }
            return (name, width, height, division)
        }
        guard !measured.isEmpty else {
            XCTFail("The Duo fixture has no simulator-reachable fold state")
            return
        }
        nameUnreachableStates(entries)

        guard let phrase = recoveryPhrase() else { return }
        defer { UIPasteboard.general.items = [] }

        let app = XCUIApplication()
        app.launch()

        guard prepareWallet(app, phrase: phrase) else { return }
        let network = NetworkSwitchNav.select(
            app,
            network: "Testnet",
            password: password
        )
        guard network == .switched || network == .alreadyActive else {
            XCTFail("The funded wallet could not select the test network")
            return
        }

        for state in measured {
            XCTContext.runActivity(named: "Home at \(state.0)") { _ in
                drive(state, app: app)
                assertHome(state, app: app)
            }
        }

        guard SendFormNav.open(app, timeout: 60) else {
            XCTFail("The funded wallet did not expose the Send form")
            return
        }
        guard SendFormNav.fill(
            app,
            to: recipient,
            amount: amount,
            timeout: 60
        ) else {
            XCTFail("The Send form values could not be entered")
            return
        }
        guard dismissKeyboard(app) else {
            XCTFail("The Send amount keyboard could not be dismissed")
            return
        }

        let initialValues = visibleSendFormValues(app)
        XCTAssertEqual(initialValues["to"], recipient)
        XCTAssertTrue(sameDecimal(initialValues["amount"], amount))

        guard expandFormSection("Advanced", app: app) else { return }
        guard expandFormSection("Speed and Fees", app: app) else { return }
        guard scrollToSendAction(app) else { return }

        guard let beforeScroll = sendScrollSnapshot(app) else {
            XCTFail("The expanded Send form has no stable scroll position")
            return
        }

        for state in measured {
            XCTContext.runActivity(named: "Filled Send form at \(state.0)") { _ in
                drive(state, app: app)
                settleAfterFold(app)
                let afterScroll = sendScrollSnapshot(app)
                XCTAssertNotNil(
                    afterScroll,
                    "\(state.0) lost the scrolled Send action"
                )
                if let afterScroll {
                    XCTAssertTrue(
                        sameScrollPosition(beforeScroll, afterScroll),
                        "\(state.0) reset the expanded Send form scroll"
                    )
                }

                let after = visibleSendFormValues(app)
                recordAfterFoldState(state.0, app: app)
                XCTAssertEqual(
                    after["to"],
                    initialValues["to"],
                    "\(state.0) changed the Send recipient"
                )
                XCTAssertTrue(
                    sameDecimal(after["amount"], initialValues["amount"]),
                    "\(state.0) changed the Send amount"
                )
                XCTAssertTrue(
                    scrollToSendAction(app),
                    "\(state.0) could not restore the Send form scroll"
                )
            }
        }

        guard let send = sendAction(app), send.isHittable && send.isEnabled else {
            XCTFail("The scrolled Send action is not reachable")
            return
        }
        send.tap()

        let reject = confirmButton(
            app,
            identifier: "confirm-reject",
            label: "Reject"
        )
        let approve = confirmButton(
            app,
            identifier: "confirm-approve",
            label: "Approve"
        )
        guard waitUntil(timeout: 60, condition: {
            reject.exists && reject.isEnabled
                && approve.exists && approve.isEnabled
        }) else {
            XCTFail("The Send confirmation did not open")
            return
        }

        for state in measured {
            XCTContext.runActivity(named: "Open Send confirmation at \(state.0)") { _ in
                drive(state, app: app)
                settleAfterFold(app)
                XCTAssertTrue(
                    reject.exists && approve.exists,
                    "\(state.0) closed the Send confirmation"
                )
                XCTAssertTrue(
                    waitForConfirmSettle(approve),
                    "\(state.0) did not re-arm the settled confirm action"
                )
            }
        }

        guard reject.exists && reject.isHittable && reject.isEnabled else {
            XCTFail("The open Send confirmation has no Reject action")
            return
        }
        reject.tap()
        guard waitUntil(timeout: 20, condition: {
            guard let action = sendAction(app) else { return false }
            return action.isHittable
        }) else {
            XCTFail("The Send form did not return after confirmation")
            return
        }

        guard let restoredScroll = sendScrollSnapshot(app) else {
            XCTFail("The returned Send form lost its scroll position")
            return
        }
        XCTAssertTrue(sameScrollPosition(beforeScroll, restoredScroll))

        let restored = visibleSendFormValues(app)
        XCTAssertEqual(restored["to"], initialValues["to"])
        XCTAssertTrue(sameDecimal(restored["amount"], initialValues["amount"]))
    }

    private func recoveryPhrase() -> String? {
        guard
            let path = ProcessInfo.processInfo.environment["XCHAIN_UITEST_SEED_FILE"],
            !path.isEmpty
        else {
            XCTFail("XCHAIN_UITEST_SEED_FILE is required")
            return nil
        }
        let phrase: String
        do {
            phrase = try String(contentsOfFile: path, encoding: .utf8)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            XCTFail("XCHAIN_UITEST_SEED_FILE could not be read")
            return nil
        }
        guard phrase.split(whereSeparator: { $0.isWhitespace }).count >= 12 else {
            XCTFail("XCHAIN_UITEST_SEED_FILE does not contain a recovery phrase")
            return nil
        }
        return phrase
    }

    private func prepareWallet(
        _ app: XCUIApplication,
        phrase: String
    ) -> Bool {
        let unlock = exactButton(app, "Unlock Wallet")
        if waitUntil(timeout: 10, condition: {
            unlock.exists || walletHomeExists(app)
        }) {
            if walletHomeExists(app) {
                return true
            }
            return unlockWallet(app, button: unlock)
        }
        return importWallet(app, phrase: phrase)
    }

    private func unlockWallet(
        _ app: XCUIApplication,
        button: XCUIElement
    ) -> Bool {
        let passwordField = app.secureTextFields.firstMatch
        guard passwordField.waitForExistence(timeout: 20) else {
            return failWalletPreparation("stored wallet password field")
        }
        guard fillSecure(passwordField, value: password, app: app) else {
            return failWalletPreparation("stored wallet password entry")
        }
        guard waitUntil(timeout: 10, condition: {
            button.exists && button.isHittable && button.isEnabled
        }) else {
            return failWalletPreparation("stored wallet unlock action")
        }
        button.tap()
        guard waitUntil(timeout: 90, condition: {
            !button.exists && walletHomeExists(app)
        }) else {
            return failWalletPreparation("stored wallet home")
        }
        return true
    }

    private func walletHomeExists(_ app: XCUIApplication) -> Bool {
        exactButton(app, "Send").exists
            || exactButton(app, "Home").exists
            || exactButton(app, "Balances").exists
    }

    private func importWallet(_ app: XCUIApplication, phrase: String) -> Bool {
        guard reachImportChoice(app) else {
            return failImport("Import Wallet choice")
        }
        let start = exactButton(app, "Import Wallet")
        guard start.exists && start.isEnabled else {
            return failImport("Import Wallet button")
        }
        tap(start)

        let passwordField = app.secureTextFields.matching(
            NSPredicate(format: "label ==[c] %@", "Password")
        ).firstMatch
        let confirmField = app.secureTextFields.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Confirm")
        ).firstMatch
        guard passwordField.waitForExistence(timeout: 20) else {
            return failImport("Password field")
        }
        guard confirmField.waitForExistence(timeout: 20) else {
            return failImport("Confirm password field")
        }
        guard fillSecure(passwordField, value: password, app: app) else {
            return failImport("Password entry")
        }
        guard fillSecure(confirmField, value: password, app: app) else {
            return failImport("Confirm password entry")
        }

        let phraseField = app.textViews.matching(
            NSPredicate(format: "label ==[c] %@", "Recovery phrase")
        ).firstMatch
        guard phraseField.waitForExistence(timeout: 20) else {
            return failImport("Recovery phrase field")
        }
        for _ in 0..<6 where !phraseField.isHittable {
            app.webViews.firstMatch.swipeDown()
        }
        guard focus(phraseField) else {
            return failImport("Recovery phrase field focus")
        }
        UIPasteboard.general.setItems(
            [["public.utf8-plain-text": phrase]],
            options: [
                .localOnly: true,
                .expirationDate: Date().addingTimeInterval(240),
            ]
        )
        guard pasteViaMenu(into: phraseField, app: app) else {
            return failSensitiveImport("Recovery phrase paste menu", app: app)
        }
        guard waitUntil(timeout: 10, condition: {
            wordCount(phraseField) >= 12
        }) else {
            return failSensitiveImport("Recovery phrase paste", app: app)
        }
        guard dismissKeyboard(app) else {
            return failSensitiveImport("Recovery phrase keyboard dismissal", app: app)
        }

        let submit = exactButton(app, "Import")
        for _ in 0..<8 where !submit.isHittable {
            app.webViews.firstMatch.swipeUp()
        }
        guard submit.exists && submit.isEnabled else {
            return failSensitiveImport("Import submit button", app: app)
        }
        tap(submit)

        let donations = app.staticTexts.matching(
            NSPredicate(format: "label ==[c] %@", "Automatic Donations")
        ).firstMatch
        guard donations.waitForExistence(timeout: 120) else {
            return failSensitiveImport("Automatic Donations notice", app: app)
        }
        UIPasteboard.general.items = []

        let continueButton = exactButton(app, "Continue")
        guard waitUntil(timeout: 20, condition: {
            continueButton.exists && continueButton.isHittable && continueButton.isEnabled
        }) else {
            return failImport("Automatic Donations Continue")
        }
        continueButton.tap()
        settleAfterImport(app)
        guard waitUntil(timeout: 90, condition: {
            exactButton(app, "Send").exists
                || exactButton(app, "Home").exists
                || exactButton(app, "Balances").exists
        }) else {
            return failImport("imported wallet home")
        }
        return true
    }

    private func nameUnreachableStates(_ entries: [DuoFoldPlan.Entry]) {
        for entry in entries {
            guard case let .unreachable(name, reason) = entry else { continue }
            XCTContext.runActivity(named: "UNREACHABLE \(name): \(reason)") { _ in }
        }
    }

    private func drive(
        _ state: (String, Double, Double, DuoFoldPlan.Division),
        app: XCUIApplication
    ) {
        XCUIDevice.shared.orientation = state.1 <= state.2 ? .portrait : .landscapeLeft
        XCTAssertTrue(
            waitUntil(timeout: 15, condition: {
                let frame = app.windows.firstMatch.frame
                return abs(frame.width - state.1) <= 2 && abs(frame.height - state.2) <= 2
            }),
            "\(state.0) did not reach \(state.1)x\(state.2)"
        )
    }

    private func assertHome(
        _ state: (String, Double, Double, DuoFoldPlan.Division),
        app: XCUIApplication
    ) {
        let home = exactButton(app, "Home")
        if home.exists && home.isHittable && home.isEnabled {
            home.tap()
        }
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))

        let divider = app.descendants(matching: .any).matching(
            NSPredicate(format: "label ==[c] %@", "Resize the balances list")
        ).firstMatch
        if state.3.orientation == "vertical" {
            XCTAssertTrue(divider.waitForExistence(timeout: 20))
            XCTAssertTrue(
                DuoFoldPlan.dividerOnFold(
                    dividerX: Double(divider.frame.midX),
                    division: state.3,
                    tolerance: 2
                ),
                "\(state.0) did not place the Home split divider on the fold"
            )
        } else {
            XCTAssertFalse(
                divider.exists,
                "\(state.0) exposed a vertical Home split without a vertical fold"
            )
        }
    }

    private func visibleSendFormValues(
        _ app: XCUIApplication
    ) -> [String: String] {
        let page = app.webViews.firstMatch
        for _ in 0..<12 {
            let values = SendFormNav.fieldValues(app)
            if values["to"] != nil && values["amount"] != nil {
                return values
            }

            if page.exists {
                dragPageDown(page)
            } else {
                app.swipeDown(velocity: .slow)
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        return SendFormNav.fieldValues(app)
    }

    private func recordAfterFoldState(
        _ state: String,
        app: XCUIApplication
    ) {
        let heading = app.staticTexts.matching(
            NSPredicate(format: "label ==[c] %@", "Send")
        ).firstMatch
        let recipient = app.textFields.matching(
            NSPredicate(
                format: "label CONTAINS[c] %@ OR placeholderValue BEGINSWITH[c] %@",
                "address or name",
                "Enter an address"
            )
        ).firstMatch
        let amount = app.textFields.matching(
            NSPredicate(
                format: "label ==[c] %@ OR label BEGINSWITH[c] %@",
                "Amount",
                "Amount ("
            )
        ).firstMatch
        let summary = [
            "heading=\(heading.exists)",
            "recipient.exists=\(recipient.exists)",
            "recipient.placeholder=\(showsPlaceholder(recipient))",
            "amount.exists=\(amount.exists)",
            "amount.placeholder=\(showsPlaceholder(amount))",
        ].joined(separator: ", ")
        XCTContext.runActivity(
            named: "after-fold state \(state): \(summary)"
        ) { _ in }
    }

    private func showsPlaceholder(_ field: XCUIElement) -> Bool {
        guard
            field.exists,
            let placeholder = field.placeholderValue,
            let value = field.value as? String
        else {
            return false
        }
        return value == placeholder
    }

    private func dragPageDown(_ page: XCUIElement) {
        let start = page.coordinate(
            withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)
        )
        let end = page.coordinate(
            withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)
        )
        start.press(forDuration: 0.1, thenDragTo: end)
    }

    private func sendScrollSnapshot(_ app: XCUIApplication) -> CGRect? {
        guard let send = sendAction(app), send.isHittable else { return nil }
        return send.frame
    }

    private func sameScrollPosition(
        _ lhs: CGRect,
        _ rhs: CGRect,
        tolerance: CGFloat = 4
    ) -> Bool {
        abs(lhs.minX - rhs.minX) <= tolerance
            && abs(lhs.minY - rhs.minY) <= tolerance
            && abs(lhs.width - rhs.width) <= tolerance
            && abs(lhs.height - rhs.height) <= tolerance
    }

    private func sameDecimal(_ lhs: String?, _ rhs: String?) -> Bool {
        guard let left = decimal(lhs), let right = decimal(rhs) else { return false }
        return left == right
    }

    private func decimal(_ value: String?) -> Decimal? {
        guard let value else { return nil }
        let pattern = #"[-+]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else {
            return nil
        }
        let range = NSRange(value.startIndex..<value.endIndex, in: value)
        guard
            let match = expression.firstMatch(in: value, range: range),
            let matchRange = Range(match.range, in: value)
        else {
            return nil
        }
        let normalized = value[matchRange].replacingOccurrences(of: ",", with: "")
        return Decimal(
            string: normalized,
            locale: Locale(identifier: "en_US_POSIX")
        )
    }

    private func expandFormSection(_ label: String, app: XCUIApplication) -> Bool {
        let section = sectionHeader(label, app: app)
        guard section.waitForExistence(timeout: 8) else {
            XCTContext.runActivity(named: "Send section not offered: \(label)") { _ in }
            return true
        }
        for _ in 0..<12 where !section.isHittable {
            scrollToward(section, app: app)
        }
        guard section.isHittable && section.isEnabled else {
            XCTFail("The Send form cannot reach the \(label) section")
            return false
        }
        let expanded = (section.value as? String)?.lowercased() == "true"
        if !expanded { section.tap() }
        return true
    }

    // A section header's label is its title plus its Optional tag or summary
    // ("Advanced Optional Default"). The Send mode tabs above the recipient
    // include one labelled exactly "Advanced", and tapping that tab swaps the
    // To and Amount fields for the multi-line recipient text, so a header is
    // never matched by its bare title.
    private func sectionHeader(_ label: String, app: XCUIApplication) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(
                format: "label BEGINSWITH[c] %@ AND NOT (label ==[c] %@)",
                label,
                label
            )
        ).firstMatch
    }

    private func scrollToSendAction(_ app: XCUIApplication) -> Bool {
        for _ in 0..<12 {
            if let send = sendAction(app), send.isHittable && send.isEnabled {
                return true
            }
            if let send = sendAction(app) {
                scrollToward(send, app: app)
            } else {
                app.webViews.firstMatch.swipeUp(velocity: .slow)
            }
        }
        XCTFail("The expanded Send form cannot reach its Send action")
        return false
    }

    private func reachImportChoice(_ app: XCUIApplication) -> Bool {
        for _ in 0..<16 {
            if exactButton(app, "Import Wallet").exists { return true }
            if acceptLicenseIfPresent(app) { continue }
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

    private func fillSecure(
        _ field: XCUIElement,
        value: String,
        app: XCUIApplication
    ) -> Bool {
        guard dismissKeyboard(app), focus(field) else { return false }
        field.typeText(value)
        return dismissKeyboard(app)
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
                if paste.exists && paste.isHittable { return paste }
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

    private func dismissKeyboard(_ app: XCUIApplication) -> Bool {
        if app.keyboards.count == 0 { return true }
        let predicate = NSPredicate(
            format: "label ==[c] 'Done' OR label ==[c] 'Hide keyboard' OR label ==[c] 'Return'"
        )
        for query in [app.toolbars.buttons, app.keyboards.buttons, app.buttons] {
            let dismiss = query.matching(predicate).firstMatch
            if dismiss.exists && dismiss.isHittable {
                dismiss.tap()
                if waitUntil(timeout: 5, condition: { app.keyboards.count == 0 }) {
                    return true
                }
            }
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

    private func failSensitiveImport(
        _ step: String,
        app: XCUIApplication
    ) -> Bool {
        UIPasteboard.general.items = []
        app.terminate()
        return failImport(step)
    }

    private func failImport(_ step: String) -> Bool {
        XCTFail("Wallet import failed at \(step)")
        return false
    }

    private func failWalletPreparation(_ step: String) -> Bool {
        XCTFail("Wallet preparation failed at \(step)")
        return false
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

    private func confirmButton(
        _ app: XCUIApplication,
        identifier: String,
        label: String
    ) -> XCUIElement {
        app.buttons.matching(
            NSPredicate(
                format: "identifier == %@ OR label ==[c] %@",
                identifier,
                label
            )
        ).firstMatch
    }

    private func waitForConfirmSettle(_ approve: XCUIElement) -> Bool {
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
        return waitUntil(timeout: 2.2) {
            approve.exists && approve.isEnabled && approve.isHittable
        }
    }

    private func sendAction(_ app: XCUIApplication) -> XCUIElement? {
        let webView = app.webViews.firstMatch
        guard webView.exists else { return nil }
        let candidates = webView.buttons.matching(
            NSPredicate(format: "label ==[c] %@", "Send")
        ).allElementsBoundByIndex.filter { $0.exists }
        return candidates.max { lhs, rhs in
            lhs.frame.width < rhs.frame.width
        }
    }

    private func settleAfterFold(_ app: XCUIApplication) {
        _ = app.webViews.firstMatch.waitForExistence(timeout: 15)
        RunLoop.current.run(until: Date().addingTimeInterval(0.8))
    }

    private func scrollToward(_ element: XCUIElement, app: XCUIApplication) {
        guard element.exists else { return }
        let page = app.webViews.firstMatch
        let window = app.windows.firstMatch
        if window.exists && element.frame.midY < window.frame.midY {
            if page.exists { page.swipeDown() } else { app.swipeDown() }
        } else {
            if page.exists { page.swipeUp() } else { app.swipeUp() }
        }
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
}
