// Staff only: log in, list requests, approve or decline.
// Env vars: ADMIN_PASSWORD, TWILIO_ACCOUNT_SID, TWILIO_API_KEY,
// TWILIO_API_SECRET, TWILIO_WHATSAPP_FROM.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const config = { path: "/api/admin" };

const j = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const secret = () => process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD || "";
const sign = (t) => crypto.createHmac("sha256", secret()).update(String(t)).digest("hex");
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const valid = (tok) => { const [exp, sig] = String(tok || "").split("."); return !!(exp && sig && Number(exp) > Date.now() && same(sig, sign(exp))); };
const waNumber = (p) => { let d = String(p).replace(/\D/g, ""); if (d.startsWith("0")) d = "27" + d.slice(1); return d; };

function whatsappAddress(value) {
  let number = String(value || "").trim().replace(/^whatsapp:/i, "").replace(/[\s()-]/g, "");
  if (number.startsWith("0")) number = "+27" + number.slice(1);
  if (!number.startsWith("+")) number = "+" + number;
  return /^\+\d{8,15}$/.test(number) ? "whatsapp:" + number : "";
}

function message(a) {
  if (a.status === "confirmed")
    return `Hi ${a.name}, your appointment at H Evans Optometrist is confirmed.\n\n${a.service}\n${a.date} at ${a.time}\n2697 Kiepersol Street, Extension 3, Eldorado Park\n\nPlease bring your current spectacles, contact lenses and medical aid card. To change your booking, call 065 928 8938.`;
  return `Hi ${a.name}, sorry, we can't fit you in for ${a.service} on ${a.date} at ${a.time}. Please book another time at hevansoptometrist.co.za or call 065 928 8938.`;
}
const waLink = (a) => !a.whatsappConsent || a.status === "pending" ? "" : `https://wa.me/${waNumber(a.phone)}?text=${encodeURIComponent(message(a))}`;

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
      console.error("Twilio patient WhatsApp confirmation failed:", response.status, detail.slice(0, 500));
    }
    return response.ok;
  } catch (error) {
    console.error("Twilio patient WhatsApp confirmation failed:", error?.message || error);
    return false;
  }
}

// The caller only invokes this for the first transition into "confirmed".
// A patient must have opted in on the booking form before an automated message is sent.
async function autoSend(a) {
  if (a.status !== "confirmed" || a.whatsappConsent !== true) return false;
  return sendTwilioWhatsApp(a.phone, message(a));
}

export default async (req) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!process.env.ADMIN_PASSWORD) return j({ error: "Admin password is not set up yet." }, 500);
  let b;
  try { b = await req.json(); } catch { return j({ error: "Bad request" }, 400); }

  if (b.action === "login") {
    if (typeof b.password === "string" && same(sign(b.password), sign(process.env.ADMIN_PASSWORD))) {
      const exp = String(Date.now() + (b.remember ? 30 * 24 : 12) * 3600e3);
      return j({ token: exp + "." + sign(exp) });
    }
    await new Promise((r) => setTimeout(r, 800));
    return j({ error: "Wrong password" }, 401);
  }
  if (!valid(b.token)) return j({ error: "Please sign in again" }, 401);

  const store = getStore("appointments");
  if (b.action === "list") {
    const { blobs } = await store.list();
    const items = (await Promise.all(blobs.map((x) => store.get(x.key, { type: "json" })))).filter(Boolean);
    items.sort((p, q) => (p.iso + p.time).localeCompare(q.iso + q.time) || p.created.localeCompare(q.created));
    return j({ items: items.map((a) => ({ ...a, wa: waLink(a) })) });
  }
  if (b.action === "delete") {
    await store.delete(String(b.id));
    return j({ ok: true });
  }
  if (b.action === "update" && ["pending", "confirmed", "declined"].includes(b.status)) {
    const a = await store.get(String(b.id), { type: "json" });
    if (!a) return j({ error: "Not found" }, 404);
    const wasConfirmed = a.status === "confirmed";
    a.status = b.status; a.updated = new Date().toISOString();
    await store.setJSON(a.id, a);
    const sent = b.status === "confirmed" && !wasConfirmed ? await autoSend(a) : false;
    return j({ item: { ...a, wa: waLink(a) }, sent });
  }
  const rs = getStore("reviews");
  if (b.action === "reviews") {
    const { blobs } = await rs.list();
    const items = (await Promise.all(blobs.map((x) => rs.get(x.key, { type: "json" })))).filter(Boolean);
    items.sort((p, q) => q.created.localeCompare(p.created));
    return j({ items });
  }
  if (b.action === "review_set") {
    const id = String(b.id);
    if (b.status === "delete") { await rs.delete(id); return j({ ok: true }); }
    if (!["approved", "rejected", "pending"].includes(b.status)) return j({ error: "Bad status" }, 400);
    const r = await rs.get(id, { type: "json" });
    if (!r) return j({ error: "Not found" }, 404);
    r.status = b.status;
    await rs.setJSON(id, r);
    return j({ item: r });
  }
  return j({ error: "Unknown action" }, 400);
};
