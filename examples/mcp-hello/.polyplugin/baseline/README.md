# Hello MCP

Returns a deterministic greeting over MCP stdio.

This project was generated from the PolyPlugin Forge MCP template. It exposes
one real newline-delimited JSON-RPC tool named `hello` over standard input and
standard output.

## Run

```sh
npm ci --offline
npm run build
npm test
node dist/server.js
```

Send one JSON-RPC request per line:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"hello","arguments":{"name":"Ada"}}}
```

The server returns:

```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Hello, Ada!"}],"isError":false}}
```

The package name is `hello-mcp` and the stable plugin identifier is
`hello.mcp`.

## Privacy

The server reads requests only from stdio. It does not persist input, send
network requests, or collect telemetry. See `docs/PRIVACY.md`.

## Test coverage

The subprocess tests exercise initialization, tool discovery, a successful
tool call, malformed JSON, an unknown method, an unknown tool, and invalid
input.
