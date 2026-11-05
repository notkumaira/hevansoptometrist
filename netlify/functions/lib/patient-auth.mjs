import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const patients = () => getStore("patient-users");
const secret = () => process.env.PATIENT_SESSION_SECRET || "";
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const emailKey = (email) => crypto.createHash("sha256").update(email).digest("hex");
const cookieName = "hev_patient_session";

async function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { salt, passwordHash: Buffer.from(hash).toString("hex") };
}
async function passwordMatches(password, user) {
  const hash = await scrypt(password, user.salt, 64);
  return safeEqual(Buffer.from(hash).toString("hex"), user.passwordHash);
}
function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}
function tokenFor(user, remember) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    ver: user.sessionVersion || 0,
    exp: Date.now() + (remember ? 30 : 12) * 24 * 60 * 60 * 1000
  })).toString("base64url");
  return payload + "." + sign(payload);
}
function cookie(value, maxAge) {
  return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function readCookie(req) {
  const raw = req.headers.get("cookie") || "";
  const item = raw.split(";").map(x => x.trim()).find(x => x.startsWith(cookieName + "="));
  return item ? item.slice(cookieName.length + 1) : "";
}
export function clearPatientCookie() {
  return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export async function authenticatePatient(req) {
  if (!secret()) return null;
  const token = readCookie(req);
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.sub || !Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
    const user = await patients().get(data.sub, { type: "json" });
    if (!user || user.disabled || (user.sessionVersion || 0) !== data.ver) return null;
    return user;
  } catch { return null; }
}
export async function patientAction(req, body) {
  if (!secret()) return { status: 503, body: { error: "Patient accounts are not configured yet." } };
  const store = patients();
  if (body.action === "register") {
    const name = String(body.name || "").trim().slice(0, 100);
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 200) {
      return { status: 400, body: { error: "Enter your name, a valid email address and a password of at least 12 characters." } };
    }
    const id = emailKey(email);
    if (await store.get("email:" + id, { type: "json" })) {
      return { status: 409, body: { error: "An account with this email already exists. Try signing in." } };
    }
    const user = {
      id: crypto.randomUUID(), name, email, disabled: false, sessionVersion: 0,
      created: new Date().toISOString(), ...(await passwordRecord(password))
    };
    await store.setJSON(user.id, user);
    await store.setJSON("email:" + id, { userId: user.id });
    const maxAge = 12 * 24 * 60 * 60;
    return { status: 201, body: { ok: true, user: { name, email } }, cookie: cookie(tokenFor(user, false), maxAge) };
  }
  if (body.action === "login") {
    const email = String(body.email || "").trim().toLowerCase().slice(0, 254);
    const password = typeof body.password === "string" ? body.password : "";
    const index = await store.get("email:" + emailKey(email), { type: "json" });
    const user = index?.userId ? await store.get(index.userId, { type: "json" }) : null;
    if (!user || user.disabled || !password || !(await passwordMatches(password, user))) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { status: 401, body: { error: "Email or password is incorrect." } };
    }
    const remember = body.remember === true;
    const maxAge = (remember ? 30 : 12) * 24 * 60 * 60;
    return { status: 200, body: { ok: true, user: { name: user.name, email: user.email } }, cookie: cookie(tokenFor(user, remember), maxAge) };
  }
  if (body.action === "logout") return { status: 200, body: { ok: true }, cookie: clearPatientCookie() };
  const user = await authenticatePatient(req);
  if (!user) return { status: 401, body: { error: "Please sign in to continue." } };
  if (body.action === "me") return { status: 200, body: { user: { name: user.name, email: user.email } } };
  if (body.action === "appointments") {
    const appointments = getStore("appointments");
    const { blobs } = await appointments.list();
    const records = await Promise.all(blobs.map(blob => appointments.get(blob.key, { type: "json" })));
    const items = records.filter(a => a && a.patientId === user.id).map(a => ({
      id: a.id, service: a.service, date: a.date, iso: a.iso, time: a.time,
      status: a.status, created: a.created
    }));
    items.sort((a, b) => (a.iso + a.time).localeCompare(b.iso + b.time));
    return { status: 200, body: { items } };
  }
  return { status: 400, body: { error: "Unknown patient action." } };
}
