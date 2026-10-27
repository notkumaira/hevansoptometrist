// Public: saves a booking request as "pending" for staff to approve.
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/request" };

const j = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

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
  return j({ ok: true });
};
