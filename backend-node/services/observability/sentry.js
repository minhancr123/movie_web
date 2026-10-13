import * as Sentry from '@sentry/node';

const REDACT_STRING = '[REDACTED]';

// Controllers often catch exceptions and respond with 500 themselves.
// Express error middleware never sees those failures; record only status and
// a route template, without copying the URL, body or identity into the event.
export function observeHttpFailures(req, res, next) {
  res.once('finish', () => {
    if (res.statusCode < 500 || res.sentry || !Sentry.getClient()) return;
    const route = typeof req.route?.path === 'string' ? req.route.path : 'unknown';
    Sentry.captureMessage('HTTP server error', {
      level: 'error',
      tags: { status: String(res.statusCode), method: req.method, route },
      fingerprint: ['http-server-error', req.method, route, String(res.statusCode)],
    });
  });
  next();
}

export function initSentry() {
  if (!process.env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.RELEASE_ID,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        if (event.request.url) {
          event.request.url = REDACT_STRING;
        }
        if (event.request.headers) {
          for (const key of Object.keys(event.request.headers)) {
            if (/authorization|cookie/i.test(key)) delete event.request.headers[key];
          }
        }
        delete event.request.cookies;
        delete event.request.query_string;
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
            value.value = value.value.replace(/https?:\/\/\S+/gi, REDACT_STRING);
          }
        }
      }

      delete event.user;
      delete event.extra;
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
