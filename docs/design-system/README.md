# デザインシステム・描画環境・視覚と光学の監査

本書は、画面の見た目を作り確かめる順序、描画環境並びに視覚及び光学の監査の手順について定める。

## 1. 実行の入口

新しい変更は、[UI/UX契約](interaction-contract.md)、[認知中心UIの説明](../ideal-ui/README.md)及び[検証記録](../ideal-ui/verification.md)に対応させるものとする。
詳細な生ログは、リポジトリ外の隔離した成果物の保管領域に保全する。公開資料には、要約、実行条件及び SHA-256 だけを残す。
本書の第2節以降に記載する従来の手順及び数値は履歴である。最新の正式評価には、公開候補と対応する隔離ビルドの証跡を用いる。

```sh
# .env はコピーしない。作業中の tsconfig / next-env は変更しない。
node devtools/visual/build.mjs /private/tmp/pharm-ui-build-<新しいID> --linux
# 専用DBは pharmshift-ui-ux-db-r1 / loopback:55449、APIは18540。
# ブラウザはラベル付き pharmshift-ui-ux-browser-r1 / loopback:18526。
node devtools/visual/run.mjs \
  --run-id visual-<新しい実行ID> --build-dir /private/tmp/pharm-ui-build-<新しいID> \
  --storybook /private/tmp/pharm-ui-build-<新しいID>/storybook --app .next \
  --postgres-ui --themes light,dark,system-light,system-dark
```

> **注記** コマンド中の `node` は、固定した版の Node.js の実行ファイルを指す。ビルド先は、`build.mjs` の制約により、`/private/tmp/` の下に新しく作るディレクトリに限る。

`--linux` は、固定したローカルのイメージ及びロックファイルを使い、依存関係の導入とビルドを隔離したコピーの中だけで行う。実行器は、Linux のブラウザと macOS の HTTPS 配信とを区別してマニフェストへ記録する。

状態を書き換える業務フローは、`--project chromium-linux` 等でブラウザごとに新しい実行IDを使い、記録の正本を分けるものとする。全役割及び全操作の正式なテストには、既存の `scripts/dedicated_browser_acceptance.py` のケース別のDBを使う。

既定の動作は、既存の画像との比較である。新しい画面の初回は、`--no-screenshots` で比較だけを省略し、実際の画像と光学検査の結果を採取する。この場合は、**視覚回帰の合格とはしない**。基準画像は、画像を1枚ずつレビューした後に限り更新する。`--spec` は限定的な診断であり、全操作の評価ではない。
旧ビルドは、`--legacy-diagnostic` の場合に限り使う。新版のマニフェストは、アプリ及び Storybook の全成果物（生成キャッシュを除く）、ソース、検査器並びにブラウザのイメージIDを結び付ける。

SSR とブラウザとは、API の接続先として共通のビルド値を使う。HTTPS 又は HTTP の本番起動では、本ソフトウェアは実行設定とビルド設定との不一致を拒否する。環境を変更したときは、対応するビルドを作る。旧ビルドには契約情報がないため、再ビルドを要する。
配色が未設定の場合は、明るい配色となる。端末の設定を使う場合は、`ps-theme=system` を明示する。

## 2. 画面の作成と確認の順序

画面の見た目は、次の順で作り、確かめる。

1. トークン（色・文字・余白の値）
2. 部品（`frontend/src/components/ui`）
3. Storybook の見本
4. 画面

## 3. 構成

| 置き場所 | 役割 |
|---|---|
| `frontend/.storybook/` | Storybook 10（`@storybook/nextjs-vite`）の設定。`fetch` は、見本ごとに登録した合成 JSON だけを返す（`fetchMock.ts`）。登録のない要求は失敗させる |
| `frontend/stories/` | 見本。`src` の外に置き、アプリのビルドと Jest には入れない |
| `frontend/tests/visual/` | 視覚・光学の監査（`*.pw.ts`）。基準画像は `__screenshots__/`（Chromium のみ） |
| `frontend/playwright.visual-linux.config.ts` | 監査の設定。ブラウザは、ラベル付きの Linux コンテナ（127.0.0.1:18526）で動かす |
| `devtools/visual/` | 実行器（`run.mjs`）、静的配信（`serve.mjs`）、集計（`summarize.py`） |
| `devtools/er/` | ER 図と情報設計の対応表の生成器。出力は `docs/architecture/er/` |

版管理する生成器及び監査の道具は、`devtools/` に置く。

## 4. 安全上の遵守事項

- Storybook は、127.0.0.1 でだけ動かす。利用状況の送信（テレメトリ）は無効とし、Chromatic などへのアップロードはしない。
- 静的ビルドは、リポジトリ外の一時ディレクトリに出力し、公開しない。
  - ビルドのたびに、成果物に `.env*` の値が入っていないかを、値を表示せずに照合する。
  - `NEXT_PUBLIC_` で始まる値は公開用であり、本物のアプリにも埋め込まれる。
  - CVE-2025-68429 は 10.1.10 で修正されている。現在の版は 10.6.0 である。
- 見本及び監査には、合成データだけを使う。実際の職員及び施設の情報を見本に書いてはならない。
- 監査用のポートは、Storybook 18530、アプリ 18531、合成 API 18510、ブラウザ 18526 とする。
  - 通常環境（18500・18501）には触れない。
  - 正式受入（`scripts/dedicated_browser_acceptance.py`）の実行中には、監査を動かさない（同じ 18510 を使うため）。

## 5. 監査の実行

```sh
# 1. ブラウザのコンテナ（ラベル付き、読み取り専用、権限なし）
docker run -d --name pharmshift-visual-browser-r1 --label pharmshift.synthetic-audit=true --user pwuser --read-only \
  --security-opt no-new-privileges --cap-drop ALL --tmpfs /tmp:rw,size=536870912 --shm-size 536870912 \
  -p 127.0.0.1:18526:3000 -e HOME=/tmp/pw-home -e XDG_CACHE_HOME=/tmp/pw-cache -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD/frontend/node_modules/playwright:/tools/node_modules/playwright:ro" \
  -v "$PWD/frontend/node_modules/playwright-core:/tools/node_modules/playwright-core:ro" \
  mcr.microsoft.com/playwright:v1.56.1-noble sh -c 'mkdir -p "$HOME" "$XDG_CACHE_HOME" && exec node /tools/node_modules/playwright/cli.js run-server --host 0.0.0.0 --port 3000'

# 2. Storybook の静的ビルド（リポジトリの外へ）
cd frontend && STORYBOOK_DISABLE_TELEMETRY=1 node \
  node_modules/storybook/dist/bin/dispatcher.js build -o <一時ディレクトリ>/sb-static --disable-telemetry --quiet

# 3. アプリのビルド（API は https://127.0.0.1:18510）。ビルドの後、tsconfig.json と next-env.d.ts を元に戻す
NEXT_DIST_DIR=.next-visual-rN NEXT_PUBLIC_API_BASE_URL=https://127.0.0.1:18510 node \
  node_modules/next/dist/bin/next build --webpack

# 4. 監査（証拠は audit/<実行ID>/ に書き出す。既存の出力は上書きしない）
cd .. && node devtools/visual/run.mjs --run-id visual-<新しい実行ID> \
  --storybook <一時ディレクトリ>/sb-static --app .next-visual-rN --themes light,dark
.venv/bin/python -m devtools.visual.summarize audit/visual-<新しい実行ID>
```

> **注記** 第1節の注記のとおり、`node` は固定した版の Node.js の実行ファイルを、`<一時ディレクトリ>` はリポジトリ外の一時ディレクトリを指す。

- **実行器が確かめる事項**：実行器は、ポートが空いていること、ブラウザが動いていること、並びに実行の前後でソース、見本及び基準画像のハッシュが変わらないことを確かめる。
- **後片付け**：実行器は、自分で起動したものだけを止める。
- **API の接続先は起動時にも渡す**：以下は旧版の診断記録である。新版では、サーバー側の取得もビルド時の共通の API の値を使い、起動時に一致を確認する。実行器は、監査用のアプリ（18531）にこの値を渡す。正式受入のフロントエンド（18511）を手で起動するときも、`NEXT_PUBLIC_API_BASE_URL=https://127.0.0.1:18510 NEXT_DIST_DIR=.next-visual-rN node scripts/start-https-server.mjs --hostname 127.0.0.1 --port 18511` のように渡す。渡さない場合は、既定の `https://localhost:8000` へ接続して失敗し、シフト表が「取得に失敗しました」になる（2026年9月28日に判明）。

## 6. 検査の内容（WCAG 2.2 AA）

| 検査 | 基準 | 方法 |
|---|---|---|
| 文字のコントラスト 1.4.3 | 4.5:1（大きい文字は 3:1） | 表示されている文字ごとに、計算された文字色と、祖先の背景を合成した実際の背景色とを比べる。背景が画像又はグラデーションの場合は判定しない |
| 部品の輪郭 1.4.11 | 3:1 | 入力欄の枠線又は塗りの色と、外側の背景色とを比べる |
| フォーカス 2.4.7・2.4.11 | 表示があり、3:1。隠れない | Tab キーで実際に移動し、輪郭と影のうち最も対比の強い色を比べる。中心点の要素が自分又は子孫であること |
| 操作対象の大きさ 2.5.8 | 24×24 CSS px | 文中のリンクを除く。ラベルが十分に大きいチェックボックスを除く |
| リフロー 1.4.10 | 幅 320px で横スクロールなし | 文書の幅と表示幅とを比べる |
| 文字の間隔 1.4.12 | 行間1.5・字間0.12em・語間0.16em・段落後2em | style 属性で注入する（CSP で style 要素を入れられないため）。そのうえで、はみ出して切れた文字がないかを見る |

- axe（`@axe-core/playwright`）は、機能の E2E テストで引き続き使う。ただし、axe は `text-base` の衝突（文字色と背景色が同じ）を見逃した（2026年9月28日）。本節の検査は、その見逃しを補うものである。
- APCA は、WCAG の勧告に入っていないので使わない。
- WebKit（Linux）は、既定の設定では Tab キーでリンクへ移らない。このため、リンクのフォーカスの検査は Chromium 及び Firefox で行う。

## 7. 基準画像

- 基準画像は、`VISUAL_BASELINE_UPDATE=1`（実行器の `--update-baselines`）のときに限り書き換える。
- 基準画像を書き換えるときは、理由をプルリクエストの説明に記録するものとする。
- 閾値は `maxDiffPixelRatio: 0.002` とする。
- 撮影を安定させるため、時刻を固定し、フォントの読み込みを待ち、アニメーションを止め、キャレットを隠す。

## 8. 改訂履歴

| 日付 | 内容 |
|---|---|
| 2026-09-29 | IA・UI改修の実行入口（第1節）を記載した。 |
