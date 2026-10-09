# PharmShiftMaker

PharmShiftMakerは、病院薬剤部の勤務計画、当日の変更、休暇・勤務交換、職員手続き及び監査記録を扱うための試作ソフトウェアである。契約、資格、必要配置その他の確認済み情報から勤務案を生成し、編集、サーバー検証、確認及び公開を版として記録する。

本ソフトウェアが示す勤務案は、人事・労務上の最終決定ではない。給与計算、人事原本の決定及び適用法令等への最終的な照合は、導入機関又は外部システムの責務である。

## 現在の位置付け

- FastAPI、PostgreSQL及びNext.jsによる業務機能と、合成データ用の試験環境を収録している。
- `src/shift_scheduler/config`及び`ops/attendance_mapping.example.yaml`の人物は、ID・表示名とも公開試験用の合成データである。導入時は、導入機関が管理する情報へ置き換える。
- 認知中心UI v3は `IDEAL_UI=1` のときだけ `/workspace` で有効になる。既定値はOFFであり、既存画面を維持する。
- 新workspace（`/workspace`）の25子画面は、それぞれ専用のルート定義（サーバー側の読取り境界と画面）を`frontend/src/features/workspace`の下に持つ。全ての子画面が自分でAPIを読むわけではない。`settings/appearance`は何も読まず、`plan/publications`と`settings/notifications`は、必須コンテキストが読んだ内容を表示する。構造試験（`tests/test_workspace_v3_structure.py`）は、新workspaceが従来画面の実装を推移的にimportした場合、従来URLへリンクした場合、又は複数用途を兼ねる従来フォームを表示した場合に失敗する。`/preview` と `/showcase` はv1/v2の互換ショーケースであり、v3の証跡には含めない。構造試験は、名称を変えた複製を検出できない。作り直した画面と従来部品との比較（行単位及びトークン列）は、[検証記録](docs/ideal-ui/verification.md)の「Structural independence from the established screens」に記してある。作り直した構成でのブラウザ検証（3回の正式実行の経過、未確認の範囲及び既知の限界）と独立レビューの結果は、同じ検証記録に記してある。
- 2026-10-06に、製品の所有者が新workspaceの画面を見て、一部が装飾されていないように見えると指摘した。その時点の自動監査（コントラスト、フォーカス表示、操作対象の大きさ、320px幅でのあふれ、文字間隔及びaxe）は、これらの画面について指摘を出していなかった。これらの監査は、配置や見た目の仕上がりを判定しない。したがって、それ以前の記録にある「光学監査の検出0件」は、画面を目で見て確かめたことを意味しない。この指摘を受けて、25子画面の見た目と画面内の構成を修正し、同じ種類の欠陥を検出すると失敗する検査を追加した。ルートの追加及び削除、API並びに業務規則の変更は行っていない。修正後の画面写真を確認したのはAIのレビュー用エージェントであり、人による評価は記録していない。経過、検査の限界及び既知の限界は、検証記録の「Visual repair of the workspace and the fourth formal run」に記してある。
- 修正後の最終ソースに対する第4回の正式実行（2026-10-07）では、29業務系列の261/261件、旗OFFの267/267件及びStorybookの各行列が合格した。一方、`npm audit`は不合格であった（重大度highの勧告が2件：`sharp`及び`source-map-js`）。lockfileは基点から変更していない。この2件は本記録の時点で未対応であり、依存の更新は別途扱う。（2026-10-07追記：lockfileだけを更新する変更を、公開リポジトリのPR #16として`main`へ統合した。`npm audit`の2つのコマンドは、手元と公開CIで終了コード0である。更新後のlockfileに対するブラウザの行列は実行していない。）
- 29業務系列、認可、版競合、冪等再送、人物消去及び復旧境界の自動試験を収録している。試験結果は、記録された合成条件についての確認に限られる。
- 30名の利用者評価、VoiceOver/NVDA実機評価及び実運用相当の75パーセンタイル性能測定は未完了である。「使いやすい」「WCAG適合」「本番利用可能」又は「安全性を証明済み」とは扱わない。

## 主要な画面

認知中心UIは、次の8入口と25のブックマーク可能な子画面で構成する。

| 入口 | 主な用途 |
|---|---|
| 今日 | 対応が必要な判断、欠員、公開準備及び本人への通知 |
| 勤務表 | 月間勤務、日別表示、版差分及び本人用出力 |
| 計画 | 前提確認、候補生成、案比較、確認・編集及び公開 |
| 当日運用 | 予定、欠勤・交換、代替候補、承認及び通知 |
| 申請 | 本人の申請、休暇、勤務交換及び兼業・外部勤務 |
| 職員 | 職員一覧、本人アカウント、契約・資格及び入退職 |
| ガバナンス | 監査、実績照合、本人対応及び復旧状態 |
| 設定 | 外観、通知、欠勤時の同意及びフレックスタイム |

## 合成データでのローカル起動

要件はPython 3.12、Node.js 24及びnpmである。以下の手順は、隔離された開発用SQLiteと合成職員だけを使用する。

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install --require-hashes -r requirements.lock
.venv/bin/python -m pip install --no-deps -e .
npm --prefix frontend ci
./scripts/generate-dev-certs.sh
```

ターミナル1で合成APIを起動する。

```bash
.venv/bin/python -m scripts.remediation_test_server
```

ターミナル2で認知中心UIを起動する。環境変数名のアンダースコアをエスケープせず、URLをMarkdownリンクにしないこと。

```bash
cd frontend
IDEAL_UI=1 \
NEXT_PUBLIC_API_BASE_URL=https://127.0.0.1:18510 \
NEXT_DIST_DIR=.next-local \
npm run dev -- --hostname 127.0.0.1 --port 18511
```

<https://127.0.0.1:18511/login> を開く。合成環境の開発用アカウントは次のとおりである。

| 役割 | ユーザーID | パスワード |
|---|---|---|
| 管理者 | `admin` | `pass-admin` |
| 責任者 | `leader` | `pass-lead` |
| 薬剤師 | `pharmacist` | `pass-ph` |

これらの資格情報は `scripts/remediation_test_server.py` が作る一時環境専用である。常設環境又は実データ環境へ流用してはならない。証明書が信頼されない場合は、[開発用証明書の説明](certs/README.md)に従うこと。TLS検証を無効にする手順は採用しない。

## 検証

基本的な開発検査は次のとおりである。PostgreSQL統合、3ブラウザE2E、光学監査、人物消去及び復旧演習には、別途、所有が確認された隔離用DBと各実行手順が必要である。

```bash
ruff check src scripts tests devtools
black --check src scripts tests devtools
mypy src
pyright --project pyright-release.json --pythonpath "$(command -v python)"
python -m pytest

cd frontend
npm run lint
npm test -- --runInBand
npx tsc --noEmit
npm run build
npm run build-storybook
```

直近の検証記録は [docs/ideal-ui/verification.md](docs/ideal-ui/verification.md) にある。直近の正式実行（第4回、2026-10-07）では、`npm audit`が不合格であった。公開候補では、記録されたソースSHA-256と最終コミットが一致することを再確認する。過去の成功記録を変更後の合格として流用しない。

## リポジトリ案内

- [責務と読み順](docs/repository-map.md)
- [認知中心UI v3](docs/ideal-ui/README.md)
- [29業務系列の契約](docs/ideal-ui/usecases.json)
- [ER図・状態図・画面/API対応図](docs/architecture/er/)
- [導入・運用機関の責務](docs/legal/operator-responsibilities.md)
- [利用上の注意](docs/legal/usage-notes.md)
- [公開・法務・運用文書の根拠と限界](docs/legal/evidence-and-limitations.md)
- [個人情報の取扱い](PRIVACY.md)
- [セキュリティ方針](SECURITY.md)
- [貢献方法](CONTRIBUTING.md)
- [支援及び保守](SUPPORT.md)
- [名称及びロゴの取扱い](TRADEMARKS.md)
- [開発来歴に関する説明](docs/legal/development-provenance.md)
- [第三者ソフトウェア](THIRD_PARTY_NOTICES.md)
- [CycloneDX SBOM](docs/release/SBOM.cdx.json)

## ライセンス

本リポジトリの独自部分は [MIT License](LICENSE) により提供する。Copyright 2025–2026 Yusuke Fujinami。

MIT Licenseは、著作権表示及び許諾表示を保持することを条件として、利用、改変、再配布及び商用利用を許諾する。公開後の複製又はforkを完全に回収することはできない。MIT Licenseの免責条項は、強行法規上の義務又は導入機関の個人情報保護その他の義務を消滅させるものではない。

`PharmShiftMaker`の名称及び本プロジェクト固有のロゴの利用は、[名称及びロゴの取扱い](TRADEMARKS.md)を参照すること。第三者ソフトウェア及び書体には、それぞれの許諾条件が適用される。
