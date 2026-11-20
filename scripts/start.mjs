import { cp, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const root = ".next/standalone";
await mkdir(root+"/.next",{recursive:true});
await cp(".next/static",root+"/.next/static",{recursive:true});
await cp("public",root+"/public",{recursive:true});
const child=spawn(process.execPath,["server.js"],{cwd:root,stdio:"inherit",env:{...process.env,HOSTNAME:process.env.EIS_BIND_HOST??"127.0.0.1"}});
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal));
child.on("exit",code=>{process.exitCode=code??1;});
