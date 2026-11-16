# ローカル開発用の TLS 証明書

本書は、ローカル開発で用いる TLS 証明書の生成、信頼設定及び使い方について定める。

## 1. 適用範囲

本ディレクトリには、FastAPI のバックエンド及び Next.js のフロントエンドが共用する、開発専用の TLS 関連ファイルを格納する。

## 2. 証明書の生成

開発者は、リポジトリのルートで次の補助スクリプトを実行する。

```bash
./scripts/generate-dev-certs.sh
```

本スクリプトは、OS が信頼する証明書を発行するため、[`mkcert`](https://github.com/FiloSottile/mkcert) を優先して使用する。`mkcert` を使用できない場合、本スクリプトは自動的に `openssl` へ切り替える。Docker Compose の内部でも HTTPS が動作するよう、サブジェクト代替名（SAN）には `localhost`、`backend`、`pharmshift-backend`、`frontend`、`pharmshift-frontend`、`127.0.0.1` 及び `::1` を含める。

本スクリプトは、次のファイルを作成する。

- `certs/localhost-cert.pem`
- `certs/localhost-key.pem`
- `certs/dev-rootCA.pem`（mkcert のルート CA、又は自己署名証明書の写し。Node.js のトラストストアに使用できる。）

これらのファイルは、全て Git の追跡対象から除外している。開発者は、必要なときにいつでも再生成してよい。

## 3. 証明書の信頼設定

- `mkcert` を使用する場合、信頼設定は自動的に行われる。`mkcert` がローカル CA をインストールし、本スクリプトがその CA を `certs/dev-rootCA.pem` へ複製するためである。
- `openssl` による代替手段を使用する場合、開発者は、生成された証明書を OS 又はブラウザのトラストストアへ手動で取り込む。これにより、ブラウザ及び Node.js が、HTTPS のエンドポイントを警告なしに受け入れる。この場合も、CA の写しは `certs/dev-rootCA.pem` に置かれる。
- サーバー側の fetch もバックエンドを信頼するよう、開発者は、`NODE_EXTRA_CA_CERTS` 又は `NEXT_SSL_CA_PATH` に `certs/dev-rootCA.pem` を設定する。

## 4. 使い方

両方の開発サーバーは、次の環境変数を通じて、証明書と鍵の組を自動的に読み込む。

- `UVICORN_SSL_CERTFILE` / `UVICORN_SSL_KEYFILE`
- `NEXT_SSL_CERT_PATH` / `NEXT_SSL_KEY_PATH`
- `NODE_EXTRA_CA_CERTS` / `NEXT_SSL_CA_PATH`

隔離したローカル環境で HTTPS により表示する手順は、[合成データでのローカル起動（開発者向け）](../docs/local-isolated-preview.md)を参照する。
