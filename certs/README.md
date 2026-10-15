# ローカル開発用のTLS証明書

本ディレクトリには、FastAPIバックエンドとNext.jsフロントエンドが共用する、開発専用のTLS関連ファイルを格納する。

## 証明書の生成

リポジトリのルートにおいて、次の補助スクリプトを実行する。

```bash
./scripts/generate-dev-certs.sh
```

スクリプトは、OSが信頼する証明書を発行するため、[`mkcert`](https://github.com/FiloSottile/mkcert) を優先して使用する。`mkcert` を使用できない場合は、自動的に `openssl` へ切り替える。Docker Compose内においてもHTTPSが動作するよう、サブジェクト代替名（Subject Alternative Name：SAN）には `localhost`、`backend`、`pharmshift-backend`、`frontend`、`pharmshift-frontend`、`127.0.0.1` 及び `::1` を含める。証明書は、次のファイルとして作成される。

- `certs/localhost-cert.pem`
- `certs/localhost-key.pem`
- `certs/dev-rootCA.pem`（mkcertのルート認証局（Certificate Authority：CA）の証明書、又は自己署名証明書の写し。Node.jsのトラストストアに使用できる）

これらのファイルは、全てGitの追跡対象から除外している。必要な場合は、随時再生成してよい。

## 証明書の信頼設定

- `mkcert` を使用する場合、信頼の設定は自動的に実施される。同ツールがローカルCAをインストールし、スクリプトがそのCAの証明書を `certs/dev-rootCA.pem` へ複製するためである。
- `openssl` による代替手段を使用する場合は、生成された証明書をOS又はブラウザーのトラストストアへ手動で取り込むこと。これにより、ブラウザー及びNode.jsが、HTTPSエンドポイントを警告なしで受け入れる（この場合も、CAの証明書の写しは `certs/dev-rootCA.pem` に存在する）。
- サーバー側のfetchもバックエンドを信頼するよう、`NODE_EXTRA_CA_CERTS` 又は `NEXT_SSL_CA_PATH` に `certs/dev-rootCA.pem` を設定すること。

## 使い方

開発サーバーは、いずれも次の環境変数を介して、証明書と鍵の組を自動的に読み込む。

- `UVICORN_SSL_CERTFILE` / `UVICORN_SSL_KEYFILE`
- `NEXT_SSL_CERT_PATH` / `NEXT_SSL_KEY_PATH`
- `NODE_EXTRA_CA_CERTS` / `NEXT_SSL_CA_PATH`

HTTPSの設定手順の全体は、ルートの `README.md` を参照すること。
