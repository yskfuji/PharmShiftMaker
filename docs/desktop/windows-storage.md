# Windows での管理対象ファイルの保管（M3）

本書は、デスクトップ版（`PHARMSHIFT_ENV=desktop`）の API が Windows で管理対象ファイルを保管するときの安全上の約束と、その実装を記録するものです。対象のコードは `src/shift_scheduler/ops/platform_fs.py` と、それを呼び出す管理対象ファイルのモジュールです。

## 1. 位置付け

1. 本書は、設計上の判断の記録（ADR）です。Windows 版の配布物の品質や、薬剤部での試行運用の安全性を保証するものではありません。
2. 保管の方式は「ACL による締め出し（ACL lock-out）」です。この方式は、所有者が選んだものです。本書は、この方式を弱めることも、強めることもしません。
3. POSIX（macOS・Linux）の動作は変えていません。POSIX では、`platform_fs` の各関数が、以前の呼出し元と同じシステムコール（同じフラグ、同じ `dir_fd`、同じ権限の値）を発行します。この一致は、`tests/test_platform_fs.py` の `test_posix_layer_issues_the_same_system_calls` が確かめます。

## 2. 脅威モデル

### 2.1 対象とする攻撃

1. 同じパソコンにログオンできる、管理者ではない別の利用者が、データフォルダーの中身を読むこと、書き換えること、消すこと。
2. 同じ利用者が、データフォルダーに置かれたリンクや再解析ポイント（シンボリックリンク、ジャンクション、マウントポイント）を使って、API にデータフォルダーの外のファイルを読ませること、書かせること、消させること。この種の誤りは、利用者の操作ミスや、別のソフトウェアの動作でも起こりえます。
3. ネットワーク上の共有フォルダーや、取り外せるドライブに、データが置かれること。

### 2.2 対象としない攻撃

1. 同じ OS の利用者として動くプログラムによる攻撃。そのプログラムは、API と同じ権限を持つため、データを直接読めます。
2. 管理者（BUILTIN\Administrators）または SYSTEM として動くプログラムによる攻撃。これらは、ACL を書き換えることも、所有権を取得することもできます。
3. パソコンの盗難、ディスクの取り外し、休止状態のファイルからの読出し。これらへの対策は、BitLocker などの暗号化です。本書の範囲外です。

## 3. データフォルダーの準備

1. デスクトップの起動役（`shift_scheduler.desktop`）は、起動のたびに、データフォルダーと、その配下のフォルダー（`state`、`state\tls`、`storage`、`logs`）のそれぞれに、`platform_fs.prepare_data_dir()` を同じ Python の中で呼びます。既定の場所は `%LOCALAPPDATA%\PharmShiftMaker` です。配下のフォルダーにもそれぞれ保護された DACL を設定するのは、API の起動時の検査（4章）が、管理対象ファイルのフォルダー（`storage`）そのものに、継承しない DACL を求めるためです。手作業で同じ処理を行うときは、次のコマンドを使えます。

   ```text
   python -m shift_scheduler.ops.platform_fs prepare-data-dir <絶対パス>
   ```

2. この処理は、次の順に進みます。コマンドとして実行したときは、成功すると、標準出力に `{"ok": true, "path": ...}` を1行出し、終了コード0で終わります。失敗すると、標準エラーに `{"ok": false, "error": ...}` を出し、終了コード1で終わります。
   1. UNC パス（`\\server\share`、`\\?\UNC\...`）、ドライブ文字のないパス（`\data` など。Python 3.12 はこれを絶対パスとみなしますが、拒否します）、相対パスを拒否します。
   2. `GetDriveTypeW` で、ドライブが固定ドライブ（`DRIVE_FIXED`）であることを確かめます。ネットワークドライブ（`DRIVE_REMOTE`）、取り外せるドライブ、光学ドライブ、RAM ディスクは拒否します。
   3. すでにある親フォルダーのすべての構成要素を `os.lstat` で調べ、リンクや再解析ポイントがあれば、何も作らずに拒否します。
   4. フォルダーを作り、改めてすべての構成要素を調べます。
   5. フォルダーの所有者が、現在の利用者、SYSTEM、Administrators のどれかであることを確かめます。ほかの所有者のフォルダーは、DACL を変える前に拒否します。
   6. 保護された DACL（継承なし）を設定します。許可するのは、現在の利用者の SID、SYSTEM（`S-1-5-18`）、BUILTIN\Administrators（`S-1-5-32-544`）だけです。SDDL では `D:P(A;OICI;FA;;;<利用者のSID>)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)` です。配下に作るファイルとフォルダーは、この3つの許可だけを継承します。
   7. 起動時と同じ検査（4章）を行い、合格しなければ失敗とします。
3. すでにあるフォルダーに対して実行しても、同じ DACL を設定し直すだけです。
4. 殻は、Python を UTF-8 モード（環境変数 `PYTHONUTF8=1`）で起動します。既存のコードの一部は、文字コードを指定せずにファイルを読み書きします。Windows の既定の文字コード（cp932 など）では、日本語を含むファイルを正しく扱えないためです。
5. POSIX でも同じコマンドを使えます。POSIX では、フォルダーを権限 `0700` で作り、リンクを経由しないこと、所有者が自分であることを確かめます。

## 4. 起動時の検査

1. `config/desktop.py` の `check_desktop()` は、Windows では、以前の「起動しない」という一律の拒否をやめ、次の検査を行います。どれかに該当すると、起動を止めます。
   1. UNC パス、ドライブ文字のないパス：`Desktop managed storage must be on this PC, not a share`
   2. ネットワークドライブ：同じ文言です。
   3. 固定ドライブ以外：`Desktop managed storage must be on a fixed drive of this PC`
   4. パスのどこかにリンクや再解析ポイントがある：`Desktop managed storage must not go through a link`
   5. 所有者が、現在の利用者、SYSTEM、Administrators のどれでもない：`Desktop managed storage must belong to this user`
   6. DACL が「ACL による締め出し」に合わない：`Desktop managed storage must be private to this user`。括弧の中に、合わない点（継承している、ほかの SID に許可している、など）を書き添えます。
2. 文言は、既存の POSIX の検査に合わせて英語のままにしています。
3. DACL の検査では、次のものを不合格とします。
   1. DACL がないこと（NULL DACL。全員に許可したのと同じです）。
   2. 継承が有効であること（データフォルダーそのものだけに求めます）。
   3. 許可のエントリーが、現在の利用者、SYSTEM、Administrators 以外の SID を含むこと。
   4. 許可・拒否以外の種類のエントリー（オブジェクト、コールバック、複合）があること。これらは解釈せずに拒否します。
   5. 現在の利用者の許可エントリーがないこと。
4. 拒否のエントリーは、権限を狭めるだけなので、受け入れます。

## 5. POSIX の保証と Windows での対応

| POSIX での保証 | POSIX の実装（変更なし） | Windows での対応 |
|---|---|---|
| データフォルダーを自分だけが使える | 権限が `0700`、所有者が自分（`st_uid == getuid()`） | 保護された DACL。許可は利用者・SYSTEM・Administrators だけ。所有者も同じ3つのどれか |
| 隔離フォルダー（`.erasure`）が非公開 | `S_IMODE(st_mode) & 0o077 == 0` | DACL の検査（継承は許します。データフォルダーの DACL を継承するためです）。隔離フォルダーを作るとき、`os.mkdir` に `0o700` を渡しません。CPython 3.12.4 以降の Windows 版では、`0o700` を渡すと、OWNER RIGHTS（`S-1-3-4`）を含む独自の保護された DACL が付き、この検査に合わなくなるためです |
| 最後の構成要素のリンクをたどらない | `O_NOFOLLOW` | 開く前に `os.lstat` でリンクと再解析ポイントを拒否し、開いた後に `os.fstat` と `os.lstat` の識別子（`st_dev`、`st_ino`）を比べます |
| 途中の構成要素のリンクをたどらない | `O_DIRECTORY \| O_NOFOLLOW` で開いたディレクトリの記述子からの相対オープン（`dir_fd`） | ドライブのルートから最後までの全構成要素を、操作のたびに `os.lstat` で調べます |
| 開いたディレクトリが信頼の起点 | ディレクトリの記述子を保持 | 開いた時点のパスと識別子を保持し、操作のたびに、同じ識別子のディレクトリがそのパスにあることを確かめます |
| 排他ロック | `fcntl.flock`（`LOCK_EX`、`LOCK_EX \| LOCK_NB`） | `LockFileEx`（先頭の1バイト、排他）。待たない版の失敗は `BlockingIOError` にします。閉じる前に `UnlockFileEx` で解放します |
| 公開の原子性と上書きの拒否 | `os.link`（既存の名前があれば失敗） | `os.link`（`CreateHardLinkW`。既存の名前があれば失敗） |
| 移動先の上書き | `os.rename`（POSIX では置き換えます。呼出し元が先に存在を確かめています） | `os.rename`（Windows では置き換えずに失敗します） |
| 複数のリンクを持つファイルの消去を拒否 | `st_nlink != 1` を拒否 | 同じ検査をそのまま使います（`os.fstat` が `nNumberOfLinks` を返します） |
| ディレクトリの更新の永続化 | ディレクトリの記述子の `fsync` | 何もしません（6章） |
| 改行の変換をしない | なし（POSIX は変換しません） | `os.open` に `O_BINARY` を加えます |

## 6. POSIX より弱い点と、受け入れる理由

1. **ディレクトリを記述子で固定しません。** Windows には `dir_fd` がありません。このため、確認してから開くまでの間に、途中のフォルダーを入れ替えられる余地が残ります。入れ替えるには、データフォルダーへの書込み権限が必要です。DACL により、その権限を持つのは、対象外とした利用者自身、管理者、SYSTEM だけです。加えて、操作のたびに構成要素と識別子を確かめるため、入れ替えの多くは検出できます。
2. **最後の構成要素の確認と、開く操作の間に隙間があります。** `os.open` は再解析ポイントをたどります。このため、`os.lstat` の後、開くまでの間にリンクへ置き換えられると、いったんはリンク先を開きます。開いた後に識別子を比べて拒否しますが、`O_CREAT` や `O_TRUNC` を伴う場合は、拒否より前にリンク先のファイルが作られる、または切り詰められる可能性があります。置き換えには、1と同じくデータフォルダーへの書込み権限が必要です。なお、`os.open` が開いたファイルは、閉じるまで名前の変更や削除ができないはずです。C ランタイムの既定の共有モードが、削除（`FILE_SHARE_DELETE`）を含まないためです。この点は、試験では確かめていません（7章）。
3. **ディレクトリの `fsync` をしません。** Python の `os.open` では、Windows のディレクトリを開けません。NTFS は、ファイル名の作成・変更・削除を自身のログで保護し、電源断の後も壊れない状態に戻します。ただし、直前の変更が残る保証はありません。管理対象ファイルの書込みは、データベースの意図（`WRITING`、`CAPTURING` など）を先に記録し、再試行と照合で回復する設計です。このため、最後の名前の変更が失われても、記録のない公開は起こりません。
4. **すべての再解析ポイントを拒否します。** OneDrive のプレースホルダーや重複除去など、無害な再解析ポイントも拒否します。安全側に倒した結果であり、データフォルダーを `%LOCALAPPDATA%` の配下に置く前提では、通常は問題になりません。
5. **ロックは強制ロックです。** `LockFileEx` のロックは、ロックした範囲への他の読み書きを妨げます。ロック用のファイル（`.lock-<ID>`、`.lock`）は中身を持たず、読み書きしないため、影響はありません。

## 7. 未確認の事項

1. Windows での動作は、ローカルの開発機（macOS）では確かめていません。Windows 固有の処理は、CI の2つのジョブ（`windows-latest`、どちらも必須ではない検査）でだけ実行されます。
   - 「Desktop (Windows, unsigned)」は、同梱の実行環境（python-build-standalone 3.12.15、PostgreSQL、Node.js）を組み立て、起動役の試験と、組み立てたアプリの試験を行います。データフォルダーの DACL が保護され、現在の利用者、SYSTEM、Administrators だけに許可していることも確かめます。
   - 「Backend (Windows)」は、PostgreSQL を使わない次の試験だけを実行します：`tests/test_platform_fs.py`、`tests/test_desktop_local_auth.py`、`tests/test_managed_writer.py`、`tests/test_erasure_control.py`、`tests/test_desktop_launcher.py`、`tests/test_desktop_launcher_process.py`、`tests/test_windows_lock.py`。ただし、`test_managed_writer.py` の `test_crash_after_publication_before_ack_and_suppression_during_write` は除きます。この試験は、ディレクトリの `fsync` に障害を注入しますが、Windows ではその `fsync` を呼ばないためです。同じ障害は、`test_platform_fs.py` の `test_failure_after_publication_is_retried` が、`platform_fs` に注入して確かめます。
2. どちらのジョブも、依存を `desktop/requirements-windows.lock` からハッシュを照合して入れます。この一覧の版は `requirements.lock` と同じで、`uvloop`（POSIX 専用）を除き、`colorama`（Windows 専用）を加えています。版とハッシュが `requirements.lock` とずれないことは、`tests/test_windows_lock.py` が確かめます。「Backend (Windows)」の Python は、同梱するものではなく、setup-python が提供する最新の 3.12 です。
3. 次の点は、実機でも CI でも確かめていません。
   1. 同梱する python-build-standalone 3.12.15 での、起動の試験以外の操作（勤務表の作成、出力など）。
   2. 管理者ではない利用者のアカウントでの動作（GitHub のランナーは管理者として動きます）。
   3. 別の利用者のアカウントから、実際にデータフォルダーを開けないこと。
   4. ReFS や Dev Drive での、`st_ino` と `st_dev` の比較の動作。
   5. ウイルス対策ソフトがファイルを一時的に開いたままにする場合の、名前の変更と削除の失敗。
   6. `os.open` で開いたファイルを、閉じるまで別のプロセスが名前の変更・削除できないこと（6章の2）。
4. 次の2つのモジュールは、Windows では使えません。どちらも、復元の `policy_hash` と照合の `code_hash` にバイト列が組み込まれているため、変更していません（`tests/test_type_shadow.py` の説明を参照してください）。
   1. `application/storage_reconciliation.py` の `_safe_file_hash()` は `os.O_DIRECTORY` を参照します。Windows では `AttributeError` になり、ファイルの照合（`file_observation`）は完了しません。
   2. `application/storage_routes.py` の書込み経路の一覧は、パスを `str()` で作ります。Windows では区切りが `\` になり、登録済みの一覧と一致しません。
   この2つを Windows に対応させるには、`policy_hash` と `code_hash` の変更を伴います。その判断は、別に行います。
5. `scripts/` 配下の評価用スクリプトの一部は、`fcntl` などの POSIX 専用の機能を使います。これらは配布物に含めないため、対象外です。
6. 書込み経路の一覧（`application/storage_routes.json`）を更新しました。`platform_fs` に移した呼出し7件の登録を外し、`platform_fs` の `os.open` 3件を、状態 `UNVERIFIED` で登録しました。この一覧は照合の `code_hash` の入力に含まれるため、`code_hash` は変わり、以前の照合の報告は古いものとして扱われます。一覧の検出器は、`platform_fs.open_at` と `open_path` の呼出し元を検出できません。そこで、`tests/test_platform_fs.py` の `test_every_delegated_open_is_a_reviewed_call_site` が、呼出し元とフラグの完全な一覧を固定します。
