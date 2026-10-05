type Read = <T>(path: string) => Promise<T>;

/**
 * One read per path for the lifetime of one transport, that is of one rendered request: the
 * context and the route may need the same resource (the latest input gives the context its
 * names and a planning route its duties) and then share one answer, a failure included.
 * Nothing outlives the request.
 */
export function oncePerRequest(read: Read): Read {
  const answers = new Map<string, Promise<unknown>>();
  return <T,>(path: string): Promise<T> => {
    let answer = answers.get(path);
    if (!answer) {
      answer = read<unknown>(path);
      answers.set(path, answer);
    }
    return answer as Promise<T>;
  };
}
