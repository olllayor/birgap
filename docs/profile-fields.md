# Profile fields: E2EE blob, not plaintext columns

**Decision (2026-07-09):** first name, last name and birthday stay inside the
existing `User.encryptedProfile` JSON blob (client-encrypted, key fingerprint in
`profileKeyHash`). No plaintext columns are added.

## Why

- The pattern is already live: `getMe`, `getPeerProfile`, thread lists and
  contact discovery all return `encryptedProfile` + `profileKeyHash`, and the
  client already decrypts the display name from it.
- Plaintext columns would be a one-way privacy downgrade and a migration burden
  once the profile-key sharing design lands.
- Phone number needs no new field: the owner sees `phoneMasked` via
  `GET /users/me`; peers deliberately never receive phone data.

## Blob shape (client-defined, server-opaque)

The server never validates the plaintext, but the agreed client schema is:

```json
{ "v": 1, "firstName": "...", "lastName": "...", "birthday": "YYYY-MM-DD" }
```

encrypted and wrapped however the client's crypto layer decides (the server
stores whatever JSON it is given in `encryptedProfile`).

## Open question (unchanged)

Profile-key sharing: how a peer obtains the key to decrypt
`encryptedProfile`. Options remain (a) key wrapped per-recipient via the
existing prekey channel on first message, or (b) key embedded in the contact
QR / deep-link payload. Until designed, peers that lack the key fall back to
`username` / `phoneMasked` — which the API already returns everywhere the blob
is present.
