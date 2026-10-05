import DirectoryPanel, { type DirectoryData } from "./DirectoryPanel";

/** Search the scope's people and see one person's account, contracts, qualifications and
 * cases. Changes are made on the routes this view links to. */
export default function DirectoryView({ data }: { data: DirectoryData }) {
  return <div className="ideal-stack">
    <DirectoryPanel memberships={data.memberships} records={data.records} cases={data.cases} />
  </div>;
}
