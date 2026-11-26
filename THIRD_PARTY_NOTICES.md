# 第三者ソフトウェアに関する表示

本書は、PharmShiftMaker が利用する第三者のソフトウェアと、その許諾条件の参照先を示すものです。

## 1. 基本的な考え方

PharmShiftMaker は、第三者のオープンソース・ソフトウェアを利用しています。各ソフトウェアの著作権及び許諾条件については、それぞれの配布物に含まれるライセンス本文が優先します。

## 2. 主な直接依存関係

| 用途 | 主なソフトウェア | ライセンス |
|---|---|---|
| Web アプリケーション | Next.js、React、Radix UI、clsx、tailwind-merge、Undici | MIT |
| UI 部品 | Lucide | ISC |
| UI 部品 | class-variance-authority | Apache-2.0 |
| 日本語書体 | Noto Sans JP（Fontsource の配布物） | SIL Open Font License 1.1 |
| API・型検証 | FastAPI、Pydantic、PyJWT、SQLAlchemy、Alembic、PyYAML | MIT |
| API の実行・通信 | Uvicorn、HTTPX | BSD-3-Clause |
| 最適化 | Google OR-Tools | Apache-2.0 |
| PostgreSQL への接続 | Psycopg | LGPL-3.0-only |
| ファイルの受信 | python-multipart | Apache-2.0 |
| ブラウザのテスト | Playwright | Apache-2.0 |
| アクセシビリティのテスト | axe-core の Playwright 連携 | MPL-2.0 |
| UI カタログ | Storybook | MIT |
| デザイントークン | デジタル庁デザインシステム | MIT |
| 推移的なビルド・テストの依存 | 各ロックファイルに記録された構成品 | MIT、ISC、Apache-2.0、BSD-2-Clause、BSD-3-Clause、MPL-2.0、LGPL-3.0-or-later、BlueOak-1.0.0、CC0-1.0、CC-BY-4.0、0BSD、MIT-0、Python-2.0 等 |

> **注記** この表は読みやすさのための要約であり、推移的な依存関係を含む完全な一覧ではありません。

## 3. 完全な一覧の参照先

1. 固定された依存関係は、`requirements.lock` 及び `frontend/package-lock.json` に記録しています。
2. 機械可読な一覧は、[CycloneDX SBOM](docs/release/SBOM.cdx.json) とします。
3. 同梱した許諾文と表示の対応は、[第三者ライセンスのマニフェスト](docs/release/THIRD_PARTY_LICENSES/manifest.json)に記録しています。

## 4. デスクトップ版に同梱するソフトウェア

デスクトップ版の配布物には、2章の依存関係に加えて、次のソフトウェアを同梱します。許諾文は、配布物の `runtime/licenses/` に収めています。一覧と取得元は [desktop/licenses/README.md](desktop/licenses/README.md) に記載しています。

| ソフトウェア | 版 | ライセンス |
|---|---|---|
| Electron（Chromium を含みます） | 45.2.3 | MIT（Chromium は `LICENSES.chromium.html` に記載の各ライセンス） |
| Node.js | 26.12.1 | MIT（同梱する部品は Node.js の `LICENSE` に記載） |
| CPython（python-build-standalone） | 3.12.15 | Python-2.0（組み込まれたライブラリは各許諾文に記載） |
| PostgreSQL（EDB の配布物） | 16.13 | PostgreSQL |
| OpenSSL | 3.0.19 | Apache-2.0 |
| ICU | 68.2（macOS）、67（Windows） | Unicode-DFS-2016、ICU |
| libxml2、libxslt | 2.15.1、1.1.45 | MIT |
| zlib、LZ4、Zstandard | 1.3.2、1.10.0、1.5.7 | Zlib、BSD-2-Clause、BSD-3-Clause |
| MIT Kerberos（macOS） | 1.22.2 | MIT Kerberos の表示 |
| libedit（macOS） | — | BSD-3-Clause |
| GNU libiconv、GNU gettext の libintl（Windows） | — | LGPL-2.1-or-later |
| mingw-w64 winpthreads（Windows） | — | MIT、BSD-3-Clause |
| Microsoft Visual C++ 実行時ライブラリ（Windows） | ビルド機の Visual Studio のもの | Visual Studio の使用許諾条件（再頒布可能なコード） |

> **注記** 「—」は、配布物のバイナリから版を確かめられなかったものです。

## 5. 公開時の確認

1. 公開に当たっては、ロックファイルと、インストール済みの配布物のメタデータとを照合します。
2. SBOM 又はライセンスの検査で未確認の項目が残る場合は、その版を公開に合格したものとして扱いません。
