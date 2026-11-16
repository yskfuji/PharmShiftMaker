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

## 4. 公開時の確認

1. 公開に当たっては、ロックファイルと、インストール済みの配布物のメタデータとを照合します。
2. SBOM 又はライセンスの検査で未確認の項目が残る場合は、その版を公開に合格したものとして扱いません。
