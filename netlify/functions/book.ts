import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings } from "../../db/schema.js";

// Business WhatsApp numbers that receive booking notifications (international format, no "+").
// CallMeBot issues a separate API key per phone, so each number has its own key variable.
const RECIPIENTS = [
  { phoneVar: "WHATSAPP_PHONE", defaultPhone: "27659288938", keyVar: "CALLMEBOT_API_KEY" },
  { phoneVar: "WHATSAPP_PHONE_2", defaultPhone: "27815232098", keyVar: "CALLMEBOT_API_KEY_2" },
];

const clean = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function sendWhatsApp(phone: string, apikey: string | undefined, text: string): Promise<boolean> {
  if (!apikey) {
    console.error(`No CallMeBot API key set for ${phone}; WhatsApp message not sent`);
    return false;
  }
  const url =
    "https://api.callmebot.com/whatsapp.php?" +
    new URLSearchParams({ phone, text, apikey }).toString();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.text();
    if (!res.ok || /error|invalid|not allowed/i.test(body)) {
      console.error(`CallMeBot rejected the message to ${phone}:`, res.status, body.slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error(`CallMeBot request to ${phone} failed:`, err);
    return false;
  }
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let input: Record<string, unknown>;
  try {
    input = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const booking = {
    service: clean(input.service, 100),
    date: clean(input.date, 100),
    time: clean(input.time, 10),
    name: clean(input.name, 120),
    phone: clean(input.phone, 40),
    email: clean(input.email, 160),
    notes: clean(input.notes, 1000),
  };
  if (!booking.service || !booking.date || !booking.time || !booking.name || (!booking.phone && !booking.email)) {
    return Response.json({ error: "Missing required booking details" }, { status: 400 });
  }

  const [saved] = await db.insert(bookings).values(booking).returning({ id: bookings.id });

  const message =
    `New appointment request #${saved.id}\n\n` +
    `Service: ${booking.service}\nDate: ${booking.date}\nTime: ${booking.time}\n` +
    `Name: ${booking.name}\nPhone: ${booking.phone || "-"}\nEmail: ${booking.email || "-"}\n` +
    `Notes: ${booking.notes || "-"}`;

  const results = await Promise.all(
    RECIPIENTS.map((r) =>
      sendWhatsApp(Netlify.env.get(r.phoneVar) || r.defaultPhone, Netlify.env.get(r.keyVar), message),
    ),
  );
  const sentCount = results.filter(Boolean).length;
  const sent = sentCount > 0;
  await db
    .update(bookings)
    .set({ whatsappStatus: sentCount === results.length ? "sent" : sent ? "partial" : "failed" })
    .where(eq(bookings.id, saved.id));

  return Response.json({ id: saved.id, whatsappSent: sent });
};

export const config: Config = {
  path: "/api/book",
};
