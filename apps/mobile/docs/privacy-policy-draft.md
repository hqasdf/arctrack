# Arc Track privacy policy — draft for review, not published

**Effective date:** [Set before publication]  
**Operator and contact:** [Legal operator name and monitored privacy email or contact URL required]

Arc Track helps archers record training and competition Sessions, score Rounds and Arrows, review performance, use a local Arrow Counter, and participate in organisations. An account is required for saved Sessions.

## Information used

- **Account:** email address and authentication/session information managed by Supabase Auth. Arc Track does not store a separate password in its application tables.
- **Profile:** optional display name, club or team, division, shooting hand, and experience level.
- **Archery records:** Session title, date, type and manually entered Arrow count; Round format; End and Arrow scores; X status; and normalized target-plot positions and triple-face index. The app derives totals, trends, grouping and other insights from these records.
- **Organisations:** membership, role, join/leave status and timing, and organisation join codes. A current Head Coach can view the profile display name and saved archery records of active Archer members of a shared organisation. Other Archers cannot use that access to read one another's records. A former or inactive membership does not grant ongoing coach access under the current model.
- **On-device counter:** total, selected increment and Undo history are stored locally on the device with AsyncStorage, not in an Arc Track server table. Removing the app or its data may remove that counter state.

Arc Track uses these details to sign users in, save and display their records, calculate performance views, and support organisation and Head Coach features. Supabase provides authentication and backend data storage. The mobile app sends account and saved-record requests to the configured Supabase project. App distribution through Apple or Google may involve separate platform processing under their terms.

## Visibility and retention

An authenticated user can access their own saved records. Current Head Coaches have read-only access to active Archer members' saved Sessions and scoring data through the organisation access rules. They cannot change another athlete's scores. Organisation membership and role are used to determine that access.

Saved records remain until the account or records are deleted under the application's available controls and backend rules. [Confirm retention, backups, operational logs and any legal retention requirements with the operator before publication.] The local Arrow Counter remains on the device until reset or app data is removed.

## Account deletion and privacy contact

**This section is pending runtime validation, server configuration and deployment. Do not publish as a live capability yet.** Web and Expo Profile → Delete Account open the same web resource, where the user verifies their current password and types `DELETE`. The trusted server removes the Auth account and its owned profile, Sessions, Rounds, Ends, Arrows, memberships and athlete assignments. Shared organisations and Training Plans remain with creator/assigner references cleared; an organisation may remain without a Head Coach. Local Counter data on other devices is not remotely erased. [Insert the reviewed contact method for privacy requests and verified backup/log-retention details.]

## Changes

Update this policy when Arc Track adds or changes data collection, coach access, processors, or deletion behavior. [Insert the operator's publication/change-notice process.]
