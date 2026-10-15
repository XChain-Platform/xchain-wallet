// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import Capacitor
import UIKit

@objc(XChainAppPlugin)
public class XChainAppPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "XChainAppPlugin"
    public let jsName = "App"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)
    ]

    /// Open the system share sheet with public wallet request text and URL.
    @objc func share(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let text = call.getString("text") ?? ""
        let urlText = call.getString("url") ?? ""

        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("No view controller is available.")
                return
            }

            var items: [Any] = []
            if !text.isEmpty { items.append(text) }
            if let url = URL(string: urlText), !urlText.isEmpty {
                items.append(url)
            } else if !urlText.isEmpty {
                items.append(urlText)
            }
            guard !items.isEmpty else {
                call.reject("Nothing is available to share.")
                return
            }

            let sheet = UIActivityViewController(
                activityItems: items,
                applicationActivities: nil
            )
            sheet.title = title
            self.setCenteredPopover(sheet)
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                call.resolve(["completed": completed])
            }
            presenter.present(sheet, animated: true)
        }
    }
}
