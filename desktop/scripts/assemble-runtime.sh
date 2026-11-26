#!/usr/bin/env bash
# Assemble the bundled runtime (PostgreSQL, Python + dependencies + product code,
# Node.js, the web build) into desktop/build/runtime. Every download is checked
# against a pinned SHA-256. Usage (from the repository root):
#   bash desktop/scripts/assemble-runtime.sh [CACHE_DIR]
# Runs on macOS arm64 and on Windows x64 (Git Bash).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/desktop/build/runtime"
CACHE=${1:-"$ROOT/desktop/build/cache"}

PG_VERSION=16.13-1
PG_SHA_MAC=7093511e7ed758b233e79936eaa63cbb2ca8ad12aeeb994ae271e421f0e590a0
PG_SHA_WIN=9b4c7a1bc31147b5b2ba59178d0eef86c16181d54a20177192b387dff20f00a9
PBS_TAG=20261021
PY_VERSION=3.12.15
PY_SHA_MAC=a18cc33862b53bd54a148c710def5375c1b47470cccedf817a19c2d211764584
PY_SHA_WIN=be7f14464d1d66f84429ad27e01f6d1482963afff64a2fb5256b2a51c7b5d398
NODE_VERSION=26.12.1
NODE_SHA_MAC=1901d539912c02afa10d1cc126943a8855a7eedebe830119463470db5e6c59e8
NODE_SHA_WIN=b3efd5c70cba3308ed46e7e699a9b8aac075bbc6b027fcb39c84c31acc25e2b4

WEB_ORIGIN=https://127.0.0.1:18513
API_URL=https://127.0.0.1:18510

case "$(uname -s)" in
  Darwin) KIND=mac ;;
  MINGW*|MSYS*|CYGWIN*) KIND=win ;;
  *) echo "unsupported build host: $(uname -s)" >&2; exit 1 ;;
esac
[ "$KIND" = mac ] && [ "$(uname -m)" != arm64 ] && { echo "macOS builds require arm64" >&2; exit 1; }

sha256() { (sha256sum "$1" 2>/dev/null || shasum -a 256 "$1") | awk '{print $1}'; }

fetch() { # url file expected_sha
  local url=$1 file="$CACHE/$2" expected=$3
  mkdir -p "$CACHE"
  if [ ! -f "$file" ] || [ "$(sha256 "$file")" != "$expected" ]; then
    curl -sSfL --retry 3 -o "$file.part" "$url"
    mv "$file.part" "$file"
  fi
  local actual; actual=$(sha256 "$file")
  [ "$actual" = "$expected" ] || { echo "checksum mismatch for $2: $actual" >&2; exit 1; }
}

rm -rf "$OUT" && mkdir -p "$OUT"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# --- PostgreSQL (EDB binaries; extract all, then drop what the app does not ship)
if [ "$KIND" = mac ]; then pg_zip="postgresql-$PG_VERSION-osx-binaries.zip"; pg_sha=$PG_SHA_MAC
else pg_zip="postgresql-$PG_VERSION-windows-x64-binaries.zip"; pg_sha=$PG_SHA_WIN; fi
fetch "https://get.enterprisedb.com/postgresql/$pg_zip" "$pg_zip" "$pg_sha"
unzip -q "$CACHE/$pg_zip" -d "$WORK/pg"
rm -rf "$WORK/pg/pgsql/pgAdmin 4" "$WORK/pg/pgsql/pgAdmin 4.app" "$WORK/pg/pgsql/stackbuilder" \
  "$WORK/pg/pgsql/StackBuilder" "$WORK/pg/pgsql/doc" "$WORK/pg/pgsql/include" "$WORK/pg/pgsql/symbols"
test -n "$(find "$WORK/pg/pgsql/share" -type d -name timezonesets | head -1)"
if [ "$KIND" = win ]; then
  # Not loaded by the server, initdb, pg_ctl, the client tools or any module
  # (checked with the import tables): StackBuilder's wxWidgets, libcurl, ICU
  # I/O and tools, and test programs.
  (cd "$WORK/pg/pgsql/bin" && rm -f stackbuilder.exe wx*.dll testplug.dll libcurl.dll libcurl.lib \
    icuio*.dll icutu*.dll isolationtester.exe pg_isolation_regress.exe pg_regress.exe \
    pg_regress_ecpg.exe libpq_pipeline.exe libpq_testclient.exe libpq_uri_regress.exe test_cloexec.exe)
fi
if [ "$KIND" = mac ]; then
  # Not loaded by any shipped program or module (checked with otool -L).
  rm -f "$WORK/pg/pgsql/lib"/libintl*.dylib "$WORK/pg/pgsql/lib"/libuuid*.dylib
fi
mv "$WORK/pg/pgsql" "$OUT/pg"

# --- Python (python-build-standalone) + locked dependencies + product code
if [ "$KIND" = mac ]; then triple=aarch64-apple-darwin; py_sha=$PY_SHA_MAC
else triple=x86_64-pc-windows-msvc; py_sha=$PY_SHA_WIN; fi
py_tar="cpython-$PY_VERSION+$PBS_TAG-$triple-install_only.tar.gz"
fetch "https://github.com/astral-sh/python-build-standalone/releases/download/$PBS_TAG/${py_tar/+/%2B}" "$py_tar" "$py_sha"
tar -xzf "$CACHE/$py_tar" -C "$OUT"
if [ "$KIND" = mac ]; then PY="$OUT/python/bin/python3"; SITE="$OUT/python/lib/python3.12/site-packages"
else PY="$OUT/python/python.exe"; SITE="$OUT/python/Lib/site-packages"; fi
pip_install=("$PY" -I -m pip install --disable-pip-version-check --no-input --only-binary=:all: --no-compile)
if [ "$KIND" = mac ]; then
  "${pip_install[@]}" --require-hashes -r "$ROOT/requirements.lock"
else
  # Same versions as requirements.lock, without uvloop (POSIX only) and with
  # colorama (Windows only); tests/test_windows_lock.py keeps the two in step.
  "${pip_install[@]}" --require-hashes -r "$ROOT/desktop/requirements-windows.lock"
fi
if [ "$KIND" = win ]; then
  # PostgreSQL and OR-Tools import MSVCP140.dll / VCRUNTIME140*.dll, which a PC
  # without the Visual C++ Redistributable lacks. Deploy them app-locally (next to
  # postgres.exe and python.exe, which Windows searches first), taken from the
  # build machine's Visual Studio and accepted only with a valid Microsoft signature.
  vs=$("/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe" -latest -products '*' -property installationPath | tr -d '\r')
  crt=$(ls -d "$(cygpath -u "$vs")"/VC/Redist/MSVC/*/x64/Microsoft.VC14*.CRT | sort -V | tail -1)
  for dll in msvcp140.dll msvcp140_1.dll msvcp140_2.dll vcruntime140.dll vcruntime140_1.dll; do
    powershell.exe -NoProfile -Command "\$s = Get-AuthenticodeSignature -LiteralPath '$(cygpath -w "$crt/$dll")'; if (\$s.Status -ne 'Valid' -or \$s.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { exit 1 }" \
      || { echo "untrusted $dll in $crt" >&2; exit 1; }
    cp "$crt/$dll" "$OUT/pg/bin/$dll"
    cp "$crt/$dll" "$OUT/python/$dll"
  done
  echo "vc runtime from $crt"
fi
cp -R "$ROOT/src/shift_scheduler" "$SITE/shift_scheduler"
find "$SITE/shift_scheduler" -name __pycache__ -type d -prune -exec rm -rf {} +
"$PY" -I -c "import shift_scheduler.desktop.launcher, uvicorn, alembic, psycopg, ortools; print('python ok')"

# --- Node.js (only the executable and its license)
if [ "$KIND" = mac ]; then
  node_pkg="node-v$NODE_VERSION-darwin-arm64.tar.gz"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/$node_pkg" "$node_pkg" "$NODE_SHA_MAC"
  tar -xzf "$CACHE/$node_pkg" -C "$WORK"
  mkdir -p "$OUT/node/bin"
  cp "$WORK/node-v$NODE_VERSION-darwin-arm64/bin/node" "$OUT/node/bin/node"
  cp "$WORK/node-v$NODE_VERSION-darwin-arm64/LICENSE" "$OUT/node/LICENSE"
else
  node_pkg="node-v$NODE_VERSION-win-x64.zip"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/$node_pkg" "$node_pkg" "$NODE_SHA_WIN"
  unzip -q "$CACHE/$node_pkg" -d "$WORK"
  mkdir -p "$OUT/node"
  cp "$WORK/node-v$NODE_VERSION-win-x64/node.exe" "$OUT/node/node.exe"
  cp "$WORK/node-v$NODE_VERSION-win-x64/LICENSE" "$OUT/node/LICENSE"
fi

# --- Application files used outside the package (migrations, control authority)
mkdir -p "$OUT/app/scripts"
cp -R "$ROOT/alembic" "$OUT/app/alembic"
cp "$ROOT/alembic.ini" "$OUT/app/alembic.ini"
cp "$ROOT/scripts/control_authority.py" "$OUT/app/scripts/control_authority.py"
find "$OUT/app" -name __pycache__ -type d -prune -exec rm -rf {} +

# --- Web (Next.js standalone, fixed origin baked at build time)
(
  cd "$ROOT/frontend"
  [ -d node_modules ] || npm ci --no-audit --no-fund
  NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_BASE_URL="$WEB_ORIGIN/api" INTERNAL_API_BASE_URL="$API_URL" \
    NEXT_PUBLIC_AUTH_STRATEGY=local npm run build
)
cp -R "$ROOT/frontend/.next/standalone" "$OUT/web"
cp -R "$ROOT/frontend/.next/static" "$OUT/web/.next/static"
cp -R "$ROOT/frontend/public" "$OUT/web/public"
cp "$ROOT/desktop/web/desktop-server.cjs" "$OUT/web/desktop-server.cjs"

# --- License texts of everything bundled (checked against desktop/licenses/manifest.json)
if [ "$KIND" = mac ]; then platform=macos; else platform=windows; fi
"$PY" -I -B "$ROOT/desktop/scripts/copy_licenses.py" "$ROOT" "$platform" "$OUT"

du -sh "$OUT"/* | sed 's/^/size /'
