// The tasks of "next" as they are declared: their groups, their order, the summary each is
// found by and the line that says what it records and when it is needed. Static text only
// (no component), so the server-rendered view can count them and the client island can
// show them from the same list.

export type TaskKind =
  | "person" | "employment" | "contract" | "capability" | "capability_amendment"
  | "employer" | "establishment" | "management_model"
  | "agreement" | "rule_review" | "rule_decision" | "accounting_transition" | "site_attribution_decision" | "annual_calendar";

/** `step`: the step of adding a person that starts this task, as the tag the task carries
 * (「手順1」): the same number as on the step's card, so that a step and the task it opens
 * are seen to be one thing and not two ways to register a record. */
export type TaskDeclaration = { kind: TaskKind; summary: string; hint: string; step?: string };

/** One task per record kind, grouped by what the record is about. Every task is an
 * ordinary one: each adds a record or a new version of one, and none removes anything.
 * The withdrawal or expiry of a qualification is such a record too: it is added with its
 * reason and evidence, and the qualification it names keeps its record (only the period
 * in which it can be used ends earlier). */
export const TASK_GROUPS: Array<{ id: string; title: string; tasks: TaskDeclaration[] }> = [
  { id: "staff", title: "職員の記録を登録・改定する", tasks: [
    { kind: "person", step: "手順1", summary: "職員を登録・氏名を訂正する", hint: "新しい職員を氏名で登録します。氏名の訂正にも使います。" },
    { kind: "employment", step: "手順3", summary: "雇用関係を登録・改定する", hint: "入職や条件変更のとき、働く事業場・期間・制度を記録します。" },
    { kind: "contract", step: "手順4", summary: "契約を登録・改定する", hint: "契約の締結・更新のとき、雇用形態や時間の上限を記録します。" },
    { kind: "capability", step: "手順5", summary: "資格・監督条件を登録する", hint: "資格を確認したとき、担当できる業務と監督の要否を記録します。" },
    { kind: "capability_amendment", summary: "資格の取消・失効を記録する", hint: "取消・失効の日時と理由を記録します。元の資格の記録は残ります。" },
  ] },
  { id: "facility", title: "施設の記録を登録・変更する", tasks: [
    { kind: "employer", step: "手順2", summary: "雇用主を登録・変更する", hint: "雇用主の正式名称を登録します。施設で最初に一度だけ必要です。" },
    { kind: "establishment", step: "手順2", summary: "事業場を登録・変更する", hint: "雇用関係や36協定の前に、雇用主の事業場と期間を登録します。" },
    { kind: "management_model", summary: "兼業の管理モデルを登録・変更する", hint: "兼業の職員について、2つの雇用主が合意した上限を記録します。" },
  ] },
  { id: "rules", title: "規則・協定・判断を登録・変更する", tasks: [
    { kind: "agreement", summary: "36協定を登録・変更する", hint: "協定の締結・更新のとき、時間外の上限と特別条項を記録します。" },
    { kind: "rule_review", summary: "規則の適用確認を登録・変更する", hint: "規則を確認するたびに、確かめた版・条項と資料を記録します。" },
    { kind: "rule_decision", summary: "改定規則の公開判断を記録する", hint: "規則の改定時に、影響を確かめ、公開か保留かを記録します。" },
    { kind: "accounting_transition", summary: "制度切替の集計条件を登録・変更する", hint: "制度を途中で切り替えたとき、切替の前後の集計方法を記録します。" },
    { kind: "site_attribution_decision", summary: "事業場間の時間外の帰属の判断を登録・変更する", hint: "複数の事業場で働いた日の時間外を数える順序を記録します。" },
    { kind: "annual_calendar", summary: "1年単位の変形労働時間制のカレンダーを登録・変更する", hint: "この制度を使う事業場ごとに、労働日と所定時間を記録します。" },
  ] },
];

/** The `id` of the heading of the steps of adding a person, for a control that leads there. */
export const STEPS_HEADING = "contracts-next-steps-title";

export const TASK_COUNT = TASK_GROUPS.reduce((sum, group) => sum + group.tasks.length, 0);
