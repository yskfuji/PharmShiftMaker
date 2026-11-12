# 合成データでのローカル起動（開発者向け）

ルート README の製品入口からは外した、隔離プレビュー手順です。実データ用ではありません。

要件は Python 3.12.15、Node.js 26.12.1（`.nvmrc`）及び同梱の npm です。隔離された開発用 SQLite と合成職員だけを使用します。

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install --require-hashes -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
npm --prefix frontend ci
./scripts/generate-dev-certs.sh
```

ターミナル1で合成 API を起動します。

```bash
.venv/bin/python -m scripts.remediation_test_server
```

ターミナル2で認知中心 UI を起動します。

```bash
cd frontend
IDEAL_UI=1 \
NEXT_PUBLIC_API_BASE_URL=https://127.0.0.1:18510 \
NEXT_DIST_DIR=.next-local \
npm run dev -- --hostname 127.0.0.1 --port 18511
```

起動後は画面側の `/login` を開きます。合成環境の開発用アカウントは次のとおりです。

| 役割 | ユーザーID | パスワード |
|---|---|---|
| 管理者 | `admin` | `pass-admin` |
| 責任者 | `leader` | `pass-lead` |
| 薬剤師 | `pharmacist` | `pass-ph` |

これらの資格情報は `scripts/remediation_test_server.py` が作る一時環境専用です。常設環境または実データ環境へ流用してはなりません。証明書が信頼されない場合は [開発用証明書の説明](../certs/README.md) に従います。TLS 検証を無効にする手順は採用しません。

## 合成データの見え方

- 合成データは2026年1月分です。公開版は既定では作りません。勤務表に公開済みの勤務を表示するには、ターミナル1で `PHARMSHIFT_E2E_PUBLICATION=1 .venv/bin/python -m scripts.remediation_test_server` として起動し、`/workspace/schedule?period=2026-01` を開きます。
- 当月（日本時間）を表示する画面は、公開版がない状態の画面になります。
- 合成データだけで画面を並べる `/showcase` は、ターミナル2の起動に `IDEAL_SHOWCASE=1` を加えたときだけ開けます。サインインは不要です。

## 手元の作業ツリーへの影響

- `npm run dev` は `frontend/next-env.d.ts` を `.next-local` 向けに書き換えることがあります。コミットせず、`git checkout -- frontend/next-env.d.ts` で戻します。
- 終了は各ターミナルで Ctrl+C です。合成 API は一時フォルダーの SQLite を削除して終了します。
