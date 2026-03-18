import { renderToStream } from 'remix/component/server';

export function render(node: unknown, init?: ResponseInit): Response {
  const stream = renderToStream(node);
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'text/html; charset=UTF-8');
  }
  return new Response(stream, { ...init, headers });
}
