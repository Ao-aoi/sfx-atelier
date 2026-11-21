export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 画面側が見分けるための短い記号（例：service_paused） */
    readonly code?: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}
