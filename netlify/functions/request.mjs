// Public: saves a booking request as "pending" for staff to approve.
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/request" };

const j = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

function whatsappAddress(value) {
  let number = String(value || "").trim().replace(/^whatsapp:/i, "").replace(/[\s()-]/g, "");
  if (number.startsWith("0")) number = "+27" + number.slice(1);
  if (!number.startsWith("+")) number = "+" + number;
  return /^\+\d{8,15}$/.test(number) ? "whatsapp:" + number : "";
}

async function sendTwilioWhatsApp(to, body) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_API_KEY: key, TWILIO_API_SECRET: secret } = process.env;
  const from = whatsappAddress(process.env.TWILIO_WHATSAPP_FROM);
  const recipient = whatsappAddress(to);
  if (!sid || !key || !secret || !from || !recipient) return false;

  const auth = Buffer.from(key + ":" + secret).toString("base64");
  const form = new URLSearchParams({ From: from, To: recipient, Body: body });
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: { Authorization: "Basic " + auth, "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!response.ok) {
      const detail = await response.text();
      console.error("Twilio staff WhatsApp notification failed:", response.status, detail.slice(0, 500));
    }
    return response.ok;
  } catch (error) {
    console.error("Twilio staff WhatsApp notification failed:", error?.message || error);
    return false;
  }
}

// Staff alerts contain appointment logistics only, never patient notes or clinical details.
async function notifyStaff(a) {
  const recipients = [
    process.env.TWILIO_STAFF_NUMBER_1,
    process.env.TWILIO_STAFF_NUMBER_2,
  ].filter(Boolean);
  if (!recipients.length) return;
  const body = `New appointment request\nService: ${a.service}\nDate: ${a.date}\nTime: ${a.time}\n\nOpen hevansoptometrist.co.za/admin/ to review.`;
  await Promise.allSettled(recipients.map((to) => sendTwilioWhatsApp(to, body)));
}

export default async (req) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  let b;
  try { b = await req.json(); } catch { return j({ error: "Bad request" }, 400); }
  const c = (v, n = 200) => String(v ?? "").trim().slice(0, n);
  const a = {
    id: crypto.randomUUID(),
    service: c(b.service), date: c(b.date), iso: c(b.iso, 10), time: c(b.time, 5),
    name: c(b.name), phone: c(b.phone, 30), email: c(b.email), notes: c(b.notes, 1000),
    whatsappConsent: b.whatsappConsent === true,
    whatsappConsentAt: b.whatsappConsent === true ? new Date().toISOString() : null,
    status: "pending", created: new Date().toISOString(),
  };
  if (!a.service || !a.date || !/^\d{4}-\d{2}-\d{2}$/.test(a.iso) || !/^\d{2}:\d{2}$/.test(a.time) || !a.name || !a.phone)
    return j({ error: "Missing details" }, 400);
  await getStore("appointments").setJSON(a.id, a);
  await notifyStaff(a);
  return j({ ok: true });
};
