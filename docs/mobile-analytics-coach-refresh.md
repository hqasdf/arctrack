# Phase 3D-2: Android Analytics and Coach refresh ownership

`useScopedFocusRead` owns one request generation per mounted, focused view.
Account, organisation and applicable athlete/Session/Round identifiers form the
scope. Scope-tagged state hides an earlier scope during render, before effects
run. Layout cleanup, focus cleanup and starting a newer request invalidate older
completions. Success, failure and loading transitions all check the same ticket.

The shared Coach workspace and personal Analytics use foreground loading/retry
states. Coach athlete, Session and Round details use background refresh after
their first valid result. The same verified detail object remains mounted while
refreshing or after a temporary error, preserving feedback/notes drafts and
existing keys. A current null authorization result or an authorization failure
clears protected data. An obsolete authorization failure cannot clear a newer
authorized result, and an obsolete success cannot undo a newer denial.

The Phase 3D-1 history error keeps its existing safe message and now carries only
`authorization` or `unavailable`. SDK HTTP 401/403 and permission codes are
classified without retaining raw provider messages. Coach membership/roster
readers retain the same distinction. Database contracts, RLS, scoring and the
pending complete-history migration are unchanged.

There is no polling or new subscription. Normal renders and token-object
replacement with the same account do not trigger additional requests. Current
Coach request chains stop before subsequent reads if they have become obsolete.
Already-dispatched read-only SDK requests may finish; their results are ignored.
Remote membership revocation is observed on the next existing refresh/focus/read
or Auth lifecycle change, not via a newly introduced instant revocation feed.

Deterministic tests execute the hook and the actual Analytics/Coach screen
wiring with controlled promises. They are not physical Android acceptance.
The existing account-keyed navigation stack remains an additional safeguard.
