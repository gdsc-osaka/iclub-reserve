/** Create a redirect Response using an absolute URL built from the current request. */
export function redirect(requestOrUrl: Request | URL | string, path: string, status = 302): Response {
  let base: string;
  if (requestOrUrl instanceof Request) {
    base = requestOrUrl.url;
  } else if (requestOrUrl instanceof URL) {
    base = requestOrUrl.href;
  } else {
    base = requestOrUrl;
  }
  const absolute = new URL(path, base).href;
  return Response.redirect(absolute, status);
}
