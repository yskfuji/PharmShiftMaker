import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useStepFocus } from "../useStepFocus";

function Task() {
  const steps = useStepFocus<"content" | "confirm">();
  const [confirming, setConfirming] = useState(false);
  return <>
    <h4 {...steps.heading("content")}>内容</h4>
    <button type="button" onClick={() => { setConfirming(true); steps.moveTo("confirm"); }}>確認へ</button>
    {confirming && <><h4 {...steps.heading("confirm")}>確認</h4><button type="button" onClick={() => { setConfirming(false); steps.moveTo("content"); }}>戻る</button></>}
  </>;
}

test("focus moves to the heading of the step the task continues at, including one that has just appeared", () => {
  render(<Task />);
  expect(screen.getByRole("heading", { name: "内容" })).not.toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "確認へ" }));
  expect(screen.getByRole("heading", { name: "確認" })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "戻る" }));
  expect(screen.getByRole("heading", { name: "内容" })).toHaveFocus();
  expect(screen.getByRole("heading", { name: "内容" })).toHaveAttribute("tabindex", "-1");
});
