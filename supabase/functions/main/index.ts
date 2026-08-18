import * as jose from "jsr:@panva/jose@6";

const jwtSecret = Deno.env.get("JWT_SECRET");
const verifyJwt = Deno.env.get("VERIFY_JWT") === "true";

async function hasValidJwt(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || !jwtSecret) return false;

  try {
    await jose.jwtVerify(
      authorization.slice("Bearer ".length),
      new TextEncoder().encode(jwtSecret),
    );
    return true;
  } catch {
    return false;
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "OPTIONS" && verifyJwt && !(await hasValidJwt(request))) {
    return Response.json({ message: "Invalid JWT" }, { status: 401 });
  }

  const functionName = new URL(request.url).pathname.split("/").filter(Boolean)[0];
  if (!functionName) {
    return Response.json({ message: "Missing function name" }, { status: 400 });
  }

  const environment = Object.entries(Deno.env.toObject());

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${functionName}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 120_000,
      noModuleCache: false,
      importMapPath: "/home/deno/functions/deno.jsonc",
      envVars: environment,
    });

    return await worker.fetch(request);
  } catch (error) {
    console.error(`Failed to invoke function ${functionName}`, error);
    return Response.json({ message: "Function invocation failed" }, { status: 500 });
  }
});
