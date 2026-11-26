# デスクトップ版に同梱する実行環境の許諾文

このフォルダーには、デスクトップ版に同梱する PostgreSQL と Python の実行環境、及びそれらに含まれるライブラリの許諾文を収めています。配布物では、`runtime/licenses/` に、その OS に同梱するものだけを置きます。

## 1. 収めているもの

| フォルダー | 内容 |
|---|---|
| `postgresql/` | PostgreSQL と、EDB の PostgreSQL の配布物に含まれるライブラリ（OpenSSL、ICU、libxml2、libxslt、zlib、LZ4、Zstandard、MIT Kerberos、libedit、GNU libiconv、GNU gettext の libintl、mingw-w64 の winpthreads）の許諾文 |
| `python-build-standalone/` | python-build-standalone（CPython 3.12.15）と、これに組み込まれたライブラリの許諾文。python-build-standalone の full 配布物に含まれるものを、そのまま収めています。 |
| `manifest.json` | 各ファイルの部品名、版、許諾の種類、対象の OS、取得元、SHA-256 |

1. 配布物には、このほかに次のものを置きます。
   - `runtime/licenses/dependencies/`：Python と npm の依存の許諾文（`docs/release/THIRD_PARTY_LICENSES` の写し）
   - `runtime/licenses/node/LICENSE`：Node.js の許諾文（Node.js の配布物に含まれるもの）
   - Electron と Chromium の許諾文（`LICENSE.electron.txt` と `LICENSES.chromium.html`。electron-builder が配布物に置きます）
2. EDB の PostgreSQL の配布物には、許諾文が含まれていません。そのため、各ライブラリの版を配布物のバイナリから確かめ、その版の許諾文を開発元の公開リポジトリから取得しました。取得元は `manifest.json` に記録しています。版を確かめられなかったもの（libedit、GNU libiconv、GNU gettext、winpthreads）は、その旨を記録しています。

## 2. GNU LGPL のライブラリ

1. GNU libiconv と、GNU gettext の libintl（Windows 版だけ）は、GNU Lesser General Public License 2.1 以降の条件で配布されています。PostgreSQL は、これらを動的リンクで利用しています。利用者は、同梱のライブラリ（`runtime/pg/lib/libiconv.2.dylib`、`runtime\pg\bin\libiconv-2.dll`、`runtime\pg\bin\libintl-9.dll`）を、互換性のある版に置き換えることができます。
2. これらのソースコードは、開発元（https://www.gnu.org/software/libiconv/ 、https://www.gnu.org/software/gettext/ ）から入手できます。PostgreSQL のソースコードは https://www.postgresql.org/ftp/source/ から入手できます。

## 3. Windows 版の Visual C++ 実行時ライブラリ

1. Windows 版には、Microsoft Visual C++ の実行時ライブラリ（`msvcp140*.dll`、`vcruntime140*.dll`）を、PostgreSQL と Python のフォルダーに同梱しています。これらは Microsoft の著作物であり、Visual Studio の使用許諾条件の「再頒布可能なコード」として配布しています。
2. 配布物の組み立てでは、Microsoft の有効な署名があるものだけを同梱します。

## 4. 更新の手順

1. 同梱する PostgreSQL、python-build-standalone の版を変えたときは、対応する許諾文を差し替え、`manifest.json` の版と SHA-256 を更新します。
2. `tests/test_desktop_licenses.py` は、`manifest.json` とファイルの対応、SHA-256、両 OS の必須の部品がそろっていることを確かめます。組み立て処理（`desktop/scripts/copy_licenses.py`）も、写すときに SHA-256 を照合します。
