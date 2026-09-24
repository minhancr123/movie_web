import * as Sentry from '@sentry/react';

const REDACT_STRING = '[REDACTED]';

export function initSentry() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    beforeSend(event: any) {
      if (event.request) {
        if (event.request.url) {
          event.request.url = REDACT_STRING;
        }
      }
      if (event.exception?.values) {
        for (const value of event.exception.values) {
          if (value.value) {
             value.value = value.value.replace(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, REDACT_STRING);
          }
        }
      }
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
