const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
const contentRef = 'tmdb:movie:496243';
const expectedPrefix = '/xem-phim/movie/496243/';
const requestUrl = `${baseUrl}/xem-phim/${encodeURIComponent(contentRef)}?tap=full`;

try {
  const response = await fetch(requestUrl);
  const html = await response.text();
  const redirect = html.match(/NEXT_REDIRECT;replace;([^;]+);307;/)?.[1] || 'missing';
  const passed = redirect.startsWith(expectedPrefix);

  const message = `${passed ? 'PASS' : 'FAIL'} input=${contentRef} result=${redirect} http=${response.status}`;
  (passed ? console.log : console.error)(message);
  process.exitCode = passed ? 0 : 1;
} catch (error) {
  console.error(`FAIL input=${contentRef} result=${error instanceof Error ? error.message : String(error)} http=unavailable`);
  process.exitCode = 1;
}
