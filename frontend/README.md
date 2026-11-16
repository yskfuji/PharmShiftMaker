# PharmShiftMaker フロントエンド

本書は、`frontend/` に置く画面（フロントエンド）の実行環境、起動手順、画面の経路並びにビルド及びテストの入口を記録する。

## 1. 実行環境

本フロントエンドは、Node.js 26.12.1（リポジトリ直下の `.nvmrc`）、Next.js 16 及び React 19 を用いる。依存ソフトウェアの正確な版は、`package-lock.json` を参照する。

## 2. 起動手順及び検証記録

起動手順は、[合成データでのローカル起動（開発者向け）](../docs/local-isolated-preview.md) に記載する。現在の合否及び残件は、[検証記録](../docs/ideal-ui/verification.md) に記載する。

## 3. 画面の経路及び権限

主画面は `/planning`、ログイン画面は `/login` である。`/schedule` 系の旧画面は、互換経路を含む。

トークンの表示名は、本人の判定に使用しない。API 側の権限確認は、画面の表示制御とは別に要する。

## 4. ビルド及びテスト

`npm run build`、`npm run lint` 及び `npm test` が、それぞれビルド、静的検査及び単体テストの入口である。

Playwright の設定ファイルは、開発の段階ごとに異なる入力及び E2E テストを区別するため、`playwright.planning.config.ts`、`playwright.completion.config.ts`、`playwright.remediation.config.ts` 等に分かれている。E2E テストを実行する者は、使用する設定及び証拠の出力先を明示しなければならない。既存の画像を一括して更新してはならない。

## 5. 検証の記録

自動検査、画像比較、キーボード操作、実際の拡大表示、読み上げ及び実際の職員による評価は、それぞれ分けて記録する。axe の違反が0件であることだけをもって、アクセシビリティ全体の合格としない。
