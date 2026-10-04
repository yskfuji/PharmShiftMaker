# 第三者ソフトウェアに関する表示

PharmShiftMakerは、第三者のオープンソースソフトウェアを利用する。各ソフトウェアの著作権及び許諾条件については、各配布物に含まれるライセンス本文が優先する。

主な直接依存関係は次のとおりである。

| 用途 | 主なソフトウェア | ライセンス |
|---|---|---|
| Webアプリケーション | Next.js、React、Radix UI、clsx、tailwind-merge、Undici | MIT |
| UI部品 | Lucide | ISC |
| UI部品 | class-variance-authority | Apache-2.0 |
| 日本語書体 | Noto Sans JP（Fontsource配布物） | SIL Open Font License 1.1 |
| API・型検証 | FastAPI、Pydantic、PyJWT、SQLAlchemy、Alembic、PyYAML | MIT |
| API実行・通信 | Uvicorn、HTTPX | BSD-3-Clause |
| 最適化 | Google OR-Tools | Apache-2.0 |
| PostgreSQL接続 | Psycopg | LGPL-3.0-only |
| ファイル受信 | python-multipart | Apache-2.0 |
| ブラウザー試験 | Playwright | Apache-2.0 |
| アクセシビリティ試験 | axe-core Playwright連携 | MPL-2.0 |
| UIカタログ | Storybook | MIT |
| デザイントークン | デジタル庁デザインシステム | MIT |
| 間接的なビルド・試験依存 | 各ロックファイルに記録された構成品 | MIT、ISC、Apache-2.0、BSD-2-Clause、BSD-3-Clause、MPL-2.0、LGPL-3.0-or-later、BlueOak-1.0.0、CC0-1.0、CC-BY-4.0、0BSD、MIT-0、Python-2.0等 |

上記の表は、可読性のための要約であり、間接的な依存関係を含む完全な一覧ではない。固定された依存関係については、`requirements.lock` 及び `frontend/package-lock.json` を参照すること。機械可読な一覧については、[CycloneDX SBOM](docs/release/SBOM.cdx.json)を参照すること。同梱した許諾文及び表示の対応については、[第三者ライセンスの目録（manifest）](docs/release/THIRD_PARTY_LICENSES/manifest.json)を参照すること。公開候補においては、ロックファイルとインストール済み配布物のメタデータとを照合し、SBOM又はライセンス検査において未確認の項目が残存する場合は、当該公開候補を合格として扱わない。
