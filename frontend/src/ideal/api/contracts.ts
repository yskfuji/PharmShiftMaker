// Responses of existing endpoints the ideal screens read (the five new contracts are in
// ../types.ts and are checked against OpenAPI by devtools/ideal_ui/check_contracts.py).
export interface PublishedDuty {
  duty_id: string;
  person_id: string;
  kind: string;
  task: string;
  location: string;
  start: string;
  end: string;
}

export interface PublicationRead {
  publication_id: string;
  version: number;
  period: string;
  assignments: PublishedDuty[];
  validation_status?: string;
}
