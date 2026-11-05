import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { createPatient, verifyPatient, loginPatient, patientFromCookie, sessionCookie, clearSessionCookie, requestPasswordReset, resetPatientPassword } from "./lib/patient-auth.mjs";

export const config = { path: "/api/patient" };
const json=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store",...headers}});
const html=(body,status=200)=>new Response(body,{status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
const cookie=(req)=>req.headers.get("cookie")||"";
async function limited(req,action) {
  const ip=req.headers.get("x-nf-client-connection-ip")||req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
  const key=crypto.createHash("sha256").update(action+":"+ip).digest("hex");
  const store=getStore("patient-auth-rate-limits"),now=Date.now(),record=await store.get(key,{type:"json"});
  if(record&&record.until>now&&record.count>=8) return false;
  const next=record&&record.until>now?{count:record.count+1,until:record.until}:{count:1,until:now+15*60*1000};
  await store.setJSON(key,next);return true;
}
export default async (req) => {
  const url=new URL(req.url),action=url.searchParams.get("action")||"";
  if(req.method==="GET"&&action==="verify"){
    const ok=await verifyPatient(url.searchParams.get("token"));
    return html('<!doctype html><meta name="viewport" content="width=device-width"><title>H Evans Optometrist</title><main style="font:16px Arial;max-width:520px;margin:12vh auto;padding:24px;color:#141f4a"><h1>'+(ok?"Email verified":"Link expired or invalid")+'</h1><p>'+(ok?"Your patient account is ready. You can now sign in.":"Please return to the patient app and request a new verification email.")+'</p><p><a href="/patient/">Open patient app</a></p></main>',ok?200:400);
  }
  if(req.method==="GET"&&action==="me"){
    const user=await patientFromCookie(cookie(req));
    return user?json({patient:{name:user.name,email:user.email}}):json({error:"Please sign in."},401);
  }
  if(req.method!=="POST") return json({error:"Method not allowed."},405);
  let body;try{body=await req.json()}catch{return json({error:"Invalid request."},400)}
  if(!body||typeof body!=="object"||Array.isArray(body)) return json({error:"Invalid request."},400);
  const task=String(body.action||"");
  if(["register","login","forgot","reset"].includes(task)&&!(await limited(req,task))) return json({error:"Too many attempts. Please wait 15 minutes and try again."},429);
  try {
    if(task==="register"){
      const result=await createPatient(body.email,body.name,body.password);
      return json(result,result.status||200);
    }
    if(task==="login"){
      const result=await loginPatient(body.email,body.password);
      if(!result){await new Promise(r=>setTimeout(r,500));return json({error:"Email, password or verification details are incorrect."},401)}
      return json({ok:true,patient:result.patient},200,{"Set-Cookie":sessionCookie(result.token)});
    }
    if(task==="logout") return json({ok:true},200,{"Set-Cookie":clearSessionCookie()});
    if(task==="forgot"){
      await requestPasswordReset(body.email);
      return json({ok:true,message:"If a verified account exists for that email, a password-reset link will be sent."});
    }
    if(task==="reset"){
      const result=await resetPatientPassword(body.token,body.password);
      return json(result,result.status||200);
    }
    return json({error:"Unknown action."},400);
  } catch(error) {
    console.error("Patient account action failed:",error?.message||error);
    return json({error:"We couldn't complete that request right now. Please try again later."},500);
  }
};
