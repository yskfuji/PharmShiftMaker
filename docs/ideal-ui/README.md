# PharmShiftMaker 認知中心UI v3

本成果物は、再設計した画面を合成データで評価するためのものである。本番への配備物ではなく、実在する職員、施設又は患者の情報を収録しない。

## パッケージのローカル表示

`pharmshift-ideal-ui-v3.zip`を展開し、Storybookのモジュールが適切なMIME型で読み込まれるよう、展開先をloopbackで配信する。

```bash
cd pharmshift-ideal-ui-v3
python3 -m http.server 8000 --bind 127.0.0.1
```

`http://127.0.0.1:8000/`を開く。追加パッケージ、外部書体、分析スクリプト又はネットワーク上のデータ源は使用しない。

## リポジトリからの開発表示

Node.js 24、npm及びloopbackへ接続できるブラウザを用いる。

```bash
cd frontend
npm ci
npm run storybook
```

`http://127.0.0.1:6006`を開く。Storybookには、許可された52の役割・画面組合せ、25子画面ごとの正常・空・読込・失敗・競合・権限拒否150状態及び31の代表操作画面を収録する。後二者の異常状態は、画面固有の業務失敗を模擬するものではなく、共通シェルでの表示・通知・復帰導線を確認する合成状態である。Next.jsの`/showcase/home`も合成データ専用であり、本番データの経路から分離する。

## 構造上の公開条件

認証後の8入口と25子画面は、本番候補と同じ用途別部品を使用する。共通シェル並びに認証、施設・部署、対象期間、公開版及び主要集計の初期読取りはServer Componentで処理する。現在、変更操作と操作後の用途別再読取りはClient Componentであり、全ての業務別読取りをServer Componentへ移したとは扱わない。`usecases.json`をU01〜U27の機械可読な正本とし、TypeScriptのルート契約、ページ遷移図及びテキスト代替付きの系列図を生成する。本番の既定画面に採用するには`research/usability-protocol.md`の評価を別途完了する必要があり、本書は利用者又は支援技術による評価結果を主張しない。

## 検証資料

図はコードから生成し、`tests/test_er_fresh.py`で更新漏れを検査する。生成後に手修正しない。再生成には`PYTHONPATH=src:. python -m devtools.er.<name> --write`を用いる。

- `docs/architecture/er/physical.mmd` (`.svg` for zooming): physical database relationships only.
- `docs/architecture/er/logical.md`: references carried inside immutable JSON documents.
- `docs/architecture/er/ideal-states.md`: change-case/membership/lifecycle transitions, from the
  transition tables in `src/shift_scheduler/application/ideal_workflows.py`, each with a text table.
- `docs/architecture/er/workflow-states.md`: publication and existing workflow states.
- `docs/architecture/er/ia-map.md`: screens, API calls and contracts.
- `docs/architecture/er/usecase-sequences.md`: all 27 series as Mermaid and text alternatives.
- `docs/architecture/er/workspace-transitions.mmd` and `.md`: page-to-page routes and text alternative.
- `v3-design-rationale.md`: cognitive/visual decisions, evidence and counterevidence.
- `evidence.md`: evidence, counterevidence and bounded conclusions.
- `acceptance-matrix.md`: acceptance criteria and current execution status.
- `independent-review-v3.md`: independent findings, remediation and remaining human review gate.
- `research/`: test protocol, blank synthetic results template and analysis.

`RUN-MANIFEST.json`はソース版、実行環境及び未完了の評価条件を記録する。`DEPENDENCIES.json`は可読な依存一覧、`SBOM.cdx.json`はCycloneDX 1.5形式の構成品一覧である。いずれも、それだけで脆弱性がないことを証明しない。`VERIFICATION-MANIFEST.json`は実行したコマンドと結果を記録し、`verification/`は当該パッケージへ収録した機械可読の証拠を保持する。

生成したZIPにはSHA-256 manifestを収録する。展開先の直下で`shasum -a 256 -c MANIFEST.sha256`を実行して照合する。
