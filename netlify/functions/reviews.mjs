// Public: GET returns approved reviews, POST submits a new review for moderation.
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/reviews" };

const j = (o, s = 200, h = {}) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...h } });

export default async (req) => {
  const store = getStore("reviews");

  if (req.method === "GET") {
    const { blobs } = await store.list();
    const all = (await Promise.all(blobs.map((x) => store.get(x.key, { type: "json" }))))
      .filter((r) => r && r.status === "approved")
      .sort((a, b) => b.created.localeCompare(a.created));
    const count = all.length;
    const avg = count ? Math.round((all.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
    return j(
      { count, avg, items: all.slice(0, 30).map(({ name, rating, text, created }) => ({ name, rating, text, created })) },
      200, { "Cache-Control": "public, max-age=60" }
    );
  }

  if (req.method !== "POST") return j({ error: "Not allowed" }, 405);
  let b;
  try { b = await req.json(); } catch { return j({ error: "Bad request" }, 400); }
  if (b.website) return j({ ok: true }); // hidden field: bots fill it in, people don't
  const name = String(b.name ?? "").trim().slice(0, 60);
  const text = String(b.text ?? "").trim().slice(0, 1000);
  const rating = Math.round(Number(b.rating));
  if (!name || text.length < 5 || !(rating >= 1 && rating <= 5)) return j({ error: "Please add your name, a rating and a short comment." }, 400);
  if (/https?:\/\/|www\./i.test(text)) return j({ error: "Please leave out web links." }, 400);
  const id = crypto.randomUUID();
  await store.setJSON(id, { id, name, rating, text, status: "pending", created: new Date().toISOString() });
  return j({ ok: true });
};
