# Patient Account Authentication — implementation notes

The first patient-account backend increment adds optional registration, email verification, login, logout, session lookup, and password reset. It does not yet expose appointment data or link guest bookings to accounts.

## Required Netlify environment variables

- `PATIENT_SESSION_SECRET`: a long random secret used only for patient sessions. Do not reuse the staff session secret.
- `RESEND_API_KEY`: Resend API key, stored only in Netlify.
- `PATIENT_EMAIL_FROM`: verified sender, for example `H Evans Optometrist <accounts@hevansoptometrist.co.za>` after the domain is verified in Resend.

The function uses the Netlify `URL` environment variable for email links and falls back to the production site URL.

## Security and boundaries

- Patient accounts use a separate Netlify Blobs store and never use staff credentials or staff endpoints.
- Passwords are salted and hashed with Node scrypt; plaintext passwords are never stored.
- Verification and password-reset links use random, single-use tokens. Only token hashes are stored; links expire after 30 minutes.
- Patient sessions are signed, seven-day, HttpOnly, Secure and SameSite=Strict cookies scoped to `/api/patient`.
- Password reset invalidates existing sessions.
- Login and account-email actions have a basic per-IP attempt throttle. Netlify Blobs throttling is best-effort under simultaneous requests; production hardening should use an atomic rate limiter before broad public launch.
- Registration and password-reset responses avoid revealing whether an email address has an account.
- No patient endpoints return appointments in this increment. Appointment ownership and guest-booking claims require a separate reviewed implementation.
