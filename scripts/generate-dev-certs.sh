#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)
CERT_DIR="${REPO_ROOT}/certs"
CERT_PATH="${CERT_DIR}/localhost-cert.pem"
KEY_PATH="${CERT_DIR}/localhost-key.pem"
CA_PATH="${CERT_DIR}/dev-rootCA.pem"

mkdir -p "${CERT_DIR}"

SAN_HOSTS=(localhost 127.0.0.1 ::1 backend pharmshift-backend frontend pharmshift-frontend)

if command -v mkcert >/dev/null 2>&1; then
  echo "[certs] mkcert detected. Installing local CA (if needed) and issuing certificate..."
  mkcert -install >/dev/null 2>&1 || true
  mkcert -cert-file "${CERT_PATH}" -key-file "${KEY_PATH}" "${SAN_HOSTS[@]}"
  CAROOT=$(mkcert -CAROOT)
  cp "${CAROOT}/rootCA.pem" "${CA_PATH}"
else
  echo "[certs] mkcert not found. Falling back to openssl self-signed certificate."
  echo "[certs] Consider \"brew install mkcert nss\" for a trusted developer CA."
  openssl req \
    -x509 \
    -nodes \
    -days 825 \
    -newkey rsa:2048 \
    -keyout "${KEY_PATH}" \
    -out "${CERT_PATH}" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,DNS:backend,DNS:pharmshift-backend,DNS:frontend,DNS:pharmshift-frontend,IP:127.0.0.1" >/dev/null 2>&1
  cp "${CERT_PATH}" "${CA_PATH}"
fi

chmod 600 "${KEY_PATH}"
chmod 644 "${CERT_PATH}"
chmod 644 "${CA_PATH}"

echo "[certs] Generated dev certificate and CA:" && ls -l "${CERT_PATH}" "${KEY_PATH}" "${CA_PATH}"
