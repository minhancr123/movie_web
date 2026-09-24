import { expect } from 'chai';
import * as Sentry from '@sentry/node';
import { initSentry } from '../services/observability/sentry.js';

describe('Sentry Redaction', () => {
  before(() => {
    process.env.SENTRY_DSN = 'https://examplePublicKey@o0.ingest.sentry.io/0';
    initSentry();
  });

  after(() => {
    delete process.env.SENTRY_DSN;
  });

  it('should redact sensitive information from beforeSend', () => {
    const client = Sentry.getClient();
    const options = client.getOptions();
    
    const mockEvent = {
      request: {
        url: 'https://cineon.me/api/users/123/profile?token=secret',
        headers: { authorization: 'Bearer secret_token', cookie: 'session_id=123' },
        data: { password: 'secret_password' }
      },
      exception: {
        values: [
          { value: 'User test@example.com failed to login' }
        ]
      }
    };

    const redactedEvent = options.beforeSend(mockEvent);

    expect(redactedEvent.request.url).to.equal('[REDACTED]');
    expect(redactedEvent.request.headers.authorization).to.be.undefined;
    expect(redactedEvent.request.headers.cookie).to.be.undefined;
    expect(redactedEvent.request.data).to.equal('[REDACTED]');
    expect(redactedEvent.exception.values[0].value).to.equal('User [REDACTED] failed to login');
  });

  it('should redact sensitive information from breadcrumbs', () => {
    const client = Sentry.getClient();
    const options = client.getOptions();

    const mockBreadcrumb = {
      category: 'http',
      data: { url: 'https://cineon.me/api/test?secret=123' },
      message: 'Failed request for test@example.com'
    };

    const redactedBreadcrumb = options.beforeBreadcrumb(mockBreadcrumb);

    expect(redactedBreadcrumb.data.url).to.equal('[REDACTED]');
    expect(redactedBreadcrumb.message).to.equal('Failed request for [REDACTED]');
  });
});
