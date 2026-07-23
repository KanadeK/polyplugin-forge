#
Hello Webhook

Serves a deterministic loopback POST greeting.

This project was generated from the PolyPlugin Forge webhook template. It runs a
real dependency-free HTTP server bound to `127.0.0.1` and implements `POST
/hello`. ## Run ```sh npm ci --offline npm run build npm test node
dist/server.js ``` Set `PORT=0` to let the operating system choose a free port.
The server reports the selected loopback URL on stderr. Request: ```sh curl -X
POST http://127.0.0.1:3000/hello \ -H "content-type: application/json" \ -d
'{"name":"Ada"}' ``` Response: ```json {"message":"Hello, Ada!"} ``` The package
name is `hello-webhook` and the stable plugin identifier is `hello.webhook`. ##
Security and privacy The server binds only to loopback, accepts JSON bodies up
to 16 KiB, does not persist requests, and emits no telemetry. It intentionally
ships without authentication and must not be exposed directly to an external
network. See `docs/PRIVACY.md`.