import { NextResponse } from "next/server";

/** Public index of the research API. Lists routes only; every listed route still needs the app session. */
export function GET() {
  return NextResponse.json({
    name: "Fieldnotes research API",
    schemaVersion: 1,
    endpoints: {
      createTask: "POST /api/research/tasks",
      getTask: "GET /api/research/tasks/{id}",
      health: "GET /api/research/health",
      contract: "/openapi.json",
    },
    auth: "Open https://fieldnotes-valyu.vercel.app and enter the access code; requests use that session.",
  });
}
