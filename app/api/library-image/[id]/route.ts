import { currentStaff } from "@/lib/auth";
import { errorResponse } from "@/lib/http";
import { WorkspaceError, downloadLibraryImage } from "@/lib/workspace";

export async function GET(_request: Request, {params}: {params:Promise<{id:string}>}) {
  try {
    const actor = await currentStaff();
    if (!actor) throw new WorkspaceError("Sign in to view library visuals.",401);
    const image = await downloadLibraryImage(actor,(await params).id);
    return new Response(new Uint8Array(image.buffer),{headers:{
      "Content-Type":image.type,"Cache-Control":"private, no-store",
      "X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; sandbox",
    }});
  } catch (error) { return errorResponse(error); }
}
