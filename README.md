<p align="center">
  <img src="docs/brand/wordmark-banner.png" alt="PharmShiftMaker" width="720" />
</p>

# PharmShiftMaker

病院薬剤部の勤務計画、当日の変更、休暇・勤務交換、職員手続き、監査の記録を扱う試作ソフトウェアです。確認済みの契約・資格・必要配置から勤務案を作り、編集、検証、確認、公開を版として残します。

**本番で使えること、安全性が証明されていること、WCAG に適合していること、使いやすいことは主張しません。** 給与計算、人事原本の決定、法令との最終照合は、導入する施設または外部システムの仕事です。30人の利用者評価、VoiceOver と NVDA の実機確認、実運用に近い性能測定は終わっていません。

## 画面

| 入口 | 内容 |
|---|---|
| 今日 | 判断が必要なこと、欠員、公開の準備、本人への通知 |
| 勤務表 | 月間の勤務、日別の表示、版の差分、本人用の出力 |
| 計画 | 前提の確認、候補の作成、案の比較、確認・編集、公開 |
| 当日運用 | その日の予定、欠勤・交換、代わりの候補、承認、通知 |
| 申請 | 本人の申請、休暇、勤務交換、兼業・外部勤務 |
| 職員 | 職員の一覧、本人のアカウント、契約・資格、入職と退職 |
| ガバナンス | 監査、実績の照合、本人からの請求、復旧の状態 |
| 設定 | 外観、通知、欠勤時の同意、フレックスタイム |

収録している人物は公開試験用の合成データです。導入するときは、施設が管理する情報に置き換えます。自動試験の結果は、記録した合成条件での確認に限ります。

## 文書

- [個人情報の取扱い](PRIVACY.md)
- [セキュリティ](SECURITY.md)
- [利用上の注意](docs/legal/usage-notes.md)
- [導入する施設の責務](docs/legal/operator-responsibilities.md)
- [書いてあることの根拠と、まだ確認していないこと](docs/legal/evidence-and-limitations.md)
- [名称とロゴ](TRADEMARKS.md)
- [同梱している他者のソフトウェア](THIRD_PARTY_NOTICES.md)
- [ソフトウェア部品表](docs/release/SBOM.cdx.json)

## 開発

手元で合成データだけを見る手順は [開発用の起動手順](docs/local-isolated-preview.md) にあります。実データの導入には使いません。

- [画面の説明](docs/ideal-ui/README.md)
- [処理の一覧](docs/ideal-ui/usecases.json)
- [データの形と画面の対応](docs/architecture/er/)
- [リポジトリの構成](docs/repository-map.md)
- [検証の記録](docs/ideal-ui/verification.md)
- [開発の経緯](docs/legal/development-provenance.md)
- [変更の提案](CONTRIBUTING.md)
- [問い合わせ](SUPPORT.md)

## ライセンス

本リポジトリは2026-10-25（日本時間）に非公開化した。独自部分の著作権は [LICENSE](LICENSE) のとおり藤波祐介（Yusuke Fujinami）が単独で保有する。Copyright 2025–2026 Yusuke Fujinami。

利用、改変、再配布及び商用利用には、著作権者の事前の書面による許諾を要する。本リポジトリが公開されていた期間（2025年〜2026-10-25）にMIT Licenseの下で取得済みの複製については、当該複製固有のMIT License上の権利を本変更が遡って消滅させるものではない。公開後の複製又はforkを完全に回収することはできない。

`PharmShiftMaker`の名称及び本プロジェクト固有のロゴの利用は、[名称とロゴ](TRADEMARKS.md)を参照すること。第三者ソフトウェア及び書体には、それぞれの許諾条件が適用される。
