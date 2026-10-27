// Staff only: log in, list requests, approve or decline.
// Env vars: ADMIN_PASSWORD (required). Optional: ADMIN_SECRET,
// WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE (automatic sending).
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

function message(a) {
  if (a.status === "confirmed")
    return `Hi ${a.name}, your appointment at H Evans Optometrist is confirmed.\n\n${a.service}\n${a.date} at ${a.time}\n2697 Kiepersol Street, Extension 3, Eldorado Park\n\nPlease bring your current spectacles, contact lenses and medical aid card. To change your booking, call 065 928 8938.`;
  return `Hi ${a.name}, sorry, we can't fit you in for ${a.service} on ${a.date} at ${a.time}. Please book another time at hevansoptometrist.co.za or call 065 928 8938.`;
}
const waLink = (a) => a.status === "pending" ? "" : `https://wa.me/${waNumber(a.phone)}?text=${encodeURIComponent(message(a))}`;

async function autoSend(a) {
  const { WHATSAPP_TOKEN: t, WHATSAPP_PHONE_ID: id, WHATSAPP_TEMPLATE: tpl } = process.env;
  if (!t || !id || !tpl || a.status !== "confirmed") return false;
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${id}/messages`, {
      method: "POST",
      headers: { Authorization: "Bearer " + t, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: waNumber(a.phone), type: "template",
        template: { name: tpl, language: { code: "en" }, components: [{ type: "body",
          parameters: [a.name, a.service, a.date, a.time].map((text) => ({ type: "text", text })) }] },
      }),
    });
    return r.ok;
  } catch { return false; }
}

export default async (req) => {
  if (req.method !== "POST") return j({ error: "POST only" }, 405);
  if (!process.env.ADMIN_PASSWORD) return j({ error: "Admin password is not set up yet." }, 500);
  let b;
  try { b = await req.json(); } catch { return j({ error: "Bad request" }, 400); }

  if (b.action === "login") {
    if (typeof b.password === "string" && same(sign(b.password), sign(process.env.ADMIN_PASSWORD))) {
      const exp = String(Date.now() + 12 * 3600e3);
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
  if (b.action === "update" && ["pending", "confirmed", "declined"].includes(b.status)) {
    const a = await store.get(String(b.id), { type: "json" });
    if (!a) return j({ error: "Not found" }, 404);
    a.status = b.status; a.updated = new Date().toISOString();
    await store.setJSON(a.id, a);
    const sent = await autoSend(a);
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
