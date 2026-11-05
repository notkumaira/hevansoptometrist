# Staff push notifications

Staff push alerts use the Web Push standard. They are sent to each active staff account that has enabled notifications on a device.

## Netlify environment variables

Add these variables in Netlify under **Site configuration → Environment variables**:

- `PUSH_VAPID_PUBLIC_KEY`: the VAPID public key.
- `PUSH_VAPID_PRIVATE_KEY`: the matching VAPID private key. Keep this secret; never commit it to GitHub or share it in screenshots.
- `PUSH_VAPID_SUBJECT`: a contact URI such as `mailto:admin@hevansoptometrist.co.za`.

Generate a VAPID key pair once using the `web-push` package (for example, `npx web-push generate-vapid-keys`). Put the public and private values into the matching Netlify variables. Do not regenerate them after staff devices have subscribed unless you are prepared to ask everyone to enable notifications again.

After saving the variables, trigger a new Netlify deploy.

## Enable on each staff device

1. Open `https://hevansoptometrist.co.za/admin/` and sign in.
2. Open **My account**.
3. Under **Push notifications**, choose **Enable notifications** and allow the browser permission prompt.
4. Repeat on each device used by each staff member.

On iPhone and iPad, first use Safari's **Share → Add to Home Screen**, open the installed staff app, then enable notifications from inside it. Web push on iOS/iPadOS requires a Home Screen web app and a supported OS version.

## Privacy and behaviour

- Alerts use generic wording only. They do not include a patient's name, phone number, email address, appointment details or notes.
- Tapping an alert opens the staff sign-in page.
- Each device is subscribed separately. Staff can turn off notifications for a device under **My account**.
- Disabled staff accounts are skipped when new alerts are sent.
- Push delivery is best-effort. A push failure does not stop a patient booking request from being saved.
- Existing WhatsApp notification configuration is unchanged.
