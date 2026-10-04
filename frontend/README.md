# PharmShiftMaker frontend

Node.js 24 / Next.js 16 / React 19。依存の正確な版は `package-lock.json` を参照してください。

起動手順は [ルートREADME](../README.md#合成データでのローカル起動)、現在の合否・残件は [検証記録](../docs/ideal-ui/verification.md) に記載しています。

主画面は `/planning`、ログインは `/login`。`/schedule` 系の旧画面は互換経路を含みます。トークンの表示名を本人判定に使用しません。API側の権限確認は画面の表示制御とは別に必要です。

`npm run build`、`npm run lint`、`npm test` がビルド・静的検査・単体試験の入口です。Playwright設定は planning / completion / remediation の入力・試験世代を区別します。使う設定と証拠出力先を明示し、既存画像を一括更新しないでください。

自動検査、画像比較、キーボード、実拡大、読み上げ、実職員評価を分けて記録します。axeの違反ゼロだけでアクセシビリティ全体の合格としません。
