import * as Sentry from '@sentry/node';

const REDACT_STRING = '[REDACTED]';

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    beforeSend(event) {
      if (event.request) {
        if (event.request.url) {
          event.request.url = REDACT_STRING;
        }
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }
        if (event.request.data) {
          event.request.data = REDACT_STRING;
        }
      }
      
      // Redact error messages containing user input
      if (event.exception?.values) {
        for (const value of event.exception.values) {
          if (value.value) {
            value.value = value.value.replace(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, REDACT_STRING);
            value.value = value.value.replace(/\b(bearer\s+[\w\-.]+)\b/gi, REDACT_STRING);
          }
        }
      }

      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = REDACT_STRING;
      }
      if (breadcrumb.message) {
         breadcrumb.message = breadcrumb.message.replace(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g, REDACT_STRING);
      }
      return breadcrumb;
    }
  });
}
