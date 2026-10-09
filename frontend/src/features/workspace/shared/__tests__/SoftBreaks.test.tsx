import { render } from "@testing-library/react";
import SoftBreaks from "../SoftBreaks";

test("a place to break follows each slash and precedes each opening bracket; the text is unchanged", () => {
  const { container } = render(<p><SoftBreaks>高橋 葵／東都医療センター（架空）／</SoftBreaks></p>);
  const line = container.querySelector("p")!;
  expect(line.textContent).toBe("高橋 葵／東都医療センター（架空）／");
  expect(line.innerHTML).toBe("高橋 葵／<wbr>東都医療センター<wbr>（架空）／");
});

test("a text with neither is returned as it is", () => {
  const { container } = render(<p><SoftBreaks>鈴木 悠斗</SoftBreaks></p>);
  expect(container.querySelector("p")!.innerHTML).toBe("鈴木 悠斗");
});
