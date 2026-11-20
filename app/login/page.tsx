"use client";
import { useCallback,useEffect,useState,type FormEvent } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";

type AuthState={configured:boolean;state?:string;factor?:string};
export default function Login() {
  const [status,setStatus]=useState<AuthState|null>(null);
  const [factor,setFactor]=useState("");
  const [secret,setSecret]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    const response=await fetch("/api/auth");const data=await response.json();
    if(!response.ok) throw new Error(data.error);
    if(data.state==="ready") window.location.replace("/");
    setStatus(data);
    if(data.factor) setFactor(data.factor);
  },[]);
  useEffect(()=>{refresh().catch(err=>setError(err.message));},[refresh]);
  async function submit(event: FormEvent<HTMLFormElement>, action:string) {
    event.preventDefault();setError("");setBusy(true);
    try {
      const form=Object.fromEntries(new FormData(event.currentTarget));
      const response=await fetch("/api/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...form,action,factorId:factor})});
      const data=await response.json();
      if(!response.ok) throw new Error(data.error);
      if(action==="enroll"){setFactor(data.factor);setSecret(data.secret);}
      else await refresh();
    } catch(err){setError(err instanceof Error?err.message:"Sign-in failed.");}
    finally{setBusy(false);}
  }
  return <main className="login-shell"><section className="login-card">
    <img src="/brand/eis-black.png" alt="Event Innovation Systems" width={122}/>
    <p className="kicker">EIS WORKSPACE</p>
    <h1>{status?.state==="verify"||status?.state==="enroll"?"Verify your account":"Sign in"}</h1>
    {error&&<p role="alert" className="error-box">{error}</p>}
    {!status&&<p>Checking sign-in settings…</p>}
    {status&&!status.configured&&<p>Managed login is awaiting configuration.</p>}
    {status?.state==="unauthorized"&&<><p>Your account needs access from an EIS Administrator.</p><form onSubmit={e=>submit(e,"signout")}><button className="secondary">Sign out</button></form></>}
    {status?.state==="signin"&&<form className="form-stack" onSubmit={e=>submit(e,"signin")}>
      <label>Work email<input required name="email" type="email" autoComplete="email"/></label>
      <label>Password<input required name="password" type="password" autoComplete="current-password"/></label>
      <button className="primary" disabled={busy}>Sign in <ArrowRight size={16}/></button>
    </form>}
    {status?.state==="enroll"&&!factor&&<form onSubmit={e=>submit(e,"enroll")}><button className="primary" disabled={busy}><ShieldCheck size={16}/> Set up authenticator</button></form>}
    {(status?.state==="verify"||factor)&&status?.state!=="ready"&&<form className="form-stack" onSubmit={e=>submit(e,"verify")}>
      {secret&&<p>Add this setup key to your authenticator app as a time-based code. <code className="secret">{secret}</code></p>}
      <label>Six-digit code<input required name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code"/></label>
      <button className="primary" disabled={busy}>Verify <ArrowRight size={16}/></button>
    </form>}
  </section></main>;
}
