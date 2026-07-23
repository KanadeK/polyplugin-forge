# Privacy notice for
Hello Chrome

Greets a user from an accessible Manifest V3 popup.

The `hello.chrome` Chrome extension operates locally: - It does not send network
requests. - It does not collect telemetry, analytics, credentials, or personal
profiles. - It stores only the most recently entered greeting name in
`chrome.storage.local`. - Chrome keeps that value inside the extension's local
storage until the user clears extension data or removes the extension. The value
is used only to restore greeting state. It is never placed in HTML; the popup
renders results with `textContent`. Package identity: `hello-chrome`.