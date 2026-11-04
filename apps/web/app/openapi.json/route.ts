import { openApiDocument } from "@valyu-research/contracts/openapi";
export const dynamic = "force-static";
export function GET() {
  return Response.json(openApiDocument);
}
