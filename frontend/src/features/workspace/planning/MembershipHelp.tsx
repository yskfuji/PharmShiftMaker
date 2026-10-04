/** The next step when an account has no department membership: nothing in the app can
    grant it (the operator registers it with the operations tool), so name who and what. */
export default function MembershipHelp() {
  return <p className="text-sm">所属の登録は、施設の運用担当者が行います。画面の「ログイン中」の欄に表示されているログインID（またはアカウントID）を、管理者に伝えてください。</p>;
}
