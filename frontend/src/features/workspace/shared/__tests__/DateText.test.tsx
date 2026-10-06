import { render } from "@testing-library/react";
import DateText from "../DateText";

test("each date of a text is a <time> of its own, and the text that is read is unchanged", () => {
  const text = "合成 一・合成病院 2026-04-01 00:00 〜 2028-04-01 00:00（判断日 2026-04-02）";
  const { container } = render(<p><DateText>{text}</DateText></p>);
  expect(container.textContent).toBe(text);
  expect(Array.from(container.querySelectorAll("time")).map((item) => item.textContent)).toEqual(["2026-04-01 00:00", "2028-04-01 00:00", "2026-04-02"]);
});

test("a text without a date is returned as it is, and a text that is one date is one <time>", () => {
  expect(render(<p><DateText>氏名未登録の職員</DateText></p>).container.innerHTML).toBe("<p>氏名未登録の職員</p>");
  expect(render(<p><DateText>2026-10-12</DateText></p>).container.innerHTML).toBe("<p><time>2026-10-12</time></p>");
  expect(render(<p><DateText>{""}</DateText></p>).container.innerHTML).toBe("<p></p>");
});

test("a period breaks only between its two dates: the dash stays with the first, and a bracket with the date it touches", () => {
  const unbroken = (text: string) => { const { container } = render(<p><DateText>{text}</DateText></p>); expect(container.textContent).toBe(text); return Array.from(container.querySelectorAll(".ideal-v3-unbroken")).map((item) => item.textContent); };
  expect(unbroken("合成 一・合成病院 2026-04-01 00:00 〜 2028-04-01 00:00")).toEqual(["2026-04-01 00:00 〜", "2028-04-01 00:00"]);
  // The only place the period may break is the space between its halves.
  const { container } = render(<p><DateText>合成病院の事業場（2026-04-01 00:00 〜 2028-04-01 00:00）</DateText></p>);
  expect(container.innerHTML).toBe('<p>合成病院の事業場<span class="ideal-v3-unbroken">（<time>2026-04-01 00:00</time> 〜</span> <span class="ideal-v3-unbroken"><time>2028-04-01 00:00</time>）</span></p>');
  // A date in brackets of its own keeps them; one inside a longer bracket is a date as before.
  expect(unbroken("改定（2026-04-02）と確認")).toEqual(["（2026-04-02）"]);
  expect(unbroken("第1条（確認日 2026-04-01・資料 2026-04-01 改正（架空））")).toEqual([]);
  expect(unbroken("2026-04-01 〜 未入力")).toEqual([]);
});
