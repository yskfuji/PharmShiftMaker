# 第三者ソフトウェアに関する表示

PharmShiftMakerは第三者のオープンソース・ソフトウェアを利用する。各著作権及び許諾条件は、それぞれの配布物に含まれるライセンス本文が優先する。

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
| ブラウザ試験 | Playwright | Apache-2.0 |
| アクセシビリティ試験 | axe-core Playwright連携 | MPL-2.0 |
| UIカタログ | Storybook | MIT |
| デザイントークン | デジタル庁デザインシステム | MIT |
| 推移的なビルド・試験依存 | 各lockfileに記録された構成品 | MIT、ISC、Apache-2.0、BSD-2-Clause、BSD-3-Clause、MPL-2.0、LGPL-3.0-or-later、BlueOak-1.0.0、CC0-1.0、CC-BY-4.0、0BSD、MIT-0、Python-2.0等 |

この表は読みやすさのための要約であり、推移的依存関係を含む完全な一覧ではない。固定された依存関係は `requirements.lock` と `frontend/package-lock.json`、機械可読な一覧は [CycloneDX SBOM](docs/release/SBOM.cdx.json)、同梱した許諾文及び表示の対応は[第三者ライセンスmanifest](docs/release/THIRD_PARTY_LICENSES/manifest.json)を参照すること。公開候補では、lockfileとインストール済み配布物のmetadataを照合する。SBOM又はライセンス検査で未確認の項目が残る場合は、公開候補を合格扱いにしない。
