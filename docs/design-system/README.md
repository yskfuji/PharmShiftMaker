# デザインシステム・描画環境・視覚と光学の監査

## 2026-09-29 IA・UI改修の実行入口

新しい変更は [UI/UX契約](interaction-contract.md)、
[認知中心UIの説明](../ideal-ui/README.md)及び[検証記録](../ideal-ui/verification.md)に対応する。
詳細な生ログはリポジトリ外の隔離成果物領域に保全し、公開資料には要約、実行条件及び
SHA-256だけを残す。以下の過去の S0/S1/T 手順・数値は履歴であり、最新の正式評価には
公開候補と対応する隔離ビルドの証跡を用いる。

```sh
# .env はコピーしない。作業中の tsconfig / next-env は変更しない。
tools/node24/node_modules/node/bin/node devtools/visual/build.mjs /private/tmp/pharm-ui-build-<new-id> --linux
# 専用DBは pharmshift-ui-ux-db-r1 / loopback:55449、APIは18540。
# ブラウザはラベル付き pharmshift-ui-ux-browser-r1 / loopback:18526。
tools/node24/node_modules/node/bin/node devtools/visual/run.mjs \
  --run-id visual-ui-<new-id> --build-dir /private/tmp/pharm-ui-build-<new-id> \
  --storybook /private/tmp/pharm-ui-build-<new-id>/storybook --app .next \
  --postgres-ui --themes light,dark,system-light,system-dark
```

`--linux` は固定ローカルイメージとlockfileを使い、依存の導入とビルドを隔離コピー内だけで行う。LinuxブラウザとmacOS HTTPS配信を区別してmanifestへ記録する。

状態を書き換える業務フローは `--project chromium-linux` 等でブラウザごとに新しいrun IDを使い、正本を分離する。全役割・全操作の正式試験は既存 `scripts/dedicated_browser_acceptance.py` のケース別DBを使う。

既存の画像と比較するのが既定。新画面の初回は `--no-screenshots` で比較だけを省略して実画像・光学結果を採取し、**視覚回帰合格とはしない**。個別画像レビュー後にのみ基準画像を更新する。`--spec` は限定診断であり全操作評価ではない。
旧ビルドは `--legacy-diagnostic` に限る。新版manifestはアプリ・Storybook全成果物（生成キャッシュを除く）、ソース・検査器・ブラウザイメージIDを結び付ける。

SSRとブラウザのAPI接続先は共通のビルド値を使う。HTTPS/HTTPの本番起動では実行設定とビルド設定の不一致を拒否する。環境変更時には対応するビルドを作る。旧ビルドには契約情報がないため再ビルドが必要。
未設定の配色は明るい配色。端末設定を使う場合は `ps-theme=system` を明示する。



画面の見た目は、次の順で作り、確かめる。

1. トークン（色・文字・余白の値）
2. 部品（`frontend/src/components/ui`）
3. Storybook の見本
4. 画面

## 構成

| 置き場所 | 役割 |
|---|---|
| `frontend/.storybook/` | Storybook 10（`@storybook/nextjs-vite`）の設定。fetch は、見本ごとに登録した合成 JSON だけを返す（`fetchMock.ts`）。登録のない要求は失敗させる |
| `frontend/stories/` | 見本。`src` の外に置き、アプリのビルドと jest には入れない |
| `frontend/tests/visual/` | 視覚・光学の監査（`*.pw.ts`）。基準画像は `__screenshots__/`（chromium のみ）。新 workspace の構造の検査は `lib/structure.ts`（下の「構造の検査」） |
| `frontend/src/styles/workspace/` | 新 workspace（`/workspace`）専用のスタイルシート。全てのセレクターが `.ideal-v3-app` で始まり、文字の大きさと角丸は `scale.css` の変数だけを使う（`tests/test_workspace_v3_structure.py` が検査する） |
| `frontend/playwright.visual-linux.config.ts` | 監査の設定。ブラウザは、ラベル付きの Linux コンテナ（127.0.0.1:18526）で動かす |
| `devtools/visual/` | 実行器（`run.mjs`）、静的配信（`serve.mjs`）、集計（`summarize.py`） |
| `devtools/er/` | ER 図と情報設計の対応表の生成器。出力は `docs/architecture/er/` |

`tools/` は、持ち運び用の Node などの道具を置く場所で、`.gitignore` の対象である。版管理する生成器と監査の道具は、`devtools/` に置く。

## 安全の約束

- Storybook は 127.0.0.1 でだけ動かす。telemetry は無効で、Chromatic などへのアップロードはしない。
- 静的ビルドは、リポジトリの外（Claude のスクラッチ領域など）に出力し、公開しない。
  - ビルドのたびに、成果物に `.env*` の値が入っていないかを、値を表示せずに照合する。
  - `NEXT_PUBLIC_` で始まる値は公開用で、本物のアプリにも埋め込まれる。
  - CVE-2025-68429 は 10.1.10 で修正されている。いまの版は 10.6.0 である。
- 見本と監査は、合成データだけを使う。実際の職員・施設の情報を見本に書かない。
- 監査用のポートは、Storybook 18530、アプリ 18531、合成 API 18510、ブラウザ 18526 とする。
  - 通常環境（18500・18501）には触れない。
  - 正式受入（`scripts/dedicated_browser_acceptance.py`）の実行中には、監査を動かさない（同じ 18510 を使うため）。

## 監査の実行

```sh
# 1. ブラウザのコンテナ（ラベル付き、読み取り専用、権限なし）
docker run -d --name pharmshift-visual-browser-r1 --label pharmshift.synthetic-audit=true --user pwuser --read-only \
  --security-opt no-new-privileges --cap-drop ALL --tmpfs /tmp:rw,size=536870912 --shm-size 536870912 \
  -p 127.0.0.1:18526:3000 -e HOME=/tmp/pw-home -e XDG_CACHE_HOME=/tmp/pw-cache -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  -v "$PWD/frontend/node_modules/playwright:/tools/node_modules/playwright:ro" \
  -v "$PWD/frontend/node_modules/playwright-core:/tools/node_modules/playwright-core:ro" \
  mcr.microsoft.com/playwright:v1.56.1-noble sh -c 'mkdir -p "$HOME" "$XDG_CACHE_HOME" && exec node /tools/node_modules/playwright/cli.js run-server --host 0.0.0.0 --port 3000'

# 2. Storybook の静的ビルド（リポジトリの外へ）
cd frontend && STORYBOOK_DISABLE_TELEMETRY=1 ../tools/node24/node_modules/node/bin/node \
  node_modules/storybook/dist/bin/dispatcher.js build -o <scratch>/sb-static --disable-telemetry --quiet

# 3. アプリのビルド（API は https://127.0.0.1:18510）。ビルドの後、tsconfig.json と next-env.d.ts を元に戻す
NEXT_DIST_DIR=.next-visual-rN NEXT_PUBLIC_API_BASE_URL=https://127.0.0.1:18510 ../tools/node24/node_modules/node/bin/node \
  node_modules/next/dist/bin/next build --webpack

# 4. 監査（証拠は audit/<run-id>/。既存の出力は上書きしない）
cd .. && tools/node24/node_modules/node/bin/node devtools/visual/run.mjs --run-id visual-<日付>-rN \
  --storybook <scratch>/sb-static --app .next-visual-rN --themes light,dark
.venv/bin/python -m devtools.visual.summarize audit/visual-<日付>-rN
```

- **実行器が確かめること**：ポートが空いていること、ブラウザが動いていること、実行の前後でソース・見本・基準画像のハッシュが変わらないこと。
- **後片付け**：実行器は、自分で起動したものだけを止める。
- **API の接続先は起動時にも渡す**：以下は旧版の診断記録。新版のサーバー側の取得もビルド時の共通API値を使い、起動時に一致を確認する。実行器は監査用のアプリ（18531）にこの値を渡す。正式受入のフロントエンド（18511）を手で起動するときも、`NEXT_PUBLIC_API_BASE_URL=https://127.0.0.1:18510 NEXT_DIST_DIR=.next-visual-rN node scripts/start-https-server.mjs --hostname 127.0.0.1 --port 18511` のように渡す。渡さないと、既定の `https://localhost:8000` へ接続して失敗し、シフト表が「取得に失敗しました」になる（2026-09-28 に判明）。

## 検査の内容（WCAG 2.2 AA）

| 検査 | 基準 | 方法 |
|---|---|---|
| 文字のコントラスト 1.4.3 | 4.5:1（大きい文字は 3:1） | 表示されている文字ごとに、計算された文字色と、祖先の背景を合成した実際の背景色を比べる。背景が画像やグラデーションの場合は判定しない |
| 部品の輪郭 1.4.11 | 3:1 | 入力欄の枠線、または塗りの色と、外側の背景色を比べる |
| フォーカス 2.4.7・2.4.11 | 表示があり、3:1。隠れない | Tab キーで実際に移動し、輪郭と影のうち、最も対比の強い色を比べる。中心点の要素が自分か子孫であること |
| 操作対象の大きさ 2.5.8 | 24×24 CSS px | 文中のリンクは除く。ラベルが十分に大きいチェックボックスは除く |
| リフロー 1.4.10 | 幅 320px で横スクロールなし | 文書の幅と表示幅を比べる |
| 文字の間隔 1.4.12 | 行間1.5・字間0.12em・語間0.16em・段落後2em | style 属性で注入する（CSP で style 要素を入れられないため）。そのうえで、はみ出して切れた文字がないかを見る |

- axe（`@axe-core/playwright`）は、機能の E2E で使い続ける。ただし axe は、`text-base` の衝突（文字色と背景色が同じ）を見逃した（2026-09-28）。この検査はその補いである。
- APCA は、WCAG の勧告に入っていないので使わない。
- WebKit（Linux）は、既定の設定では Tab キーでリンクへ移らない。このため、リンクのフォーカスの検査は、chromium と firefox で行う。
- 2026-10-06 の変更：横にスクロールした表では、同じ表の固定セル（`position: sticky`）の下に入った文字を「表示されていない」と扱い、固定セルの横に見えている部分だけを判定する。変更前は「判定不能」になり、スクロールした表の監査が完了しなかった。固定セル以外の重なりは、従来どおり「判定不能」である。反例は `optical-pinned.pw.ts` にある。

## 構造の検査（新 workspace、2026-10-06 追加）

上の光学検査は、画面が未完成に見えるかどうかを判定しない。2026-10-06 に、光学検査の検出が 0 件の画面で、ラベルが 1 文字ずつ折り返すボタン、太さのない見出し、枠のない表、サーバーの値をそのまま出した表示が見つかった（経過は[検証記録](../ideal-ui/verification.md)の「Visual repair of the workspace and the fourth formal run」）。このため、新 workspace の枠（`.ideal-v3-app`）の内側に限って、次の検査を追加した。

`frontend/tests/visual/lib/structure.ts` は、描画結果を 1 回読み取り、計算値を報告する。画面を操作しない。

| 区分 | 検査 | 内容 |
|---|---|---|
| 検出（試験が失敗する） | `squeezed-label`・`squeezed-text` | 文字が 3 行以上に折り返し、1 行あたり平均 3 文字以下。又は、空白のない文字列が 1 行あたり平均 1.5 文字以下。又は、幅 6em 未満のボタンでラベルが折り返す |
| 検出 | `bare-heading` | 画面の内容の見出しの太さが 600 未満 |
| 検出 | `bare-table` | 表に枠（3 辺以上の罫線）がなく、見出し行の塗りも本体と同じ。又は直前の表との間隔が 8px 未満 |
| 検出 | `bare-list`・`bare-definition-list` | 印も枠も余白もない箇条書き。項目名と値の色・太さ・大きさが全て同じ定義リスト |
| 検出 | `variantless-button` | 背景も枠もないボタン |
| 検出 | `text-floor` | 12px 未満の本文（月間表のセルと外枠は注意にとどめる） |
| 検出 | `link-colour` | ボタンでないリンクの色が、リンクの色と異なる |
| 検出 | `machine-value` | ISO 8601 の日時、`UPPER_SNAKE` の値、既知の列挙値、「API」という語 |
| 注意（失敗しない） | `wrapped-label`・`narrow-text`・`heading-touches-content`・`text-outliers`・`planes`・`page-length`・`content-start` | 折り返したラベル、見出しと内容の間隔 4px 未満、1 枠内の文字の大きさが 5 種類以上、面の 4 重の入れ子、ページの長さ（1440px で 3 画面超、320px で 8 画面超）、320px での内容の開始位置 |

構造の検査が判定しないもの：

- 意味。見出しと内容の食い違い、同じことを言う 2 枚のカード、文の分かりやすさと正しさ、項目の順序は判定しない。
- 配置の揃い、余白、行の折返し位置（行頭の「）」や「ー」を含む）。
- 閉じた `<details>` の中。開いた状態は、下の `storybook-v3-open.pw.ts` だけが見る。
- `YYYY-MM-DD`・`YYYY-MM-DD HH:MM`・`HH:MM`（記録の表の書式として許す）、`schedule.published` のような記録種別（注意にとどめる）、`code` の中、識別子を見せるための開閉欄の中、`data-verbatim` を付けた要素（人が入力した文字をそのまま見せる箇所）。

検査を呼び出す spec：

| spec | 対象 | エンジン |
|---|---|---|
| `storybook-v3-roles.pw.ts`・`storybook-v3.pw.ts` | 役割×経路の 52 見本、代表の 25 見本（閉じた状態、4 配色 × 3 幅）。光学検査に構造の検査を加えた | 3 エンジン |
| `storybook-v3-states.pw.ts` | 状態の 150 見本（幅 390px）。構造の検査は、正常と空の 2 状態だけ | 3 エンジン |
| `storybook-v3-parts.pw.ts`（新設） | 共有部品の見本（「Ideal UI v3/Parts/」の全て。ビルドの index から読む）。光学検査と構造の検査 | 3 エンジン |
| `storybook-v3-open.pw.ts`（新設） | 25 経路の全ての `<details>` を開いた状態。コントラスト、操作対象の大きさ、320px のあふれ、文字間隔、構造の検査。明るい配色、320px と 1440px | chromium だけ（設計上。ほかの 2 エンジンは skip） |
| `structure-counter.pw.ts`（新設） | 検出ごとの反例（欠陥のあるページは報告され、直したページは報告されない）と、設計どおりのマークアップ | 3 エンジン |
| `optical-pinned.pw.ts`（新設） | 固定セルの扱いの反例 | 3 エンジン |
| `tests/remediation-e2e/ideal-deep-*.spec.ts` の `finishAudit` | 業務系列の最後の画面。axe、光学検査、構造の検査 | 3 エンジン |

- `storybook-v3-open.pw.ts` は、Tab キーでの移動をしないので、開いた状態のフォーカスを検査しない。入力も送信もしないので、確認面・拒否・保存後の状態には到達しない。見本の合成応答が答えられない読取りは、注意（`synthetic-gap`）として経路名を記録する。その操作を合格とは扱わない。
- 集計（`devtools/visual/summarize.py`）は、構造の検出と注意を、光学の検出と分けて数える。
- `frontend/playwright.visual-local.config.ts` は、手元の Chromium で検査を繰り返すための診断用の設定である。証拠には使わない。

### 行列を分割して実行する

ブラウザのコンテナの `/tmp` は 512MiB の tmpfs である。Playwright のサーバーは、1 つの接続（worker）が続く間、試験ごとの trace の記録を `/tmp` に置き、接続が終わると解放する。行列全体を 1 つの接続で実行すると、役割×経路の行列は 1 エンジンあたり約 0.8〜1.2GiB、代表の行列は約 0.4〜0.7GiB を必要とし（2026-10-06 の測定）、Chromium では、上限に達した時点で全画面撮影が失敗した（2026-10-05・10-06 の正式実行で、役割×経路が 155/156 になった原因）。Firefox と WebKit で上限に達したときに何が起きるかは、調べていない。

このため、実行器の `--project <エンジン>` と `--shard k/M` で分割する。2026-10-07 の正式実行（第 4 回）では、役割×経路を各エンジン 8 分割（24 回）、代表を 4 分割（12 回）、共有部品を 3 分割（9 回）、状態・全開・反例を各 1 回、計 48 回で実行した。`/tmp` の最大は 225MiB であった。分割したときは、各回が実行した試験を、分割なしの試験の一覧（Playwright の `--list`）と突き合わせ、欠け・余分・重複がないことを確かめる。

## 基準画像

- 基準画像は、`VISUAL_BASELINE_UPDATE=1`（実行器の `--update-baselines`）のときだけ書き換える。
- 書き換えるたびに、理由を `baseline-log.md` に記録する。
- 閾値は `maxDiffPixelRatio: 0.002` とする。
- 撮影を安定させるため、時刻を固定し、フォントの読み込みを待ち、アニメーションを止め、キャレットを隠す。
