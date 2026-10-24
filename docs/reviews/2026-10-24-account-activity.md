# Account activity and authentication provenance

Adds an admin-only per-account activity view (50 auth events / 60-day retention, latest 10 saved watch-history rows), explicit missing historical context, and a distinction between authenticated-handler records and old time-correlated log evidence. Device/browser/OS labels are claims parsed from bounded User-Agent text, never proof of hardware or physical location. No IP geolocation service is called.

New register/login/Google success events and known-account password failures are recorded without request bodies, passwords, tokens, cookies or OAuth codes. Account summaries store registration and latest successful authentication. NextAuth forwards only the originating IP and User-Agent through its internal backend call, with per-request options to avoid cross-request metadata mixing. Loopback remains unknown. Google-created users have an explicit user role and Google responses include the effective role. Public auth calls use a dedicated 30/minute limiter.

The Nginx audit configuration logs the trusted ingress client address and path without query strings, redacting subtitle capability paths. The per-account activity API stays behind admin middleware and projects only approved metadata. Historical account correlation is imported privately from existing server logs and marked as approximate; no private account data or host incident report is committed here.

Validation: full local backend suite, 133 frontend tests and frontend build passed. Additional tests cover trusted req.ip versus forged header fields, loopback/IPv6/invalid IP handling, UA control-character bounds, and forwarding-header allowlists. Production integration and deployment are verified separately before reporting completion.
