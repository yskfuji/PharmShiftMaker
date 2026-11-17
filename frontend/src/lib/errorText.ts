// Display text for a caught error. Presentation only: it never decides what failed or whether
// to retry. It drops the JavaScript class prefix ("Error: "), turns a FastAPI error body into
// its message, and names a lost connection in plain words. Anything else is shown unchanged.

const NETWORK = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/;

type Issue = { loc?: unknown; msg?: unknown };

function detailText(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && typeof (detail as { message?: unknown }).message === 'string') return (detail as { message: string }).message;
  if (Array.isArray(detail)) {
    const lines = (detail as Issue[]).map((issue) => {
      const where = Array.isArray(issue?.loc) ? issue.loc.filter((part) => part !== 'body').join(' / ') : '';
      const what = typeof issue?.msg === 'string' ? issue.msg : '';
      return [where, what].filter(Boolean).join('：');
    }).filter(Boolean);
    return `入力内容を確認してください（${detail.length}件）${lines.length ? '：' + lines.join('、') : ''}`;
  }
  return null;
}

/** A server body embedded at the end of a message ("保存できませんでした（422）。{...}"). */
function withReadableBody(message: string): string {
  const start = message.indexOf('{');
  if (start < 0) return message;
  try {
    const parsed = JSON.parse(message.slice(start)) as { detail?: unknown };
    const text = parsed && typeof parsed === 'object' ? detailText(parsed.detail) : null;
    return text === null ? message : message.slice(0, start) + text;
  } catch {
    return message;
  }
}

export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (NETWORK.test(raw.trim())) return 'サーバーに接続できませんでした。通信を確認して、もう一度お試しください。';
  return withReadableBody(raw.replace(/^(?:[A-Z][A-Za-z]*Error): /, ''));
}
