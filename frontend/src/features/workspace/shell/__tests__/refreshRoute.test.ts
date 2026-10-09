import { refresh } from "next/cache";
import { refreshRoute } from "../actions/refreshRoute";

jest.mock("next/cache", () => ({ refresh: jest.fn() }));

test("the action asks for the current route to be rendered again, and does nothing else", async () => {
  // Anyone can call a Server Action with any arguments: it declares none and passes none on.
  expect(refreshRoute.length).toBe(0);
  const answer = await (refreshRoute as (...sent: unknown[]) => Promise<void>)("scope", { person: "p-1" });
  expect(answer).toBeUndefined();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledWith();
});
