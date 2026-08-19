import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getProjectStore } from "@/db/projects";
import {
  createProjectResponse,
  internalErrorResponse,
  listProjectsResponse,
  unauthorizedResponse,
} from "@/lib/cloud-projects";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return unauthorizedResponse();
  try {
    return await listProjectsResponse(user.userId, getProjectStore());
  } catch {
    return internalErrorResponse();
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return unauthorizedResponse();
  try {
    return await createProjectResponse(request, user.userId, getProjectStore());
  } catch {
    return internalErrorResponse();
  }
}
