import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  createProjectResponse,
  internalErrorResponse,
  listProjectsResponse,
  unauthorizedResponse,
} from "@/lib/cloud-projects";

export const dynamic = "force-dynamic";

async function projectStore() {
  return (await import("@/db/projects")).getProjectStore();
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return unauthorizedResponse();
  try {
    return await listProjectsResponse(user.userId, await projectStore());
  } catch {
    return internalErrorResponse();
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return unauthorizedResponse();
  try {
    return await createProjectResponse(request, user.userId, await projectStore());
  } catch {
    return internalErrorResponse();
  }
}
