# PharmShiftMaker 新画面（認知中心UI v3）

本成果物は、再設計した画面を合成データにより評価するためのものであって、本番への配備物ではない。実在する職員、施設又は患者の情報は収録しない。

## パッケージのローカル表示

`pharmshift-ideal-ui-v3.zip`を展開する。Storybookのモジュールが適切なMIME型で読み込まれるよう、展開先をループバックアドレスで配信する。

```bash
cd pharmshift-ideal-ui-v3
python3 -m http.server 8000 --bind 127.0.0.1
```

`http://127.0.0.1:8000/`を開く。追加パッケージ、外部書体、分析スクリプト又はネットワーク上のデータ源は使用しない。

## リポジトリからの開発表示

Node.js 24、npm及びループバックアドレスへ接続可能なブラウザーを用いる。

```bash
cd frontend
npm ci
npm run storybook
```

`http://127.0.0.1:6006`を開く。Storybookには、許可された52の役割と画面経路の組合せに加え、25子画面の各々における正常・空・読込・失敗・競合・権限拒否の150状態及び31の代表操作画面を収録する。このうち、150状態及び31の代表操作画面に含まれる異常状態は、共通シェルにおける表示、通知及び復帰導線を確認するための合成状態であって、画面固有の業務失敗を模擬するものではない。Next.jsの`/showcase/home`も合成データ専用であり、本番データの経路から分離する。

## 構造上の公開条件

認証後の8入口及び25子画面は、本番候補と同一の用途別部品を使用する。共通シェル並びに認証、施設・部署、対象期間、公開版及び主要集計の初期読取りはServer Componentで処理する一方、変更操作及び操作後の用途別再読取りは、現在、Client Componentで処理する。したがって、全ての業務別読取りをServer Componentへ移行したとは扱わない。U01〜U27の機械可読な生成元は`usecases.json`とし、この生成元から、TypeScriptのルート契約、ページ遷移図及びテキスト代替付きの業務シナリオのシーケンス図を生成する。本番の既定画面に採用するには、`research/usability-protocol.md`の評価を別途完了しなければならない。本書は、利用者又は支援技術による評価結果を主張するものではない。

## 検証資料

図はコードから生成し、`tests/test_er_fresh.py`により更新漏れを検査する。生成後に手動で修正しない。再生成には`PYTHONPATH=src:. python -m devtools.er.<name> --write`を用いる。

- `docs/architecture/er/physical.mmd`（拡大表示用に`.svg`）：データベースの物理的な関連のみを示す。
- `docs/architecture/er/logical.md`：不変のJSON文書の内部に保持する参照を示す。
- `docs/architecture/er/ideal-states.md`：変更ケース、所属及びライフサイクルの状態遷移を示す。`src/shift_scheduler/application/ideal_workflows.py`の遷移表から生成し、各々にテキストの表を付す。
- `docs/architecture/er/workflow-states.md`：公開の状態及び既存ワークフローの状態を示す。
- `docs/architecture/er/ia-map.md`：画面、API呼出し及び契約を示す。
- `docs/architecture/er/usecase-sequences.md`：27業務シナリオの全てを、Mermaid及びテキスト代替により示す。
- `docs/architecture/er/workspace-transitions.mmd`及び`.md`：ページ間の経路及びそのテキスト代替を示す。
- `v3-design-rationale.md`：認知面及び視覚面の設計判断、根拠並びに反対の根拠を記載する。
- `evidence.md`：根拠、反対の根拠及び範囲を限定した結論を記載する。
- `acceptance-matrix.md`：受入試験の合格基準及び現在の実施状況を記載する。
- `independent-review-v3.md`：第三者的レビューの指摘、対応及び未完了である人によるレビューの判定基準を記載する。
- `research/`：評価の実施計画書、未記入の結果記録様式（合成データ用）及び解析を収録する。

`RUN-MANIFEST.json`には、ソース版、実行環境及び未完了の評価条件を記録する。`DEPENDENCIES.json`は可読な依存一覧であり、`SBOM.cdx.json`はCycloneDX 1.5形式の構成品一覧である。ただし、いずれも、単独では脆弱性がないことを証明しない。`VERIFICATION-MANIFEST.json`には実行したコマンド及び結果を記録し、`verification/`には当該パッケージへ収録した機械可読の検証記録を保持する。

生成したZIPには、SHA-256の目録（manifest）を収録する。照合には、展開先の直下において`shasum -a 256 -c MANIFEST.sha256`を実行する。
