import { ZodError } from "zod";
import { localDemo } from "./auth";
import { WorkspaceError } from "./workspace";

export function errorResponse(error: unknown) {
  if (error instanceof WorkspaceError) return Response.json({ error:error.message },{status:error.status});
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return Response.json({error:`${first.path.join(".") ? first.path.join(".")+": " : ""}${first.message}`},{status:400});
  }
  if (typeof error === "object" && error && "code" in error && error.code==="23505") {
    return Response.json({error:"A matching record already exists."},{status:409});
  }
  if (localDemo() && typeof error === "object" && error && "code" in error &&
      ["ECONNREFUSED","3D000","42P01"].includes(String(error.code))) {
    return Response.json({error:"The local demo database is unavailable. Stop Next.js and run npm run demo from the project folder."},{status:503});
  }
  console.error(error);
  return Response.json({error:"The workspace could not complete the request. Check the service configuration and try again."},{status:500});
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = process.env.EIS_PUBLIC_ORIGIN ? new URL(process.env.EIS_PUBLIC_ORIGIN).host : request.headers.get("host");
  if (request.headers.get("sec-fetch-site")==="cross-site" || (origin && new URL(origin).host!==host)) {
    throw new WorkspaceError("Request origin rejected.",403);
  }
}
