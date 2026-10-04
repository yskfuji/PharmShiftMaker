# Local TLS certificates

This directory stores development-only TLS artifacts shared by the FastAPI backend and the Next.js frontend.

## Generating certificates

Run the helper script from the repository root:

```bash
./scripts/generate-dev-certs.sh
```

The script prefers [`mkcert`](https://github.com/FiloSottile/mkcert) (to issue a certificate trusted by your OS) and automatically falls back to `openssl` when `mkcert` is unavailable. SANs cover `localhost`, `backend`, `pharmshift-backend`, `frontend`, `pharmshift-frontend`, `127.0.0.1`, and `::1` so that HTTPS also works inside Docker Compose. Certificates are created as:

- `certs/localhost-cert.pem`
- `certs/localhost-key.pem`
- `certs/dev-rootCA.pem` (mkcert root CA or a copy of the self-signed cert, suitable for Node.js trust stores)

All files are git-ignored so feel free to regenerate them whenever needed.

## Trusting the certificate

- When using `mkcert`, trust is handled automatically because the tool installs a local CA and the script copies it to `certs/dev-rootCA.pem`.
- When using the `openssl` fallback, import the generated certificate into your OS/browser trust store manually so that browsers and Node.js accept the HTTPS endpoints without warnings (the CA copy still lives at `certs/dev-rootCA.pem`).
- Set `NODE_EXTRA_CA_CERTS` or `NEXT_SSL_CA_PATH` to `certs/dev-rootCA.pem` so that server-side fetches also trust the backend.

## Usage

Both development servers pick up the cert/key pair automatically via the following environment variables:

- `UVICORN_SSL_CERTFILE` / `UVICORN_SSL_KEYFILE`
- `NEXT_SSL_CERT_PATH` / `NEXT_SSL_KEY_PATH`
- `NODE_EXTRA_CA_CERTS` / `NEXT_SSL_CA_PATH`

See the root `README.md` for the full HTTPS setup instructions.
