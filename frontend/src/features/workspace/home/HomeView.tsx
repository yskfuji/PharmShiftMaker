import type { RouteContext } from "../shell/routeTypes";
import HomeQueue from "./HomeQueue";
import { personalHome, teamHome, type HomeData } from "./model";
import PersonalHome from "./PersonalHome";
import TeamHome from "./TeamHome";

/** Today, by role: a pharmacist sees their own next duty; a planner sees the scope. Both
 * see the consents asked of them. */
export default function HomeView({ data, ctx }: { data: HomeData; ctx: RouteContext }) {
  const queue = <HomeQueue cases={data.cases} ctx={ctx} />;
  return ctx.role === "PHARMACIST"
    ? <PersonalHome home={personalHome(ctx, data.calendar)} queue={queue} />
    : <TeamHome home={teamHome(ctx, data)} queue={queue} />;
}
