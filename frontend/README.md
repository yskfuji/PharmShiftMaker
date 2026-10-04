# PharmShiftMaker frontend

Node.js 24 / Next.js 16 / React 19を用いる。依存の正確な版は `package-lock.json` を参照すること。

起動手順は [ルートREADME](../README.md#合成データでのローカル起動) に、現在の合否・未完了事項は [検証記録](../docs/ideal-ui/verification.md) に記載している。

主画面は `/planning`、ログインは `/login` であり、`/schedule` 系の旧画面は互換経路を含む。トークンの表示名は本人判定に使用しない。API側の権限確認は、画面の表示制御とは別に必要である。

`npm run build`、`npm run lint`、`npm test` が、それぞれビルド、静的検査、単体試験の入口である。Playwright設定は、planning / completion / remediationの入力・試験世代を区別する。使用する設定と検証記録の出力先を明示すること。既存画像を一括更新しないこと。

自動検査、視覚的回帰試験、キーボード操作、実際の拡大表示、読み上げ、実職員による評価を区別して記録する。axeの違反ゼロのみでは、アクセシビリティ全体の合格としない。
