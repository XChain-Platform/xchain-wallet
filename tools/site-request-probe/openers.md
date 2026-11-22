# Site request probe openers

This harness records browser return, phone launch, custom-scheme, and fragment redirect behavior. Serve `index.html` over HTTPS from each test origin. Keep it unlinked, use synthetic fragment values, and give related tabs the same probe session.

The page log captures the full URL, fragment, `document.referrer`, opener presence, navigation type, visibility changes, and `BroadcastChannel` traffic. Copy its JSON log immediately after each run. A missing channel message is evidence, especially when the return lands in a different browser.

## Browser procedure

Record the operating system, browser and version, default browser, installed-app state, source origin, control used, landing browser, tab reuse, opener presence, `window.close()` result, referrer, fragment, and whether the original tab received the broadcast.

For browser returns:

1. Open the probe and leave the original tab visible, then repeat with it in the background.
2. Use each HTTPS anchor and scripted launch control.
3. In the landing page, broadcast a snapshot and call `window.close()`.
4. Repeat with the clicked browser set and not set as the system default.
5. For mobile native returns, compare the landing browser and referrer with the browser that opened the app.

For phone launches, repeat from every required origin and from in-app browser contexts. Compare the plain anchor with `location.assign()`, `window.open()` in the click tick, the microtask `await`, and the timer. On Samsung Internet, put the complete `intent://` value in the custom-scheme field as a separate run.

For custom schemes, run the anchor and both scripted controls with the desktop app installed and uninstalled. Record browser prompts, error pages, silent failures, and whether the current page loses focus. Do not use a real request payload.

For fragment redirects, use a synthetic marker only. The HTTP endpoint entered in the probe must return a 302 whose `Location` value has no fragment and must not cache the response. Its destination must log `location.hash` in page script because fragments are not sent in HTTP requests. Test both same-origin and cross-origin destinations. For the script case, open the script redirect source, confirm its marker is visible in the Environment section, then use both `location.assign()` and `location.replace()` with a destination that has no fragment. Record the final address and destination log.

## Electron stub

Keep the renderer isolated and expose one narrow test action from preload to main. The main-process handler should pass the exact operator-entered probe URL to Electron's external opener:

```js
ipcMain.handle('probe:open-external', async (_event, url) => {
  await shell.openExternal(url);
  return { opened: true };
});
```

Run once with the clicked browser as default and once with a different default. Capture which browser receives the URL, whether an existing tab is reused, whether the fragment survives, and whether that page reaches the original tab's channel.

## Android stub

Launch the exact probe URL with an `ACTION_VIEW` intent and the browsable category. Do not select a package in the baseline run:

```java
Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
intent.addCategory(Intent.CATEGORY_BROWSABLE);
startActivity(intent);
```

At the receiving activity, record `getReferrer()`, the intent data, cold or warm start, and the chosen browser package. Repeat with Chrome, Samsung Internet, the default browser changed, and no matching app installed. Treat an empty referrer as a result, not as a harness failure.

For an app-directed return experiment, constrain a second run only after the generic baseline. Resolve the intended browser activity first and record when resolution fails or selects a chooser.

## iOS stub

Open the exact probe URL through the application API and record the completion value:

```swift
UIApplication.shared.open(url, options: [:]) { opened in
    logger("probe return opened: \(opened)")
}
```

Run the generic HTTPS open first. Then repeat with any proposed browser-specific URL conversion for Chrome, Firefox, or Edge, recording conversion input, completion value, landing browser, tab reuse, and fragment. A browser hint is routing information only and must not be treated as identity.

For Universal Link launch tests, invoke the HTTPS link from a real user tap. Record same-domain and cross-domain behavior separately and repeat from Safari, Chrome, and each required in-app browser.

## Result hygiene

Use one session value per matrix cell and keep the original page open until the landing behavior is recorded. Save browser console errors with the JSON log. Never paste a wallet signature, nonce, claim, account, callback body, or production request into this harness.
