import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const users = () => getStore("staff-users");
const sessionSecret = () => process.env.STAFF_SESSION_SECRET || "";

const jsonSafe = (user) => ({
  id: user.id,
  username: user.username,
  name: user.name,
  role: user.role,
  disabled: user.disabled === true,
  created: user.created,
});

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

async function passwordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64);
  return { salt, passwordHash: Buffer.from(hash).toString("hex") };
}

async function passwordMatches(password, user) {
  const hash = await scrypt(password, user.salt, 64);
  return safeEqual(Buffer.from(hash).toString("hex"), user.passwordHash);
}

function sign(value) {
  return crypto.createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

function issueToken(user, remember) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    ver: user.sessionVersion || 0,
    exp: Date.now() + (remember ? 30 : 12) * 24 * 60 * 60 * 1000
  })).toString("base64url");
  return payload + "." + sign(payload);
}

export async function authenticate(token) {
  if (!sessionSecret() || typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!data.sub || !Number.isFinite(data.exp) || data.exp <= Date.now()) return null;
    const user = await users().get(data.sub, { type: "json" });
    if (!user || user.disabled || (user.sessionVersion || 0) !== data.ver) return null;
    return user;
  } catch {
    return null;
  }
}

export async function login(username, password, remember) {
  if (!sessionSecret()) throw new Error("STAFF_SESSION_SECRET is not configured.");
  const normalized = String(username || "").trim().toLowerCase();
  const { blobs } = await users().list();
  const records = await Promise.all(blobs.map((blob) => users().get(blob.key, { type: "json" })));
  const user = records.find((item) => item && item.username === normalized && !item.disabled);
  if (!user || typeof password !== "string" || !(await passwordMatches(password, user))) return null;
  return { token: issueToken(user, remember), user: jsonSafe(user) };
}

export async function bootstrapDoctor(body) {
  if (!process.env.STAFF_SETUP_SECRET || !sessionSecret()) {
    throw new Error("Staff setup is not configured. Add STAFF_SETUP_SECRET and STAFF_SESSION_SECRET in Netlify.");
  }
  const { blobs } = await users().list();
  if (blobs.length) throw new Error("Staff accounts have already been created.");
  if (!safeEqual(String(body.setupSecret || ""), process.env.STAFF_SETUP_SECRET)) {
    throw new Error("Incorrect setup key.");
  }
  const username = String(body.username || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!/^[a-z0-9._-]{3,32}$/.test(username) || name.length < 2 || password.length < 12) {
    throw new Error("Use a 3–32 character username, a name, and a password of at least 12 characters.");
  }
  const credentials = await passwordRecord(password);
  const user = {
    id: crypto.randomUUID(), username, name, role: "doctor", disabled: false,
    sessionVersion: 0, created: new Date().toISOString(), ...credentials
  };
  await users().setJSON(user.id, user);
  return jsonSafe(user);
}

export async function changeOwnPassword(actor, currentPassword, newPassword, remember = false) {
  const store = users();
  const user = await store.get(actor.id, { type: "json" });
  if (!user || user.disabled || (user.sessionVersion || 0) !== (actor.sessionVersion || 0)) {
    return { error: "Your session has expired. Please sign in again.", status: 401 };
  }
  if (typeof currentPassword !== "string" || !(await passwordMatches(currentPassword, user))) {
    return { error: "Your current password is incorrect.", status: 400 };
  }
  if (typeof newPassword !== "string" || newPassword.length < 12) {
    return { error: "Your new password must be at least 12 characters.", status: 400 };
  }
  if (await passwordMatches(newPassword, user)) {
    return { error: "Choose a password you are not already using.", status: 400 };
  }

  Object.assign(user, await passwordRecord(newPassword));
  user.sessionVersion = (user.sessionVersion || 0) + 1;
  user.updated = new Date().toISOString();
  await store.setJSON(user.id, user);

  // Changing the session version signs out every other device. Return a fresh
  // token for this device so the user does not have to sign in again.
  return { token: issueToken(user, remember === true), user: jsonSafe(user) };
}

export async function manageStaff(actor, body) {
  if (actor.role !== "doctor") return { error: "Only the doctor can manage staff accounts.", status: 403 };
  const store = users();
  if (body.action === "staff_list") {
    const { blobs } = await store.list();
    const records = await Promise.all(blobs.map((blob) => store.get(blob.key, { type: "json" })));
    return { users: records.filter(Boolean).map(jsonSafe) };
  }
  if (body.action === "staff_create") {
    const username = String(body.username || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");
    if (!/^[a-z0-9._-]{3,32}$/.test(username) || name.length < 2 || password.length < 12) {
      return { error: "Use a 3–32 character username, a name, and a password of at least 12 characters.", status: 400 };
    }
    const { blobs } = await store.list();
    const records = await Promise.all(blobs.map((blob) => store.get(blob.key, { type: "json" })));
    if (records.some((item) => item && item.username === username)) return { error: "That username is already in use.", status: 409 };
    const user = {
      id: crypto.randomUUID(), username, name, role: "staff", disabled: false,
      sessionVersion: 0, created: new Date().toISOString(), ...(await passwordRecord(password))
    };
    await store.setJSON(user.id, user);
    return { user: jsonSafe(user) };
  }
  if (body.action === "staff_disable" || body.action === "staff_enable" || body.action === "staff_reset_password") {
    const id = String(body.userId || "");
    const user = await store.get(id, { type: "json" });
    if (!user || user.role !== "staff") return { error: "Staff account not found.", status: 404 };
    if (body.action === "staff_disable") user.disabled = true;
    if (body.action === "staff_enable") user.disabled = false;
    if (body.action === "staff_reset_password") {
      const password = String(body.password || "");
      if (password.length < 12) return { error: "The new password must be at least 12 characters.", status: 400 };
      Object.assign(user, await passwordRecord(password));
    }
    user.sessionVersion = (user.sessionVersion || 0) + 1;
    user.updated = new Date().toISOString();
    await store.setJSON(id, user);
    return { user: jsonSafe(user) };
  }
  return null;
}
