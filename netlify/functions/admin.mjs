// Staff only: individual staff authentication and appointment management.
// Env vars: STAFF_SESSION_SECRET, STAFF_SETUP_SECRET, TWILIO_ACCOUNT_SID, TWILIO_API_KEY,
// TWILIO_API_SECRET, TWILIO_WHATSAPP_FROM.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { authenticate, login, bootstrapDoctor, manageStaff, changeOwnPassword } from "./lib/staff-auth.mjs";

export const config = { path: "/api/admin" };

const j = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
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
  let b;
  try { b = await req.json(); }
  catch { return j({ error: "Invalid request." }, 400); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return j({ error: "Invalid request." }, 400);
  if (b.action === "bootstrap") {
    try { return j({ user: await bootstrapDoctor(b) }); }
    catch (error) { return j({ error: error.message || "Could not set up the doctor account." }, 400); }
  }

  if (b.action === "login") {
    try {
      const result = await login(b.username, b.password, b.remember === true);
      if (!result) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        return j({ error: "Incorrect username or password." }, 401);
      }
      return j(result);
    } catch (error) {
      return j({ error: error.message || "Login is not configured." }, 500);
    }
  }

  const actor = await authenticate(b.token);
  if (!actor) return j({ error: "Please sign in again." }, 401);

  if (b.action === "change_password") {
    try {
      const result = await changeOwnPassword(actor, b.currentPassword, b.newPassword, b.remember === true);
      if (result.status) {
        const status = result.status;
        delete result.status;
        return j(result, status);
      }
      return j(result);
    } catch (error) {
      console.error("Staff password change failed:", error?.message || error);
      return j({ error: "Could not change your password. Please try again." }, 500);
    }
  }

  if (b.action === "me") return j({ user: { id: actor.id, username: actor.username, name: actor.name, role: actor.role } });

  const staffResult = await manageStaff(actor, b);
  if (staffResult) {
    const status = staffResult.status || 200;
    delete staffResult.status;
    return j(staffResult, status);
  }

  const store = getStore("appointments");
  if (b.action === "activity") {
    if (actor.role !== "doctor") return j({ error: "Only the doctor can view the activity log." }, 403);
    const activityStore = getStore("staff-activity");
    const { blobs } = await activityStore.list();
    const events = (await Promise.all(blobs.map((blob) => activityStore.get(blob.key, { type: "json" })))).filter(Boolean);
    events.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    const recent = events.slice(0, 100);
    const entries = await Promise.all(recent.map(async (event) => {
      const appointment = event.appointmentId ? await store.get(event.appointmentId, { type: "json" }) : null;
      return {
        type: event.type || "activity",
        status: event.status || "",
        staffName: event.staffName || "Unknown staff member",
        at: event.at || null,
        appointment: appointment ? {
          name: appointment.name || "",
          service: appointment.service || "",
          date: appointment.date || "",
          time: appointment.time || ""
        } : (event.appointmentSnapshot || null)
      };
    }));
    return j({ items: entries });
  }
  if (b.action === "list") {
    const { blobs } = await store.list();
    const items = (await Promise.all(blobs.map((x) => store.get(x.key, { type: "json" })))).filter(Boolean);
    items.sort((p, q) => (p.iso + p.time).localeCompare(q.iso + q.time) || p.created.localeCompare(q.created));
    return j({ items: items.map((a) => ({ ...a, wa: waLink(a) })) });
  }
  if (b.action === "delete") {
    const id = String(b.id);
    const appointment = await store.get(id, { type: "json" });
    if (!appointment) return j({ error: "Not found" }, 404);
    await getStore("staff-activity").setJSON(crypto.randomUUID(), {
      type: "appointment_deleted",
      appointmentId: id,
      appointmentSnapshot: {
        name: appointment.name || "",
        service: appointment.service || "",
        date: appointment.date || "",
        time: appointment.time || ""
      },
      status: "deleted",
      staffId: actor.id,
      staffName: actor.name,
      at: new Date().toISOString()
    });
    await store.delete(id);
    return j({ ok: true });
  }
  if (b.action === "update" && ["pending", "confirmed", "declined"].includes(b.status)) {
    const a = await store.get(String(b.id), { type: "json" });
    if (!a) return j({ error: "Not found" }, 404);
    const wasConfirmed = a.status === "confirmed";
    a.status = b.status; a.updated = new Date().toISOString();
    a.updatedBy = { id: actor.id, name: actor.name, username: actor.username };
    await store.setJSON(a.id, a);
    await getStore("staff-activity").setJSON(crypto.randomUUID(), { type: "appointment_status", appointmentId: a.id, status: b.status, staffId: actor.id, staffName: actor.name, at: a.updated });
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
