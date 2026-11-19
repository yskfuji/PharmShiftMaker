import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { readDetail } from "@/lib/localAccounts";

jest.mock("@/lib/navigate", () => ({ navigate: jest.fn() }));

// jsdom has no fetch Response: a minimal stand-in with what the client reads.
const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const text = (status: number) =>
  ({ ok: false, status, json: async () => { throw new SyntaxError("not json"); } }) as unknown as Response;

describe("local accounts client", () => {
  it("shows the API detail instead of raw JSON", async () => {
    expect(await readDetail(json(401, { detail: "ログインIDまたはパスワードが正しくありません。" }), "x")).toBe(
      "ログインIDまたはパスワードが正しくありません。",
    );
    expect(await readDetail(text(502), "通信に失敗しました")).toBe("通信に失敗しました");
    expect(await readDetail(json(422, { detail: [{ msg: "bad" }] }), "入力を確認してください")).toBe("入力を確認してください");
  });
});

describe("first-run setup", () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it("refuses a mismatched password confirmation before calling the API", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const { SetupView } = await import("@/app/setup/SetupView");
    render(<SetupView />);
    fireEvent.change(screen.getByLabelText(/施設ID/), { target: { value: "hospital" } });
    fireEvent.change(screen.getByLabelText(/部署ID/), { target: { value: "pharmacy" } });
    fireEvent.change(screen.getByLabelText("表示名"), { target: { value: "管理者" } });
    fireEvent.change(screen.getByLabelText(/ログインID/), { target: { value: "head.pharmacist" } });
    fireEvent.change(screen.getByLabelText("パスワード（12文字以上）"), { target: { value: "correct horse battery" } });
    fireEvent.change(screen.getByLabelText("パスワード（確認）"), { target: { value: "different words here" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.submit(screen.getByRole("button", { name: "登録して始める" }).closest("form") as HTMLFormElement);
    expect(await screen.findByRole("alert")).toHaveTextContent("確認用のパスワードが一致しません。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the department and the first administrator and shows refusals", async () => {
    const fetchMock = jest.fn().mockResolvedValue(json(409, { detail: "Setup has already been completed" }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { SetupView } = await import("@/app/setup/SetupView");
    render(<SetupView />);
    fireEvent.change(screen.getByLabelText(/施設ID/), { target: { value: "hospital" } });
    fireEvent.change(screen.getByLabelText(/部署ID/), { target: { value: "pharmacy" } });
    fireEvent.change(screen.getByLabelText("表示名"), { target: { value: "管理者" } });
    fireEvent.change(screen.getByLabelText(/ログインID/), { target: { value: "head.pharmacist" } });
    fireEvent.change(screen.getByLabelText("パスワード（12文字以上）"), { target: { value: "correct horse battery" } });
    fireEvent.change(screen.getByLabelText("パスワード（確認）"), { target: { value: "correct horse battery" } });
    fireEvent.submit(screen.getByRole("button", { name: "登録して始める" }).closest("form") as HTMLFormElement);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/setup\/bootstrap$/);
    expect(JSON.parse(init.body)).toEqual({
      facility_id: "hospital",
      department_id: "pharmacy",
      login_id: "head.pharmacist",
      display_name: "管理者",
      password: "correct horse battery",
    });
    // The setup token is attached by the desktop shell, never by page code.
    expect(JSON.stringify(init.headers)).not.toMatch(/setup-token/i);
    expect(await screen.findByRole("alert")).toHaveTextContent("Setup has already been completed");
  });
});

describe("local sign-in", () => {
  const original = global.fetch;
  const env = process.env.NEXT_PUBLIC_AUTH_STRATEGY;
  afterEach(() => {
    global.fetch = original;
    process.env.NEXT_PUBLIC_AUTH_STRATEGY = env;
  });

  it("keeps spaces in a passphrase and asks for a password change when required", async () => {
    // LoginView reads the strategy when first imported; this file imports it only here.
    process.env.NEXT_PUBLIC_AUTH_STRATEGY = "local";
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(json(200, { initialized: true }))
      .mockResolvedValueOnce(json(200, { access_token: "t", role: "PHARMACIST", user_id: "a", issued_at: "2026-11-19T00:00:00Z", password_change_required: true }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const { LoginView } = await import("@/app/login/LoginView");
    const { navigate: assign } = await import("@/lib/navigate");
    render(<LoginView redirectPath="/planning" />);
    expect(screen.getByText("ログインIDとパスワードでサインインしてください")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ユーザーID"), { target: { value: "pharmacist.a" } });
    fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: " spaced pass phrase " } });
    fireEvent.submit(screen.getByRole("button", { name: "サインイン" }).closest("form") as HTMLFormElement);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/account/password?next=%2Fplanning"));
    const loginCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/auth/login"));
    expect(JSON.parse(loginCall[1].body).password).toBe(" spaced pass phrase ");
  });
});
