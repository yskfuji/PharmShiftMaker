
import AppLayout from "@/components/layout/AppLayout";
import PageHeader from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

export default async function ScheduleLoading() {

  return (
    <AppLayout currentPath="/schedule" scheduleHref="/schedule">
      {/* A temporary view: after an in-app navigation, focus waits for the page's own heading (RouteFocus). */}
      <div data-route-loading="">
        <PageHeader title="シフトを読込中" description="生成済みデータを取得しています" />

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full rounded-lg" />
          ))}
        </div>

        <div className="mt-8 space-y-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-[600px] w-full rounded-lg" />
        </div>
      </div>
    </AppLayout>
  );
}
