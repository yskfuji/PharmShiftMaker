<p align="center">
  <img src="docs/brand/wordmark-banner.png" alt="PharmShiftMaker" width="720" />
</p>

# PharmShiftMaker

病院薬剤部の勤務計画、当日の変更、休暇・勤務交換、職員手続き及び監査記録を扱うための試作ソフトウェアです。契約・資格・必要配置などの確認済み情報から勤務案を生成し、編集・検証・確認・公開を版として記録します。

**本番利用可能、安全性証明済み、WCAG適合、使いやすい、とは扱いません。** 給与計算・人事原本の決定・法令への最終照合は導入機関または外部システムの責務です。30名の利用者評価、VoiceOver/NVDA実機評価、実運用相当の性能測定は未完了です。

## 現在の位置付け

- FastAPI、PostgreSQL及びNext.jsによる業務機能と、合成データ用の試験環境を収録している。
- `src/shift_scheduler/config`及び`ops/attendance_mapping.example.yaml`の人物は、ID・表示名とも公開試験用の合成データである。導入時は、導入機関が管理する情報へ置き換える。
- 認知中心UI v3は `IDEAL_UI=1` のときだけ `/workspace` で有効になる。既定値はOFFであり、既存画面を維持する。
- 27業務系列、認可、版競合、冪等再送、人物消去及び復旧境界の自動試験を収録している。試験結果は、記録された合成条件についての確認に限られる。
- 30名の利用者評価、VoiceOver/NVDA実機評価及び実運用相当の75パーセンタイル性能測定は未完了である。

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

合成データの隔離プレビュー手順（ループバックポート・合成資格情報を含む）は [docs/local-isolated-preview.md](docs/local-isolated-preview.md) にあります。実データ導入には使いません。

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

直近の検証記録は [docs/ideal-ui/verification.md](docs/ideal-ui/verification.md) にある。公開候補では、記録されたソースSHA-256と最終コミットが一致することを再確認する。過去の成功記録を変更後の合格として流用しない。

## リポジトリ案内

- [隔離プレビュー（開発者向け）](docs/local-isolated-preview.md)
- [責務と読み順](docs/repository-map.md)
- [認知中心UI v3](docs/ideal-ui/README.md)
- [27業務系列の契約](docs/ideal-ui/usecases.json)
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

本リポジトリは2026-10-25（日本時間）に非公開化した。独自部分の著作権は [LICENSE](LICENSE) のとおり藤波祐介（Yusuke Fujinami）が単独で保有する。Copyright 2025–2026 Yusuke Fujinami。

利用、改変、再配布及び商用利用には、著作権者の事前の書面による許諾を要する。本リポジトリが公開されていた期間（2025年〜2026-10-25）にMIT Licenseの下で取得済みの複製については、当該複製固有のMIT License上の権利を本変更が遡って消滅させるものではない。公開後の複製又はforkを完全に回収することはできない。

`PharmShiftMaker`の名称及び本プロジェクト固有のロゴの利用は、[名称及びロゴの取扱い](TRADEMARKS.md)を参照すること。第三者ソフトウェア及び書体には、それぞれの許諾条件が適用される。
