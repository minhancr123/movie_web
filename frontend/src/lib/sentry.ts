const REDACT_STRING = '[REDACTED]';

let initializing: Promise<void> | undefined;
export function initSentry(): Promise<void> {
  if (!initializing) initializing = configureSentry();
  return initializing;
}

async function configureSentry() {
  const config: { dsn?: string; environment?: string; release?: string } = await fetch('/observability-config', { cache: 'no-store' })
    .then((response) => response.ok ? response.json() : {})
    .catch(() => ({}));
  const dsn = config.dsn || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  // Loaded only when a DSN exists: the static import put the whole Sentry SDK
  // (~40-90KB gz) into the shared chunk of every page for a no-op init.
  const Sentry = await import('@sentry/react');
  Sentry.init({
    dsn,
    environment: config.environment || 'production',
    release: config.release,
    beforeSend(event: any) {
      if (event.request) {
        if (event.request.url) {
          event.request.url = REDACT_STRING;
        }
        delete event.request.headers;
        delete event.request.cookies;
        delete event.request.data;
        delete event.request.query_string;
      }
      if (event.exception?.values) {
        for (const value of event.exception.values) {
          if (value.value) {
             value.value = value.value.replace(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, REDACT_STRING);
             value.value = value.value.replace(/https?:\/\/\S+/gi, REDACT_STRING).replace(/bearer\s+[\w.-]+/gi, REDACT_STRING);
          }
        }
      }
      delete event.user;
      delete event.extra;
      return event;
    },
    beforeBreadcrumb(breadcrumb: any) {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = REDACT_STRING;
      }
      return breadcrumb;
    }
  });
}
