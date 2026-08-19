import {
  chatGPTSignInPath,
  chatGPTSignOutPath,
  getChatGPTUser,
} from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  return Response.json({
    user: user
      ? { userId: user.userId, displayName: user.displayName, email: user.email }
      : null,
    signInPath: chatGPTSignInPath("/"),
    signOutPath: chatGPTSignOutPath("/"),
  });
}
