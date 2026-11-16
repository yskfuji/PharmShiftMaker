# PharmShiftMaker 認知中心UI v3

本書は、認知中心UI v3 の成果物について、表示の方法、構造上の公開条件及び検証資料を定める。

## 1. 目的

本成果物は、再設計した画面を合成データで評価するためのものである。本成果物は本番への配備物ではなく、実在する職員、施設又は患者の情報を収録しない。

## 2. パッケージのローカル表示

1. `pharmshift-ideal-ui-v3.zip` を展開する。
2. Storybook のモジュールが適切な MIME 型で読み込まれるよう、展開先をループバックアドレスで配信する。

   ```bash
   cd pharmshift-ideal-ui-v3
   python3 -m http.server 8000 --bind 127.0.0.1
   ```

3. `http://127.0.0.1:8000/` を開く。

パッケージの表示には、追加パッケージ、外部書体、分析スクリプト又はネットワーク上のデータ源を使用しない。

## 3. リポジトリからの開発表示

開発表示には、Node.js 26.12.1（`.nvmrc`）、同梱の npm 及びループバックアドレスへ接続できるブラウザを用いる。

```bash
cd frontend
npm ci
npm run storybook
```

`http://127.0.0.1:6006` を開く。Storybook には、次のものを収録する。

- 許可された役割と画面の組合せ52件
- 25の子画面ごとの正常・空・読込み・失敗・競合・権限拒否の150状態
- 31の代表操作画面

後二者（150状態及び31の代表操作画面）に含まれる異常状態は、画面固有の業務失敗を模擬するものではない。当該異常状態は、共通シェルでの表示、通知及び復帰の導線を確認するための合成状態である。Next.js の `/showcase/home` も合成データ専用であり、本番データの経路から分離する。

## 4. 構造上の公開条件

認証後の8入口及び25子画面は、本番候補と同じ用途別部品を使用する。共通シェル並びに認証、施設・部署、対象期間、公開版及び主要集計の初期読取りは、Server Component で処理する。現在、変更操作及び操作後の用途別の再読取りは Client Component で処理しており、全ての業務別の読取りを Server Component へ移したとは扱わない。

`usecases.json` を U01〜U27 の機械可読な正本とする。この正本から、TypeScript のルート契約、ページ遷移図及びテキスト代替付きのシーケンス図を生成する。

本番の既定画面に採用するには、[research/usability-protocol.md](research/usability-protocol.md) に定める評価を別途完了しなければならない。本書は、利用者又は支援技術による評価の結果を主張しない。

## 5. 検証資料

### 5.1 コードから自動生成する図

次の図はコードから生成する。生成後に手で修正してはならない。

1. 更新漏れは、`tests/test_er_fresh.py`（physical、logical、ia-map 及び ideal-states）並びに `tests/test_ideal_usecase_contract.py`（usecase-sequences 及び workspace-transitions）で検査する。
2. 再生成には `PYTHONPATH=src:. python -m devtools.er.<physical|logical|ia_map|states|usecase_sequences> --write` を用いる。workspace-transitions は `devtools/ideal_ui/generate_routes.py` で生成する。

| 文書 | 内容 |
|---|---|
| [docs/architecture/er/physical.mmd](../architecture/er/physical.mmd)（拡大表示用に [`.svg`](../architecture/er/physical.svg)） | データベースの物理的な関連に限る。 |
| [docs/architecture/er/logical.md](../architecture/er/logical.md) | 不変の JSON 文書の内部に保持する参照。 |
| [docs/architecture/er/ideal-states.md](../architecture/er/ideal-states.md) | 変更ケース・所属・ライフサイクルの状態遷移。`src/shift_scheduler/application/ideal_workflows.py` の遷移表から生成し、各図にテキストの表を付ける。 |
| [docs/architecture/er/ia-map.md](../architecture/er/ia-map.md) | 画面、API の呼出し及び契約。 |
| [docs/architecture/er/usecase-sequences.md](../architecture/er/usecase-sequences.md) | 全27系列の Mermaid 図及びテキスト代替。 |
| [docs/architecture/er/workspace-transitions.mmd](../architecture/er/workspace-transitions.mmd) 及び [`.md`](../architecture/er/workspace-transitions.md) | ページ間の経路及びそのテキスト代替。 |

### 5.2 手書きの資料

次の資料は人が書いたものであり、5.1 の自動生成及び更新漏れの検査の対象ではない。

| 文書 | 内容 |
|---|---|
| [docs/architecture/er/workflow-states.md](../architecture/er/workflow-states.md) | 公開の状態及び既存ワークフローの状態。 |
| [v3-design-rationale.md](v3-design-rationale.md) | 認知面・視覚面の設計判断、根拠及び反証。 |
| [evidence.md](evidence.md) | 根拠、反証及び範囲を限った結論。 |
| [acceptance-matrix.md](acceptance-matrix.md) | 受入条件及び現在の実施状況。 |
| [independent-review-v3.md](independent-review-v3.md) | 独立レビューの指摘、対応及び残る人によるレビューの判定条件。 |
| [research/](research/) | 評価の実施要領、合成データ用の未記入の結果様式及び解析。 |

### 5.3 パッケージに収録する記録

`RUN-MANIFEST.json` は、ソースの版、実行環境及び未完了の評価条件を記録する。`DEPENDENCIES.json` は人が読める依存関係の一覧であり、`SBOM.cdx.json` は CycloneDX 1.5 形式の構成品一覧である。これらのファイルは、いずれもそれだけで脆弱性がないことを証明しない。`VERIFICATION-MANIFEST.json` は実行したコマンド及び結果を記録し、`verification/` は当該パッケージへ収録した機械可読の証拠を保持する。

### 5.4 パッケージの照合

生成した ZIP には、SHA-256 のマニフェストを収録する。照合するときは、展開先の直下で `shasum -a 256 -c MANIFEST.sha256` を実行する。
