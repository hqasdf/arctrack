# Draft: Garmin notification-security and delivery contract

Not sent. Use Garmin's verified Developer Program support channel. Do not attach
application secrets, tokens, real user IDs, health payloads or callback URLs with codes.

**Subject:** Arc Track Starter integration — production authentication contract for Health / Activity PUSH

Hello Garmin Connect Developer Program team,

We are preparing Arc Track's Connect Developer Starter integration. OAuth account
linking is deployed at `https://archery-website.vercel.app`. Daily Health Stats and
Activity are approved/enabled in API Tools; no notification endpoints are enabled.
Our proposed receiver is:

`https://archery-website.vercel.app/api/integrations/garmin/health/push`

We reviewed Start Guide 2.0, Health API 2.0, Activity API 2.0, OAuth2 PKCE 2.0,
the authenticated API Tools Endpoint Configuration/API Configuration pages, and
the linked Health API OpenAPI definition. We could not establish a production
sender-authentication contract. The inspected configuration exposes URL, Enabled
and On Hold controls, but no signature/header/client-certificate settings.

Please confirm the following for Starter production PUSH, including permissions
and deregistration notifications:

1. **Sender authentication:** What supported mechanism proves a delivery originated
   from Garmin? If signatures exist, please provide the exact header names,
   algorithm, signed bytes/canonicalization, timestamp/replay rules, key discovery
   and rotation, and a non-production test vector. If authenticated headers or HTTP
   authentication are supported, how are they configured, rotated and validated?
   If mutual TLS or network restrictions are the supported alternative, please
   provide the authoritative requirements, address ranges/rotation process and
   hosting requirements. We do not assume any of these mechanisms exists.
2. **Routing identifiers:** Please distinguish any client/user identifiers sent
   with a notification from authentication evidence. Public client IDs and claimed
   user IDs alone cannot establish trusted origin. Is there a documented,
   authenticated server-side way to verify a particular delivered summary for a
   Starter integration without unsupported historical pulls?
3. **Acknowledgment/durability:** The specifications require HTTP 200 within 30
   seconds before processing. May we authenticate, minimally validate and durably
   enqueue the delivery before 200, then perform measurement processing afterward?
   We cannot acknowledge success if durable receipt storage fails. Please confirm
   the required behavior for unavailable storage and invalid/authentication-failed
   packets, retry/backoff, duplicate delivery and maximum delivery lifetime.
4. **Payload bounds:** What are the maximum body bytes and summary counts per
   request, permitted content encodings, and expected batching across users/types?
   Our current conservative receiver bounds are 1 MiB and 100 summaries. Confirm
   these before activation or provide supported limits.
5. **Correction ordering:** Equal-duration changes are documented as legitimate.
   Which monotonic revision field, generation timestamp or delivery-order guarantee
   distinguishes a correction from a late retry of older content? Are retries and
   Summary Resender deliveries strictly ordered for the same user/type/start time?
   We currently preserve the known measurement and quarantine ambiguous changes;
   this deliberately prevents silent regression but cannot automatically apply all
   same-duration daily corrections.
6. **Lifecycle ordering:** Deregistration examples have no event time or registration
   epoch. How should a delayed notice be reconciled after the same Garmin account
   is reauthorized? Permission changes have second-resolution times: how should
   conflicting changes within one second be ordered? We preserve encrypted cleanup
   credentials and pause ingestion instead of assuming remote cleanup succeeded.
7. **Tools/approval:** Confirm the UI's HEALTH–Stress mapping to `stressDetails`,
   PUSH-only Starter delivery for the six proposed categories, the procedure to
   approve this existing HTTPS domain, and how to obtain signed/authenticated
   non-production test deliveries if supported.

Please link the authoritative production specification or provide the contract in
writing. We will keep the receiver disabled until sender verification and these
delivery requirements are established.

Thank you,
Arc Track
