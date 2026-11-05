import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);
const users = () => getStore("patient-users");
const tokens = () => getStore("patient-email-tokens");
const secret = () => process.env.PATIENT_SESSION_SECRET || "";
const safeEqual = (a,b) => { const x=Buffer.from(String(a)); const y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); };
const emailKey = (email) => crypto.createHash("sha256").update(email).digest("hex");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const clean = (s) => String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function passwordRecord(password) {
  const salt=crypto.randomBytes(16).toString("hex");
  return {salt,passwordHash:Buffer.from(await scrypt(password,salt,64)).toString("hex")};
}
async function passwordMatches(password,user) {
  return safeEqual(Buffer.from(await scrypt(password,user.salt,64)).toString("hex"),user.passwordHash);
}
function sign(value) { return crypto.createHmac("sha256",secret()).update(value).digest("base64url"); }
function issueSession(user) {
  const payload=Buffer.from(JSON.stringify({sub:user.id,ver:user.sessionVersion||0,exp:Date.now()+7*24*60*60*1000})).toString("base64url");
  return payload+"."+sign(payload);
}
export async function patientFromCookie(cookie) {
  if(!secret()) return null;
  const match=String(cookie||"").match(/(?:^|;\\s*)hevans_patient_session=([^;]+)/);
  if(!match) return null;
  const [payload,signature]=decodeURIComponent(match[1]).split(".");
  if(!payload||!signature||!safeEqual(signature,sign(payload))) return null;
  try {
    const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(!data.sub||!Number.isFinite(data.exp)||data.exp<=Date.now()) return null;
    const user=await users().get(data.sub,{type:"json"});
    if(!user||!user.verified||user.disabled||(user.sessionVersion||0)!==data.ver) return null;
    return user;
  } catch { return null; }
}
export function sessionCookie(token) {
  return "hevans_patient_session="+encodeURIComponent(token)+"; Path=/api/patient; Max-Age=604800; HttpOnly; Secure; SameSite=Strict";
}
export function clearSessionCookie() {
  return "hevans_patient_session=; Path=/api/patient; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}
async function sendEmail(to,subject,html) {
  if(!process.env.RESEND_API_KEY||!process.env.PATIENT_EMAIL_FROM) throw new Error("Patient email is not configured.");
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.PATIENT_EMAIL_FROM,to:[to],subject,html})});
  if(!response.ok) { const detail=await response.text(); console.error("Patient email provider error:",response.status,detail.slice(0,300)); throw new Error("Could not send account email."); }
}
export async function createPatient(email,name,password) {
  if(!secret()) throw new Error("Patient accounts are not configured.");
  const normalized=String(email||"").trim().toLowerCase();
  const fullName=String(name||"").trim().replace(/\\s+/g," ").slice(0,100);
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalized)||normalized.length>254) return {error:"Enter a valid email address.",status:400};
  if(fullName.length<2) return {error:"Enter your full name.",status:400};
  if(typeof password!=="string"||password.length<12||password.length>128) return {error:"Use a password of at least 12 characters.",status:400};
  const id=emailKey(normalized),store=users();
  const existing=await store.get(id,{type:"json"});
  if(existing) return {ok:true,message:"If this email can be registered, a verification email will be sent."};
  const record={id,email:normalized,name:fullName,verified:false,disabled:false,sessionVersion:0,created:new Date().toISOString(),...(await passwordRecord(password))};
  await store.setJSON(id,record);
  const raw=crypto.randomBytes(32).toString("base64url"),key=hashToken(raw);
  await tokens().setJSON(key,{userId:id,purpose:"verify",expires:Date.now()+30*60*1000});
  const url=(process.env.URL||"https://hevansoptometrist.co.za")+"/api/patient?action=verify&token="+encodeURIComponent(raw);
  try { await sendEmail(normalized,"Verify your H Evans Optometrist account",'<p>Hello '+clean(fullName)+',</p><p>Verify your email address to activate your patient account.</p><p><a href="'+url+'">Verify my email</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>'); }
  catch(error) { await store.delete(id); await tokens().delete(key); throw error; }
  return {ok:true,message:"If this email can be registered, a verification email will be sent."};
}
export async function verifyPatient(raw) {
  const key=hashToken(String(raw||"")),store=tokens(),entry=await store.get(key,{type:"json"});
  if(!entry||entry.purpose!=="verify"||entry.expires<Date.now()) return false;
  const user=await users().get(entry.userId,{type:"json"});
  if(!user) return false;
  user.verified=true;user.verifiedAt=new Date().toISOString();
  await users().setJSON(user.id,user);await store.delete(key);return true;
}
export async function loginPatient(email,password) {
  const normalized=String(email||"").trim().toLowerCase(),id=emailKey(normalized);
  const user=await users().get(id,{type:"json"});
  if(!user||user.disabled||!user.verified||typeof password!=="string"||!(await passwordMatches(password,user))) return null;
  return {token:issueSession(user),patient:{name:user.name,email:user.email}};
}
export async function requestPasswordReset(email) {
  const normalized=String(email||"").trim().toLowerCase(),id=emailKey(normalized),user=await users().get(id,{type:"json"});
  if(!user||!user.verified||user.disabled) return;
  const raw=crypto.randomBytes(32).toString("base64url"),key=hashToken(raw);
  await tokens().setJSON(key,{userId:id,purpose:"reset",expires:Date.now()+30*60*1000});
  const url=(process.env.URL||"https://hevansoptometrist.co.za")+"/patient/?reset="+encodeURIComponent(raw);
  await sendEmail(normalized,"Reset your H Evans Optometrist password",'<p>Hello '+clean(user.name)+',</p><p>Use the link below to choose a new password.</p><p><a href="'+url+'">Reset my password</a></p><p>This link expires in 30 minutes. If you did not request this, ignore this email.</p>');
}
export async function resetPatientPassword(raw,password) {
  if(typeof password!=="string"||password.length<12||password.length>128) return {error:"Use a password of at least 12 characters.",status:400};
  const key=hashToken(String(raw||"")),store=tokens(),entry=await store.get(key,{type:"json"});
  if(!entry||entry.purpose!=="reset"||entry.expires<Date.now()) return {error:"This reset link has expired. Request a new one.",status:400};
  const user=await users().get(entry.userId,{type:"json"});
  if(!user||!user.verified) return {error:"This reset link is no longer valid.",status:400};
  Object.assign(user,await passwordRecord(password));user.sessionVersion=(user.sessionVersion||0)+1;user.updated=new Date().toISOString();
  await users().setJSON(user.id,user);await store.delete(key);return {ok:true};
}
