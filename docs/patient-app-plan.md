# Patient App Plan — H Evans Optometrist

## Product direction

Build the patient experience as an installable Progressive Web App (PWA) in the existing repository. Keep the public booking website available to everyone. Installing the app and creating an account must remain optional.

The staff app remains separate at `/admin/`. The patient experience will live at `/patient/` and use dedicated patient endpoints. Do not expose staff endpoints or staff sessions to patient clients.

## Patient experience (v1)

1. **Guest booking:** Keep the current booking form and booking flow working without registration.
2. **Optional patient account:** Patients can create an account and sign in to view their own appointments. Account creation must not be required to book.
3. **My appointments:** Show upcoming and past appointments belonging only to the authenticated patient. In v1, patients can request a cancellation or reschedule; staff retain control of the actual appointment status and availability.
4. **Notifications:** Ask permission only after a clear user action. Send generic push notifications without names, appointment details, phone numbers or clinical information in the notification payload.
5. **WhatsApp fallback:** Patients who do not install the PWA can receive appointment messages through Meta WhatsApp Cloud API from a new dedicated business number. Do not migrate or disconnect the existing H Evans WhatsApp Business number.
6. **Install invitation:** Explain installation on Android, iPhone and desktop. Offer it after a successful booking and in a dismissible website banner. Never block booking or repeatedly interrupt someone who selects “Not now”.

## Installation prompt behaviour

- Detect whether the PWA is already installed / running in standalone mode; hide the invitation in that case.
- Android / supported desktop browsers: show an **Install app** action when the browser provides the install prompt. Explain the browser menu fallback if it does not.
- iPhone / iPad: show short Safari instructions: open the website in Safari, tap Share, choose **Add to Home Screen**, then tap **Add**. Explain that installation must be done from Safari.
- Include **Not now** and a way to reopen installation instructions from the site footer or menu.
- Do not request notification permission merely because the install prompt is shown. Ask separately after installation or when the patient turns notifications on.
- Persist dismissal locally for a reasonable period, not forever; provide an obvious way to reopen the prompt.

## Technical architecture

- Keep the current static HTML/CSS/JS frontend and Netlify Functions.
- Add a separate patient PWA shell under `/patient/`, with its own manifest and service worker. Keep its cache namespace and URL scope separate from `/admin/`.
- Reuse the existing Netlify Blobs appointment store, but add explicit patient ownership fields and patient-only API actions.
- Keep staff appointment management and the staff PWA unchanged unless a reviewed integration is required.
- Add patient authentication with password hashing, expiring signed sessions, rate limiting / abuse protection, and account recovery. Never trust a patient-supplied appointment ID as proof of ownership.
- For older guest bookings, link an appointment to a patient account only after a safe verification flow. Do not automatically attach appointments based only on a submitted phone number or email address.
- Push subscriptions must be stored per patient/device and tied to the authenticated patient. A patient may revoke a device subscription.
- Use generic push text such as “You have an update from H Evans Optometrist. Open the app to view it.”
- Use Meta Cloud API for WhatsApp only after the new number, Meta business setup, templates and webhook / delivery handling are configured. Keep provider credentials in Netlify environment variables. Never place access tokens in frontend code.
- Record explicit WhatsApp consent and its timestamp. Separate appointment-service messages from marketing consent. Use approved WhatsApp templates where required outside the customer-service window.
- Avoid collecting or displaying clinical records in v1. Booking notes remain staff-only and must never be included in push notifications.

## Delivery phases

### Phase 1 — Patient PWA foundation
- Create `/patient/` shell, manifest, icons and service worker.
- Add install invitation and platform-specific instructions to the public website.
- Preserve the existing booking flow and guest access.
- Add a patient-facing account entry point without exposing account functionality until its backend is ready.

### Phase 2 — Patient accounts and appointment access
- Implement registration, login, logout and secure sessions.
- Associate new bookings with the signed-in patient when applicable.
- Implement a secure claim flow for past guest bookings.
- Add My Appointments and cancellation / reschedule requests.
- Add tests for cross-account access and appointment ownership.

### Phase 3 — Push notifications
- Add patient push subscription endpoints and per-device settings.
- Send generic notifications for confirmation, changes and reminders.
- Test Android, desktop and iOS installation / notification behaviour.

### Phase 4 — Meta WhatsApp Cloud API
- Register a new dedicated number with Meta; preserve the existing WhatsApp Business number.
- Configure Netlify environment variables and approved templates.
- Send opt-in appointment confirmations and updates; handle provider errors without losing bookings.
- Keep push and WhatsApp delivery paths independent so a failure in one does not break the other.

### Phase 5 — Production testing
- Test guest booking, optional account booking, ownership boundaries, account recovery, notification opt-in / opt-out, install instructions, WhatsApp consent and provider failures.
- Verify production deployment before announcing the app to patients.

## Important implementation constraints

- The current public form posts to `/api/request`; the existing function stores guest appointments and triggers staff notifications. Preserve this behaviour while adding patient ownership safely.
- The current staff API is `/api/admin` and requires staff authentication. Patient endpoints must be separate and must never accept staff tokens as patient authentication.
- Twilio has been removed from the current code. Staff retain push alerts; patient WhatsApp contact is manual via the existing consent-gated WhatsApp link until a supported business messaging provider (preferably Meta Cloud API) is configured and tested.
- Never send appointment details, patient identifiers, phone numbers, email addresses or clinical notes in push payloads.
- Do not make account registration or app installation a condition of booking or receiving essential appointment communication.
