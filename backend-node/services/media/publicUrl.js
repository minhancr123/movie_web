export function publicMediaUrl(path, opts = {}) {
  if (opts.preserveAuth) {
    return path;
  }

  if (!opts.origin) {
    return path;
  }

  const normalizedPath = path.replace(/^\/+/, '/');
  const baseUrl = opts.origin.replace(/\/+$/, '');
  
  let result = baseUrl + normalizedPath;
  
  if (opts.query) {
    const separator = result.includes('?') ? '&' : '?';
    result += separator + opts.query;
  }
  
  return result;
}
