import { z } from "zod";
import { authClient, currentStaff, identity } from "@/lib/auth";
import { db } from "@/lib/db";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { WorkspaceError } from "@/lib/workspace";

export async function GET() {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return Response.json({configured:false});
    const session = await identity();
    if (!session) return Response.json({configured:true,state:"signin"});
    if (!session.user.email_confirmed_at || !session.user.email) throw new WorkspaceError("Confirm your account email first.",403);
    const {rowCount} = await db().query("SELECT 1 FROM staff WHERE email=$1 AND active AND (auth_id IS NULL OR auth_id=$2)",[session.user.email.toLowerCase(),session.user.id]);
    if (!rowCount) return Response.json({configured:true,state:"unauthorized"});
    const {data,error}=await session.auth.auth.mfa.listFactors();
    if (error) throw error;
    const factor=data.totp.find(item=>item.status==="verified");
    const authorized=await currentStaff();
    return Response.json({configured:true,state:authorized?"ready":factor?"verify":"enroll",factor:factor?.id},{headers:{"Cache-Control":"no-store"}});
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body=await request.json();
    const auth=await authClient();
    if (body.action==="signin") {
      const data=z.object({email:z.email(),password:z.string().min(1).max(512)}).parse(body);
      const {error}=await auth.auth.signInWithPassword(data);
      if (error) throw new WorkspaceError("Sign-in failed. Check your account email and password.",401);
      return Response.json({ok:true});
    }
    if (body.action==="signout") {
      await auth.auth.signOut({scope:"local"});
      return Response.json({ok:true});
    }
    const session=await identity();
    if (!session?.user.email || !session.user.email_confirmed_at) throw new WorkspaceError("Sign in first.",401);
    const {rowCount}=await db().query("SELECT 1 FROM staff WHERE email=$1 AND active AND (auth_id IS NULL OR auth_id=$2)",[session.user.email.toLowerCase(),session.user.id]);
    if (!rowCount) throw new WorkspaceError("Ask an Administrator to activate your EIS account.",403);
    if (body.action==="enroll") {
      const {data:existing}=await auth.auth.mfa.listFactors();
      if ((existing?.totp ?? []).some(item=>item.status==="verified")) throw new WorkspaceError("An authenticator is already enrolled.");
      for (const factor of existing?.all ?? []) {
        if (factor.factor_type==="totp" && factor.status==="unverified") await auth.auth.mfa.unenroll({factorId:factor.id});
      }
      const {data,error}=await auth.auth.mfa.enroll({factorType:"totp",issuer:"EIS Workspace"});
      if (error) throw new WorkspaceError(error.message);
      return Response.json({factor:data.id,secret:data.totp.secret});
    }
    if (body.action==="verify") {
      const input=z.object({factorId:z.string().uuid(),code:z.string().regex(/^\d{6}$/)}).parse(body);
      const {error}=await auth.auth.mfa.challengeAndVerify(input);
      if (error) throw new WorkspaceError("Verification failed. Check the authenticator code.",401);
      return Response.json({ok:true});
    }
    throw new WorkspaceError("Unknown authentication action.",404);
  } catch (error) { return errorResponse(error); }
}
