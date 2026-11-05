import { patientAction } from "./lib/patient-auth.mjs";

export const config = { path: "/api/patient" };
const json = (body, status, cookie) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...(cookie ? { "Set-Cookie": cookie } : {})
  }
});
export default async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request." }, 400);
  try {
    const result = await patientAction(req, body);
    return json(result.body, result.status, result.cookie);
  } catch (error) {
    console.error("Patient API error:", error?.message || error);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};
