# デスクトップ版の技術検証（M0）の結果

本書は、PharmShiftMaker を1台のパソコンで動くデスクトップアプリとして配布するための技術検証（M0）の結果と、その結果から決めた方針を記録するものです。

## 1. 位置付け

1. 本書は、設計上の判断の記録（ADR）です。配布物の品質や、薬剤部での試行運用の安全性を保証するものではありません。
2. 検証は、非公開の検証用リポジトリ（`pharmshift-desktop-poc`）で、GitHub Actions のランナー（macOS arm64、Windows x64）を使って行いました。実データは使っていません。
3. 本書に記載する結果は、2026年11月19日の実行（ID 44482185884、検証用リポジトリのコミット `f204a86`）のものです。判定は、各手順の `outcome`（`continue-on-error` で隠れない結果）で行いました。

## 2. 構成の前提

1. Electron の殻が、次の子プロセスを起動します。すべて `127.0.0.1` だけで待ち受けます。
   - PostgreSQL 16（EDB 版のバイナリを同梱します）
   - API（uvicorn、TLS）と worker（python-build-standalone 3.12.15 を同梱します）
   - 独立制御（control authority）
   - 画面（Next.js の `output: 'standalone'` を、同梱の Node 26 で HTTPS 起動します）
2. TLS の証明書は、導入ごとに作るCAで発行します。CA の秘密鍵は、発行後に破棄します。
3. 画面からの API 呼出しは、同じ Origin の `/api` を経由させます。

## 3. 結果

| ID | 内容 | macOS | Windows |
|---|---|---|---|
| V1 | 移設した PostgreSQL の `initdb`・`pg_ctl`・`pg_dump` が動き、loopback だけで待ち受けること | 成功 | 成功 |
| V2 | 同梱の Python に依存を入れ、spawn した子プロセスで OR-Tools が解けること | 成功 | 成功 |
| V3 | 同梱の PostgreSQL で、マイグレーション、API（TLS）、worker が起動し、ログインできること | 成功 | 失敗（下記4.4のとおりM3で対応） |
| V4 | Next.js の standalone を、同梱の Node で HTTPS 起動し、`/api` を中継できること | 成功 | 失敗（V3と同じ原因） |
| V5 | Electron が、導入ごとのCAで発行した証明書だけを受け入れ、ほかの自己署名証明書を拒否すること | 成功 | 成功 |
| V6 | 署名のない NSIS インストーラーを導入し、起動できること | 対象外 | 成功 |

Windows の V3 と V4 の失敗は、検証ワークフローが「M3 待ち」として記録し、判定から除いています。SmartScreen の表示は、CI では確認できません。

## 4. 判明した制約と方針

### 4.1 Electron の証明書の検証

1. Chromium は、信頼されていないルートCAについて、`setCertificateVerifyProc` に発行者の証明書（`issuerCert`）を渡しません。
2. このため、殻は、受け取ったサーバー証明書の署名を、導入時に保存したCAの公開鍵で自ら検証します。あわせて、証明書の主体の別名（SAN）が `127.0.0.1` であることを確かめます。

### 4.2 Windows 版 PostgreSQL の展開

1. EDB 版の zip から必要なフォルダーだけを選んで展開すると、`share` の一部が欠け、`initdb` が失敗しました。
2. このため、全体を展開してから、pgAdmin、StackBuilder、文書、ヘッダー、デバッグ用の記号ファイルを削除します。
3. `pg_dump` は、オプションをすべて書いた後、最後にデータベース名を渡します（Windows 版は、データベース名より後の引数を受け付けません）。

### 4.3 macOS 版 PostgreSQL の配置

1. macOS 版では、`share` の配下の構成が Windows 版と異なります（`share/postgresql/timezonesets` など）。
2. 検査では、決め打ちの場所ではなく、`timezonesets` の所在を探して確かめます。

### 4.4 Windows でのファイルのロック

1. API の管理対象ファイルの書き込み（`ops/managed_writer.py`）は、POSIX の `fcntl` を使っています。Windows には `fcntl` がないため、API を読み込めません。
2. Windows 用の実装は、M3 で行います。Windows のアクセス制御リスト（ACL）の検査も、同じ M3 で実装します。それまで、デスクトップ版の設定（`PHARMSHIFT_ENV=desktop`）は、Windows では起動を拒否します（`config/desktop.py`）。

### 4.5 合成データのサーバー

検証で使った合成データのサーバーは、テスト用のモジュール（`tests/` 配下）に依存しています。配布物にはテストを含めないため、配布物での動作確認には、別の起動手段が必要です。

## 5. 版と容量

| 項目 | 値 |
|---|---|
| PostgreSQL | 16.13（EDB 版） |
| Python | 3.12.15（python-build-standalone 20261021） |
| 画面用の Node | 26.12.1 |
| Electron | 45.2.3（electron-builder 26.18.1） |
| PostgreSQL の同梱分（不要分の削除後） | macOS 151MB（bin 30MB、lib 114MB、share 7.6MB）、Windows 123MB |
| Next.js の standalone | 約59MB（Windows の今回の実行） |
| Windows のインストーラー（検証用、署名なし） | 115.6MB |

## 6. 次の段階への申し送り

1. M2（配布）：macOS の署名と公証、Windows のインストーラー、来歴の証明（Artifact attestations）を行います。
2. M3（Windows）：`fcntl` に代わるファイルのロック、ACL の検査、Windows での V3・V4 の再検証を行います。
3. 試用の許諾の条項は、所有者が文言を承認するまで、LICENSE に加えません。
