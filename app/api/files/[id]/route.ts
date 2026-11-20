import { currentStaff } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { download, WorkspaceError } from "@/lib/workspace";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await currentStaff();
    if (!actor) throw new WorkspaceError("Sign in to access files.",401);
    const {id} = await context.params;
    const file = await download(actor,id);
    const inline = new URL(request.url).searchParams.get("inline")==="1" && file.type.startsWith("image/");
    const encodedName = encodeURIComponent(file.filename).replace(/['()*]/g,c=>"%"+c.charCodeAt(0).toString(16));
    return new Response(new Uint8Array(file.buffer),{headers:{
      "Content-Type":file.type,"Content-Disposition":`${inline?"inline":"attachment"}; filename*=UTF-8''${encodedName}`,
      "Content-Length":String(file.buffer.length),"Cache-Control":"private, no-store",
      "X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox",
    }});
  } catch (error) { return errorResponse(error); }
}
