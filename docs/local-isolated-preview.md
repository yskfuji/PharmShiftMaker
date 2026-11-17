# 合成データでのローカル起動（開発者向け）

本書は、合成データを用いて本ソフトウェアを開発者の端末上で隔離して起動する手順を定めます。本手順は実データ用ではありません。

## 1. 適用範囲

本手順は、隔離された開発用 SQLite 及び合成職員だけを使用します。

## 2. 要件

本手順の実行には、Python 3.12.15、Node.js 26.12.1（`.nvmrc`）及び同梱の npm を要します。

## 3. 手順

1. 依存ソフトウェアを導入し、開発用証明書を生成してください。

   ```bash
   python3.12 -m venv .venv
   .venv/bin/python -m pip install --upgrade pip
   .venv/bin/python -m pip install --require-hashes -r requirements.lock
   .venv/bin/python -m pip install --no-deps -e .
   npm --prefix frontend ci
   ./scripts/generate-dev-certs.sh
   ```

2. ターミナル1で合成 API を起動してください。

   ```bash
   .venv/bin/python -m scripts.remediation_test_server
   ```

3. ターミナル2で認知中心 UI を起動してください。

   ```bash
   cd frontend
   IDEAL_UI=1 \
   NEXT_PUBLIC_API_BASE_URL=https://127.0.0.1:18510 \
   NEXT_DIST_DIR=.next-local \
   npm run dev -- --hostname 127.0.0.1 --port 18511
   ```

4. 起動後は、画面側の `/login` を開いてください。合成環境の開発用アカウントは、次の表のとおりです。

   | 役割 | ユーザーID | パスワード |
   |---|---|---|
   | 管理者 | `admin` | `pass-admin` |
   | 責任者 | `leader` | `pass-lead` |
   | 薬剤師 | `pharmacist` | `pass-ph` |

> **重要**
> 手順4の資格情報は、`scripts/remediation_test_server.py` が作成する一時環境専用です。常設環境又は実データ環境へ流用してはなりません。

## 4. 証明書が信頼されない場合

証明書が信頼されない場合は、[開発用証明書の説明](../certs/README.md) に従ってください。TLS 検証を無効にする手順は採用しません。
