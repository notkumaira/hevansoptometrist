// Public: saves a booking request as "pending" for staff to approve.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";

export const config = { path: "/api/request" };

const j = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

// Push messages intentionally contain no patient name, phone number, email or clinical notes.
async function notifyStaffPush() {
  const publicKey = process.env.PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.PUSH_VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return;

  try {
    webpush.setVapidDetails(
      process.env.PUSH_VAPID_SUBJECT || "mailto:admin@hevansoptometrist.co.za",
      publicKey,
      privateKey
    );
    const store = getStore("staff-push-subscriptions");
    const users = getStore("staff-users");
    const { blobs } = await store.list();
    const subscriptions = await Promise.all(
      blobs.map(async (blob) => {
        const value = await store.get(blob.key, { type: "json" });
        const user = value?.userId ? await users.get(value.userId, { type: "json" }) : null;
        return { key: blob.key, value, active: Boolean(user && !user.disabled) };
      })
    );
    const payload = JSON.stringify({
      title: "H Evans Optometrist",
      body: "A new appointment request has arrived. Sign in to review it.",
      url: "/admin/"
    });
    await Promise.allSettled(subscriptions.filter((entry) => entry.active && entry.value?.endpoint && entry.value?.keys)
      .map(async ({ key, value }) => {
        try {
          await webpush.sendNotification(
            { endpoint: value.endpoint, keys: value.keys },
            payload,
            { TTL: 60 }
          );
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await store.delete(key);
          } else {
            console.error("Staff push notification failed:", error?.message || error);
          }
        }
      }));
  } catch (error) {
    // Notification failures must never prevent a patient from submitting a booking.
    console.error("Staff push notification setup failed:", error?.message || error);
  }
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
  await notifyStaffPush();
  return j({ ok: true });
};
