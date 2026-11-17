/* Findings and solver diagnostics come from the server in English (they are part
   of stored validation reports). The flextime ones are shown in Japanese here;
   any other message is shown unchanged, so nothing is hidden. */

const STATUS: Record<string, string> = { violation: '違反', unverified: '未確認', unsupported: '未対応', satisfied: '適合' };
export const findingStatus = (status: string) => STATUS[status] ?? status;

const RULES: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Flextime is not adopted for this person: no confirmed facility adoption and enrolment cover (.+)$/,
    (m) => `フレックスタイム制が採用されていません。施設の採用と本人の参加（どちらも別の管理者の確認済み）が、雇用条件 ${m[1]} を覆っていません。施設の設定で登録と確認をしてください。`],
  [/^Flextime settlement terms differ from the confirmed adoption (.+): (.+)$/,
    (m) => `雇用条件 ${m[2]} の清算期間・総枠の条件が、確認済みの採用 ${m[1]} と一致しません。`],
  [/^Flextime adoption work rules, agreement or filing unverified: (.+)$/,
    (m) => `採用 ${m[1]} の就業規則・労使協定・協定届の根拠が、確認済みではありません。`],
  [/^The flextime agreement was filed after the adoption started: (.+)$/,
    (m) => `採用 ${m[1]} の協定届の提出日が、採用の開始日より後です。`],
  [/^A flextime contract cannot require planned minimum hours: (.+)$/,
    (m) => `契約 ${m[1]}：フレックスタイム制では時刻付きの勤務を割り当てないため、計画上の最低時間を設定できません。`],
  [/^Flextime workers set their own start and end times; no timed duty can be planned$/,
    () => 'フレックスタイム制の職員は始業・終業の時刻を自分で決めるため、時刻付きの勤務を計画できません。'],
  [/^Flextime with another employer, a mixed system or changed settlement terms is not supported$/,
    () => 'フレックスタイム制で、他の雇用主での勤務、清算期間の途中での制度の切替、または清算の条件の変更がある場合は計算できません。'],
  [/^The week of the switch (to|from) flextime on (\S+) is split;.*$/,
    (m) => `${m[2]} のフレックスタイム制${m[1] === 'to' ? 'への' : 'からの'}切替で、週が二つの制度に分かれています。通常の制度の日は、フレックスタイム制の日を含めずに週40時間と照合しました。人事・法務の確認が必要です。`],
  [/^Flextime work rules or agreement unverified: (.+)$/,
    (m) => `雇用条件 ${m[1]}：フレックスタイム制の就業規則・労使協定の根拠が、確認済みではありません。`],
  [/^The flextime settlement period from (\S+) is not fully in the input: (.+)$/,
    (m) => `雇用条件 ${m[2]}：${m[1]} から始まる清算期間の全体が、入力に含まれていません。`],
  [/^Flextime settlement overtime has no work in the final month to be attributed to$/,
    () => '清算期間の総枠を超えた時間を、最終月の労働に割り当てられません。'],
];

export function findingText(message: string): string {
  for (const [pattern, text] of RULES) {
    const match = message.match(pattern);
    if (match) return text(match);
  }
  return message;
}

/** A solver diagnostic, with the flextime note (added by the server) in Japanese. */
export function diagnosticText(message: string): string {
  return message.replace(/; (\d+) on flextime cannot take timed duties$/,
    (_all, count) => `（うち ${count} 人はフレックスタイム制のため、時刻付きの勤務を担えません）`);
}
