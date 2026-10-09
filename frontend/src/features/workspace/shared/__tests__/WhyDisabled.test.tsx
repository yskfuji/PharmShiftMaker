import { render, screen } from "@testing-library/react";
import WhyDisabled, { EVIDENCE_NEEDED } from "../WhyDisabled";

test("the reason is a sentence under the button and its description; with no reason nothing is drawn", () => {
  const { container, rerender } = render(<><button type="button" disabled aria-describedby="x-why">保存する</button><WhyDisabled id="x-why">{EVIDENCE_NEEDED}</WhyDisabled></>);
  expect(screen.getByRole("button", { name: "保存する" })).toHaveAccessibleDescription("理由と参照を3文字以上入力すると押せます。");
  expect(container.querySelector("p")).toHaveClass("ideal-v3-why-disabled");
  for (const none of [null, false, undefined, ""] as const) {
    rerender(<><button type="button">保存する</button><WhyDisabled id="x-why">{none}</WhyDisabled></>);
    expect(container.querySelector("p")).toBeNull();
  }
});
