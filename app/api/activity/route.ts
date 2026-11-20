import { currentStaff } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { olderActivity, WorkspaceError } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const actor = await currentStaff();
    if (!actor) throw new WorkspaceError("Sign in to access activity.",401);
    const before = new URL(request.url).searchParams.get("before") ?? "";
    return Response.json(await olderActivity(actor,before),{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return errorResponse(error); }
}
