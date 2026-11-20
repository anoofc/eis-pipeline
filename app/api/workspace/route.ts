import { currentStaff } from "@/lib/auth";
import { assertSameOrigin, errorResponse } from "@/lib/http";
import { loadWorkspace, mutate, upload, WorkspaceError } from "@/lib/workspace";

export const runtime = "nodejs";
export async function GET() {
  try {
    const actor = await currentStaff();
    if (!actor) throw new WorkspaceError("Sign in to access the workspace.",401);
    return Response.json(await loadWorkspace(actor),{headers:{"Cache-Control":"private, no-store"}});
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await currentStaff();
    if (!actor) throw new WorkspaceError("Sign in to access the workspace.",401);
    const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data");
    if (Number(request.headers.get("content-length")) > (multipart ? 26 : 5) * 1024 * 1024) {
      throw new WorkspaceError("Upload exceeds the size limit.",413);
    }
    return Response.json(multipart ? await upload(actor,await request.formData()) : await mutate(actor,await request.json()));
  } catch (error) { return errorResponse(error); }
}
