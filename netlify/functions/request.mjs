// Public: saves a booking request as "pending" for staff to approve.
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/request" };

const j = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

// Optional free staff alert via CallMeBot. Set STAFF_WHATSAPP to "+27821234567:APIKEY,+27831234567:APIKEY2".
// Patient details are NOT included in the alert, only the service and time.
async function notifyStaff(a) {
  const staff = (process.env.STAFF_WHATSAPP || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!staff.length) return;
  const text = `New appointment request: ${a.service} on ${a.date} at ${a.time}. Open hevansoptometrist.co.za/admin/ to approve.`;
  await Promise.allSettled(staff.map((entry) => {
    const [phone, key] = entry.split(":");
    if (!phone || !key) return null;
    return fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(key)}`,
      { signal: AbortSignal.timeout(6000) });
  }));
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
    status: "pending", created: new Date().toISOString(),
  };
  if (!a.service || !a.date || !/^\d{4}-\d{2}-\d{2}$/.test(a.iso) || !/^\d{2}:\d{2}$/.test(a.time) || !a.name || !a.phone)
    return j({ error: "Missing details" }, 400);
  await getStore("appointments").setJSON(a.id, a);
  await notifyStaff(a);
  return j({ ok: true });
};
