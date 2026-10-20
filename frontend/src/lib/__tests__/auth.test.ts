import { cookies } from "next/headers";
import { getAuthToken } from "../auth";
import { AUTH_TOKEN_COOKIE } from "../authConstants";

jest.mock("next/headers", () => ({ cookies: jest.fn() }));

const readCookies = jest.mocked(cookies);

afterEach(() => jest.resetAllMocks());

test("reads the configured session cookie on the server", async () => {
  const get = jest.fn().mockReturnValue({ value: "synthetic-session" });
  readCookies.mockResolvedValue({ get } as unknown as Awaited<ReturnType<typeof cookies>>);
  await expect(getAuthToken()).resolves.toBe("synthetic-session");
  expect(get).toHaveBeenCalledWith(AUTH_TOKEN_COOKIE);
});

test("missing cookie does not create a session", async () => {
  readCookies.mockResolvedValue({ get: jest.fn() } as unknown as Awaited<ReturnType<typeof cookies>>);
  await expect(getAuthToken()).resolves.toBeNull();
});

test("unavailable request context does not create a session", async () => {
  readCookies.mockRejectedValue(new Error("No request context"));
  await expect(getAuthToken()).resolves.toBeNull();
});
