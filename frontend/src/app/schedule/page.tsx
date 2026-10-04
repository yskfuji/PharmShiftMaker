import { redirect } from "next/navigation";

export default function ScheduleIndexPage() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  redirect(`/schedule/${year}/${month}`);
}
