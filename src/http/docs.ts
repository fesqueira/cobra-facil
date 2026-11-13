/** API reference page (Scalar), reading /openapi.json. Also published as a static page on GitHub Pages. */
export const SCALAR_VERSION = "1.76.0";

export const docsHtml = (specUrl: string) => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cobra Fácil · API</title>
  </head>
  <body>
    <script id="api-reference" data-url="${specUrl}"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}"></script>
  </body>
</html>
`;

/** CSP for the docs page only; every other route keeps Helmet's strict default. */
export const DOCS_CSP =
  "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: https:; connect-src 'self'";
