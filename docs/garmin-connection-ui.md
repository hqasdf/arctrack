# Compact Garmin connection interface

Health owns the primary POST Connect Garmin action. OAuth outcomes return to
`/health?garmin=<safe-code>` using a fixed server destination, never a submitted
return URL. Existing PKCE, browser binding, authenticated identity, provider
identity checks, encryption, transaction consumption and deletion fences remain.

The green Garmin Connected indicator comes from the server's safe connection view;
the query string cannot assert success. The server checks saved credentials and
token validity, and the UI expires its badge or clears it after a failed status
refresh. Linking is separate from measurement import/freshness.

Manage connection is a native keyboard-accessible disclosure containing permission
information, status refresh, disconnect and privacy access. Profile retains this
compact control in Connected apps. Failed authorization offers a single safe
message/retry; expired or revoked authorization offers Reconnect Garmin.

`public/garmin-connect.png` is the unmodified blue Connect logo from
https://developer.garmin.com/static/logo_connect_blue-31e791d39bf2b861938cbc724e65d8e6.png
referenced on Garmin's official branding page:
https://developer.garmin.com/brand-guidelines/connect/ . No custom Garmin logo,
filters or recoloring are used. Existing website theme tokens style the controls.

Real account authorization and reconnection still require separately approved
live testing. No real Garmin consent, disconnection or account deletion is part
of synthetic component/callback regression coverage.
