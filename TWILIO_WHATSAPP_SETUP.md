# Twilio WhatsApp notifications

The booking flow uses `/api/request` and the staff dashboard uses `/api/admin`. WhatsApp sending happens only in Netlify Functions; credentials must never be placed in browser code.

## Netlify environment variables

Set these in **Netlify → Site configuration → Environment variables**, then redeploy:

| Variable | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID (`AC...`) |
| `TWILIO_API_KEY` | Twilio API Key SID (`SK...`) |
| `TWILIO_API_SECRET` | Secret belonging to that API Key |
| `TWILIO_WHATSAPP_FROM` | WhatsApp sender, including prefix, e.g. `whatsapp:+14155238886` for the Twilio Sandbox |
| `TWILIO_STAFF_NUMBER_1` | First staff recipient in international format, e.g. `+2765...` |
| `TWILIO_STAFF_NUMBER_2` | Second staff recipient in international format, e.g. `+2781...` |

Keep all values private. Do not use `VITE_`, `NEXT_PUBLIC_`, or any browser-exposed variable prefix.

## Sandbox testing limitations

The Twilio WhatsApp Sandbox is a test sender, not a production sender. Each recipient (including each staff phone and any test patient phone) must first join the Sandbox by sending its displayed join phrase to the Sandbox number. Sandbox delivery is limited to enrolled participants and the Sandbox rules, including the customer-service session window. Do not use it to send appointment confirmations to ordinary patients.

Before production patient messaging, register/enable a dedicated WhatsApp sender in Twilio and update `TWILIO_WHATSAPP_FROM`. For business-initiated messages outside the WhatsApp customer-service window, create and approve an appropriate WhatsApp message template and implement template sending. Do not assume a free-form message will be delivered outside the permitted window.

## Consent behaviour

The public booking form now has an optional, unchecked WhatsApp-consent checkbox. A request can still be submitted without ticking it. Staff alerts are sent independently to the configured staff recipients. Automated patient confirmation is attempted only when the patient opted in and staff changes the appointment from a non-confirmed status to confirmed. Re-saving an already confirmed appointment does not trigger another automatic message.

Older bookings without the consent field are treated as not opted in. The admin dashboard will indicate when a patient needs to be contacted by phone instead. Patient notes and clinical details are not included in staff WhatsApp alerts.
