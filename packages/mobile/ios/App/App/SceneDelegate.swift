// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Two jobs, and the Capacitor template gets the first one wrong for a wallet.
//
// ROOT VIEW CONTROLLER. The template builds the window here and hands it a
// plain `CAPBridgeViewController`, so the STORYBOARD's class is not what runs:
// this code path wins. Pointing the storyboard at MainViewController and
// stopping there produced an app that looked correctly wired and never
// registered the vault plugin - and by  that failure is silent, ending
// with the wallet quietly storing itself in WebView storage. The storyboard and
// this line have to agree, and the smoke asserts both.
//
// APP-SWITCHER SNAPSHOTS. iOS photographs the UI when the app backgrounds and
// keeps that image on disk to animate the switcher. Whatever is on screen at
// that moment is in the picture, including a seed phrase or an unlocked balance
// list. The cover goes up on resignActive, which fires BEFORE the snapshot is
// taken and also covers the control-centre swipe and an incoming call, and
// comes down on becomeActive.
//
// The cover is a plain opaque view, not a blur of what is behind it: a blurred
// seed screen is still a picture of the seed screen.

import Capacitor
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    /// Hides the UI from the app-switcher snapshot.
    private var privacyCover: UIView?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // MainViewController, never the base class: this is the only place the
        // vault plugin is registered (see the file comment).
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        // THE LAUNCHING TAP ARRIVES HERE AND NOWHERE ELSE. A link that starts
        // the app delivers its activity and its URL contexts in
        // `connectionOptions`; `scene(_:continue:)` and
        // `scene(_:openURLContexts:)` below are never called for it. Handling
        // only those two - which is what this file did until XChainLinks
        // existed - drops exactly the tap that matters most.
        //
        // Order is deliberate: the proxy call above lets Capacitor build the
        // bridge (and with it the plugin instance) before anything is offered,
        // so the common case takes the queue path with a live plugin rather
        // than a nil one. The inbox is a file-static and tolerates either.
        for activity in connectionOptions.userActivities
        where activity.activityType == NSUserActivityTypeBrowsingWeb {
            XChainLinkInbox.shared.deliver(activity.webpageURL?.absoluteString)
        }
        for context in connectionOptions.urlContexts {
            XChainLinkInbox.shared.deliver(context.url.absoluteString)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Custom-scheme delivery. `xchain:` payloads are untrusted input and are
        // validated in the SPA before anything acts on them ( §4); this
        // hands them over, it does not vouch for them.
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)

        for context in URLContexts {
            XChainLinkInbox.shared.deliver(context.url.absoluteString)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        // Universal Links, domain-attested by the association file .
        // Still validated in the SPA, on exactly the same footing.
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)

        // The proxy's own delivery target is `@capacitor/app`'s `appUrlOpen`,
        // which is not a dependency here (see XChainLinksPlugin.swift), so
        // forwarding to it alone reached nothing. This is the line that makes
        // the tap arrive somewhere.
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb else { return }
        XChainLinkInbox.shared.deliver(userActivity.webpageURL?.absoluteString)
    }

    // MARK: - Snapshot cover

    func sceneWillResignActive(_ scene: UIScene) {
        guard let window = window, privacyCover == nil else { return }
        let cover = UIView(frame: window.bounds)
        cover.backgroundColor = UIColor(red: 0.05, green: 0.07, blue: 0.12, alpha: 1.0)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]

        let mark = UILabel()
        mark.text = "XChain Wallet"
        mark.textColor = UIColor.white.withAlphaComponent(0.65)
        mark.font = .systemFont(ofSize: 17, weight: .medium)
        mark.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(mark)
        NSLayoutConstraint.activate([
            mark.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: cover.centerYAnchor)
        ])

        window.addSubview(cover)
        privacyCover = cover
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyCover?.removeFromSuperview()
        privacyCover = nil
    }
}
