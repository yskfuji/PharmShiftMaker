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

`http://127.0.0.1:6006`を開く。Storybookには、許可された52の役割・画面組合せ、25子画面ごとの正常・空・読込・失敗・競合・権限拒否150状態、31の代表操作画面及び新workspaceの共有部品の34見本を収録する。状態及び代表操作画面の異常状態は、画面固有の業務失敗を模擬するものではなく、共通シェルでの表示・通知・復帰導線を確認する合成状態である。Next.jsの`/showcase/home`も合成データ専用であり、本番データの経路から分離する。

## 構造上の公開条件

認証後の8入口と25子画面は、本番候補と同じ用途別部品を使用する。各子画面は、専用のルート定義（サーバー側の読取り境界と画面）を持つ。必須コンテキスト（認証、施設・部署、対象期間、公開版及び通知）と子画面ごとの業務データは、Server Componentがサーバー側で読み取る。変更操作はClient Componentが行い、変更後はサーバーが同じ経路を読み直す。`settings/appearance`は何も読まず、`plan/publications`と`settings/notifications`は必須コンテキストが読んだ内容を表示する。`usecases.json`をU01〜U29の機械可読な正本とし、TypeScriptのルート契約、ページ遷移図及びテキスト代替付きの系列図を生成する。本番の既定画面に採用するには`research/usability-protocol.md`の評価を別途完了する必要があり、本書は利用者又は支援技術による評価結果を主張しない。

## 見た目の修正（2026-10-06）

2026-10-06に、製品の所有者が新workspaceの画面を見て、職員の4子画面をはじめとする一部が装飾されていないように見えると指摘した。その時点の自動監査は、これらの画面について指摘を1件も出していなかった。自動の光学監査が測るのは、コントラスト、フォーカス表示、24pxの操作対象、320px幅でのあふれ及び文字間隔である。光学監査は、配置の質、文字の大きさの統一、項目のまとまり及び見出しと内容の一致を判定しない。閉じた開閉欄の中は、業務系列の試験が開いた箇所を除き、監査の対象外であった。したがって、それ以前の記録にある「光学監査の検出0件」は、画面を目で見て確かめたことを意味しない。

この指摘を受けて、25子画面の全てについて、見た目と画面内の構成を修正した。ルートの追加及び削除、API並びに業務規則の変更は行っていない。バックエンド（`src/`）は変更していない。追加したものは次のとおりである。

- 新workspace専用のスタイルシート（`frontend/src/styles/workspace/`の11ファイル）。文字の大きさ5段階を定義し、全てのセレクターを`.ideal-v3-app`で始める。従来画面及び`/preview`・`/showcase`には適用されない。
- 共有部品（`frontend/src/features/workspace/shared/`）。開閉欄の種別と取り消せない操作の札、件数から該当の操作へ進むボタン、表が横に続くことの案内、日付や氏名の折返し位置、コード値及び日時の表示用の語などである。
- 同じ種類の欠陥を検出すると失敗する検査。ブラウザ上の構造検査（`frontend/tests/visual/lib/structure.ts`）は、1文字ずつ折り返したラベル、装飾のない見出し・表・箇条書き・定義リスト、種別のないボタン、12px未満の本文、色の違うリンク及びサーバーの値をそのまま出した表示を検出する。構造試験（`tests/test_workspace_v3_structure.py`）の静的規則は、スタイルの規則がないクラス名などを検出する。これらの検査は計算値を報告するものであり、配置の良否、文言の適否及び使いやすさを判定しない。

修正後の画面写真は、AIのレビュー用エージェントが3回確認した。人によるレビューではない。最終の第4ラウンドの後には、同じ形の確認を行っていない。人による画面の評価は記録していない。

経過、追加した検査とその限界、修正中に見つけた挙動の欠陥、第4回正式実行の結果（`npm audit`の不合格を含む）及び既知の限界は、`verification.md`の「Visual repair of the workspace and the fourth formal run」に記してある。

## 検証資料

図はコードから生成し、`tests/test_er_fresh.py`で更新漏れを検査する。生成後に手修正しない。再生成には`PYTHONPATH=src:. python -m devtools.er.<name> --write`を用いる。

- `docs/architecture/er/physical.mmd` (`.svg` for zooming): physical database relationships only.
- `docs/architecture/er/logical.md`: references carried inside immutable JSON documents.
- `docs/architecture/er/ideal-states.md`: change-case/membership/lifecycle transitions, from the
  transition tables in `src/shift_scheduler/application/ideal_workflows.py`, each with a text table.
- `docs/architecture/er/workflow-states.md`: publication and existing workflow states.
- `docs/architecture/er/ia-map.md`: screens, API calls and contracts.
- `docs/architecture/er/usecase-sequences.md`: all 29 series as Mermaid and text alternatives.
- `docs/architecture/er/workspace-transitions.mmd` and `.md`: page-to-page routes and text alternative.
- `v3-design-rationale.md`: cognitive/visual decisions, evidence and counterevidence.
- `evidence.md`: evidence, counterevidence and bounded conclusions.
- `verification.md`: what was run, with what result, and what is not established, including the visual repair of 2026-10-06 and the fourth formal run.
- `acceptance-matrix.md`: acceptance criteria and current execution status.
- `independent-review-v3.md`: independent findings, remediation and remaining human review gate.
- `research/`: test protocol, blank synthetic results template and analysis.

`RUN-MANIFEST.json`はソース版、実行環境及び未完了の評価条件を記録する。`DEPENDENCIES.json`は可読な依存一覧、`SBOM.cdx.json`はCycloneDX 1.5形式の構成品一覧である。いずれも、それだけで脆弱性がないことを証明しない。`VERIFICATION-MANIFEST.json`は実行したコマンドと結果を記録し、`verification/`は当該パッケージへ収録した機械可読の証拠を保持する。

生成したZIPにはSHA-256 manifestを収録する。展開先の直下で`shasum -a 256 -c MANIFEST.sha256`を実行して照合する。
