# macOS 版の署名と公証に使う資格情報の登録手順

本書は、デスクトップ版の macOS 用配布物に署名し、Apple の公証（notarization）を受けるために、所有者が GitHub に資格情報を登録する手順を定めるものです。

## 1. 位置付け

1. 署名と公証に使う証明書と秘密鍵は、所有者だけが扱います。開発を支援する AI を含め、ほかの者に渡したり、チャットや Issue に貼り付けたりしないでください。
2. 資格情報は、GitHub の environment「`desktop-release`」の secrets に登録します。この environment を使うジョブは、所有者の承認を得てから動きます。
3. 登録が済むまで、配布のワークフローは署名と公証を行わずに配布物を作ります。署名のない配布物は、検証だけに使います。

## 2. 用意するもの

1. Apple Developer Program のアカウント（Account Holder の役割が必要です。Developer ID の証明書を作れるのは Account Holder だけです）。
2. Xcode の入った Mac、又は「キーチェーンアクセス」を使える Mac。
3. GitHub CLI（`gh`）。所有者のアカウント（`yskfuji`）でログインしておきます。

## 3. Developer ID Application 証明書

1. Mac の「キーチェーンアクセス」で、［キーチェーンアクセス］→［証明書アシスタント］→［認証局に証明書を要求］を選び、証明書署名要求（CSR）をディスクに保存します。
2. Apple Developer のサイトで、［Certificates, Identifiers & Profiles］→［Certificates］→［＋］を選び、「Developer ID Application」を選びます。前号の CSR を読み込ませ、証明書（`.cer`）をダウンロードします。
3. ダウンロードした `.cer` を開き、キーチェーンに取り込みます。
4. キーチェーンアクセスの［自分の証明書］で、「Developer ID Application: …」とその秘密鍵を選び、［書き出す］で `.p12` 形式に書き出します。書き出しのときに、強いパスワードを設定します。
5. `.p12` ファイルとパスワードは、パスワード管理ソフトなど、安全な場所に保管します。

## 4. App Store Connect API キー（公証用）

1. App Store Connect で、［ユーザとアクセス］→［統合］→［App Store Connect API］→［チームキー］を開き、新しいキーを作ります。アクセスの役割は「Developer」とします。
2. キー（`.p8` ファイル）は、作成直後に1回だけダウンロードできます。安全な場所に保管します。
3. 画面に表示される「キー ID」と「Issuer ID」を控えます。

## 5. GitHub の environment と secrets

1. リポジトリの［Settings］→［Environments］→［New environment］で、名前を `desktop-release` とする environment を作ります。
2. 作った environment で、次の設定をします。
   - ［Required reviewers］に、所有者自身を加えます。
   - ［Deployment branches and tags］を［Selected branches and tags］にし、`main` と、タグ `desktop-v*` を加えます。
3. ターミナルで、次のコマンドを実行して secrets を登録します。ファイルの中身は、標準入力から直接渡します。画面やクリップボードには出しません。

```sh
R=yskfuji/PharmShiftMaker
base64 -i DeveloperIDApplication.p12 | gh secret set MACOS_CERTIFICATE_P12_BASE64 --env desktop-release -R "$R"
gh secret set MACOS_CERTIFICATE_PASSWORD --env desktop-release -R "$R"   # 入力を求められたら .p12 のパスワードを入れます
base64 -i AuthKey_XXXXXXXXXX.p8 | gh secret set APPLE_API_KEY_P8_BASE64 --env desktop-release -R "$R"
gh secret set APPLE_API_KEY_ID --env desktop-release -R "$R"            # キー ID
gh secret set APPLE_API_ISSUER_ID --env desktop-release -R "$R"         # Issuer ID
gh secret set APPLE_TEAM_ID --env desktop-release -R "$R"               # チーム ID（10文字）
```

4. 登録できたことは、次のコマンドで名前だけを確かめられます（値は表示されません）。

```sh
gh secret list --env desktop-release -R yskfuji/PharmShiftMaker
```

## 6. 登録した後

1. 登録が済んだことを、開発の担当に伝えてください。担当は、署名と公証を行う配布のワークフローを実行します。実行の前に、GitHub から所有者に承認の依頼が届きます。
2. 証明書や API キーを失効させるときは、Apple Developer と App Store Connect で失効させた後、前節の secrets を削除します。
3. 証明書の有効期限は5年です。期限の前に、本書の手順で作り直します。
