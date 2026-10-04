# 公開・法務・運用文書の根拠と限界

本表は、公開時の判断根拠と、その根拠からは結論できない事項を分けるためのものである。法令適合は統計的仮説ではなく、適用法令等、契約、対象情報及び運用実態に基づく判断である。試験成功率又はコードカバレッジから推定しない。

根拠資料の版及び掲載状況は、2026年10月4日に各公表機関の公式ページで確認した。公開後も改訂の有無を確認し、導入時点の最新版を用いる必要がある。

| 判断 | 根拠 | 採用した内容 | 反証・限界 |
|---|---|---|---|
| MIT Licenseを採用する | [GitHub「Licensing a repository」](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)、[SPDX MIT](https://spdx.org/licenses/MIT) | MIT全文、権利者及び対象年を`LICENSE`へ記載する | 公開後の複製やforkは回収できない。免責条項は強行法規上の義務を消滅させない |
| 導入機関の責務を別文書にする | [個人情報保護委員会・通則編](https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/) | 利用目的、安全管理措置、従業者・委託先の監督、本人対応、保存・消去を導入機関が定める | 汎用文書だけでは、個別の事業者又は医療機関の適法性を確認できない |
| 全勤務形態の法令適合を自動判定すると表示しない | [厚生労働省「いわゆる『シフト制』について」](https://www.mhlw.go.jp/stf/newpage_22954.html) | 勤務案を候補と位置付け、契約・就業規則・労使協定等との照合を求める | 同資料の「シフト制」の定義は固定的な三交替勤務等を除くため、病院の全勤務形態へ一般化できない |
| 医療情報を扱う構成は別途確認する | [厚生労働省「医療情報システムの安全管理に関するガイドライン第7.0版」](https://www.mhlw.go.jp/stf/shingi/0000516275_00006.html) | 患者情報を既定で扱わず、扱う場合は導入機関が適用範囲と追加措置を確認する | 職員勤務の合成環境を試験しただけでは、医療情報システムとしての適合を認定できない |
| CIの外部actionを完全なcommit SHAへ固定する | [GitHub「Secure use reference」](https://docs.github.com/en/actions/reference/security/secure-use) | actionを検証時点の完全なSHAに固定し、権限をジョブごとに限定する | SHA固定は、固定先のコード又はワークフローの誤設定を無害化しない。更新監視が必要である |
| `main`をPRと必須検査で保護する | [GitHub「About protected branches」](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) | 必須status checks、会話解決、force-push・削除禁止を設定する | 単独管理の公開初期には、必須承認者数を1以上にすると自ら更新不能になる場合があるため、初回は設定しない |
| セキュリティ試験観点を体系化する | [OWASP ASVS 5.0](https://github.com/OWASP/ASVS) | 認可、入力、セッション、ファイル、ログ等の反証試験へ利用する | チェックリストへの対応又は自動検査0件は、安全性の証明ではない |

## 結論

公開に必要なのは、選択した許諾条件と実装の整合、機微情報・実在人物データ・巨大生成物の除外、再現可能な検証、既知の限界の明示及びGitHub上の継続的な保護である。これらを満たしても、導入先固有の法令適合、業務妥当性、使いやすさ又は安全性が自動的に成立するわけではない。
