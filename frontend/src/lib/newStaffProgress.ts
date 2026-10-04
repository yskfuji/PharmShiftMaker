// Where a newly hired person stands in the registration order, from records the contract
// workflow has already loaded. It only checks whether each record exists: it does not judge
// legal validity (the server's staging validation does), and it never calls the API.

export type StaffStep = 'person' | 'site' | 'employment' | 'contract' | 'capability' | 'reflect';
export type StepStatus = 'done' | 'todo' | 'blocked' | 'elsewhere';
export type StepState = { step: StaffStep; status: StepStatus; reason: string };

type Row = Record<string, unknown>;
export type StaffRecords = {
  people: { person_id: string; name: string }[];
  sites: Row[];
  employments: Row[];
  contracts: Row[];
  capabilities: Row[];
};

const forPerson = (rows: Row[], personId: string) => rows.some((row) => row.person_id === personId);

/** The six steps in the order the records depend on each other. */
export function newStaffProgress(records: StaffRecords, personId: string): StepState[] {
  const person = personId !== '' && records.people.some((p) => p.person_id === personId);
  const site = records.sites.length > 0;
  const employment = person && forPerson(records.employments, personId);
  const noPerson = '先に職員の氏名を登録し、上で選んでください。';
  return [
    { step: 'person', status: person ? 'done' : 'todo', reason: person ? '' : '氏名を登録すると、次の手順に進めます。' },
    { step: 'site', status: site ? 'done' : 'todo', reason: site ? '登録済みの事業場を使えます。' : '雇用関係の前に、雇用主と事業場が必要です。' },
    {
      step: 'employment',
      status: !person ? 'blocked' : !site ? 'blocked' : employment ? 'done' : 'todo',
      reason: !person ? noPerson : !site ? '先に雇用主と事業場を登録してください。' : '',
    },
    {
      step: 'contract',
      status: !person ? 'blocked' : forPerson(records.contracts, personId) ? 'done' : !employment ? 'blocked' : 'todo',
      reason: !person ? noPerson : forPerson(records.contracts, personId) ? '' : !employment ? '先にこの職員の雇用関係を登録してください。' : '',
    },
    {
      step: 'capability',
      status: !person ? 'blocked' : forPerson(records.capabilities, personId) ? 'done' : 'todo',
      reason: !person ? noPerson : '',
    },
    { step: 'reflect', status: 'elsewhere', reason: '' },
  ];
}
