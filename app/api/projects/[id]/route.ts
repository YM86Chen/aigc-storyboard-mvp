import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  deleteProjectResponse,
  getProjectResponse,
  internalErrorResponse,
  unauthorizedResponse,
  updateProjectResponse,
} from "@/lib/cloud-projects";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function projectStore() {
  return (await import("@/db/projects")).getProjectStore();
}

export async function GET(_request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!user) return unauthorizedResponse();
  try {
    return await getProjectResponse(user.userId, (await context.params).id, await projectStore());
  } catch {
    return internalErrorResponse();
  }
}

export async function PUT(request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!user) return unauthorizedResponse();
  try {
    return await updateProjectResponse(
      request,
      user.userId,
      (await context.params).id,
      await projectStore(),
    );
  } catch {
    return internalErrorResponse();
  }
}

export async function DELETE(_request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!user) return unauthorizedResponse();
  try {
    return await deleteProjectResponse(user.userId, (await context.params).id, await projectStore());
  } catch {
    return internalErrorResponse();
  }
}
