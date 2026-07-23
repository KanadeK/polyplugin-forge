# Privacy

Hello Webhook processes the `name` sent to `POST /hello` only in memory and
returns it in a JSON greeting.

- No request body is persisted.
- No outbound network request is made.
- No telemetry is collected.
- The generated server listens only on `127.0.0.1`.

This template has no authentication. Keep `hello-webhook` behind the local
loopback boundary or add an appropriate authentication layer before deployment
to a shared network.
