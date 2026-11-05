# Staff push notifications

Staff push alerts use the Web Push standard. They are sent to each active staff account that has enabled notifications on a device.

## Netlify environment variables

Add these variables in Netlify under **Site configuration → Environment variables**:

- `PUSH_VAPID_PUBLIC_KEY`: the VAPID public key.
- `PUSH_VAPID_PRIVATE_KEY`: the matching VAPID private key. Keep this secret; never commit it to GitHub or share it in screenshots.
- `PUSH_VAPID_SUBJECT`: a contact URI such as `mailto:admin@hevansoptometrist.co.za`.

Generate the key pair locally on Windows using PowerShell (no Node.js installation is required). Paste this whole script into PowerShell:

```powershell
function ConvertTo-Base64Url([byte[]]$Bytes) {
  [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}
$ecdsa = [System.Security.Cryptography.ECDsa]::Create([System.Security.Cryptography.ECCurve]::NamedCurves.nistP256)
$parameters = $ecdsa.ExportParameters($true)
$publicBytes = New-Object byte[] 65
$publicBytes[0] = 4
[Array]::Copy($parameters.Q.X, 0, $publicBytes, 1, 32)
[Array]::Copy($parameters.Q.Y, 0, $publicBytes, 33, 32)
Write-Output ("PUSH_VAPID_PUBLIC_KEY=" + (ConvertTo-Base64Url $publicBytes))
Write-Output ("PUSH_VAPID_PRIVATE_KEY=" + (ConvertTo-Base64Url $parameters.D))
$ecdsa.Dispose()
```

Copy the public value into `PUSH_VAPID_PUBLIC_KEY` and the private value into `PUSH_VAPID_PRIVATE_KEY` in Netlify. Keep the private value secret and never commit it to GitHub or share it in screenshots. Do not regenerate the pair after staff devices have subscribed unless you are prepared to ask everyone to enable notifications again.

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
