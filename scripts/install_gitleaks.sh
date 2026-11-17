#!/usr/bin/env bash
set -euo pipefail

VERSION=8.30.1
DESTINATION=${1:-/tmp/pharmshift-gitleaks}
ARCH=$(uname -m)
OS=$(uname -s)
case "${OS}:${ARCH}" in
  Linux:x86_64|Linux:amd64)
    ARCHIVE="gitleaks_${VERSION}_linux_x64.tar.gz"
    EXPECTED="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    ;;
  Linux:arm64|Linux:aarch64)
    ARCHIVE="gitleaks_${VERSION}_linux_arm64.tar.gz"
    EXPECTED="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
    ;;
  Darwin:x86_64|Darwin:amd64)
    ARCHIVE="gitleaks_${VERSION}_darwin_x64.tar.gz"
    EXPECTED="dfe101ff38cc6684a183729bc6b05937b28d9fb0932dd293818a5ff43cd2a1c0"
    ;;
  Darwin:arm64|Darwin:aarch64)
    ARCHIVE="gitleaks_${VERSION}_darwin_arm64.tar.gz"
    EXPECTED="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
    ;;
  *)
    echo "Unsupported platform: ${OS}/${ARCH}" >&2
    exit 2
    ;;
esac

mkdir -p "${DESTINATION}"
TMP_ARCHIVE=$(mktemp "${TMPDIR:-/tmp}/gitleaks.XXXXXX.tar.gz")
trap 'rm -f "${TMP_ARCHIVE}"' EXIT
curl --fail --silent --show-error --location \
  "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${ARCHIVE}" \
  --output "${TMP_ARCHIVE}"
ACTUAL=$(shasum -a 256 "${TMP_ARCHIVE}" | awk '{print $1}')
if [[ "${ACTUAL}" != "${EXPECTED}" ]]; then
  echo "Checksum mismatch for ${ARCHIVE}" >&2
  exit 1
fi
tar -xzf "${TMP_ARCHIVE}" -C "${DESTINATION}" gitleaks
"${DESTINATION}/gitleaks" version
