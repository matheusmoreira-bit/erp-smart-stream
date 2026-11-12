import { requireHttpsEndpoint } from "./secure-transport.ts";

function rejects(url: string) {
  let rejected = false;
  try { requireHttpsEndpoint(url); } catch { rejected = true; }
  if (!rejected) throw new Error("Unsafe endpoint accepted");
}

Deno.test("authorized contingency HANA IP accepts HTTP only on port 8001", () => {
  if (requireHttpsEndpoint("http://187.111.23.22:8001/") !== "http://187.111.23.22:8001") {
    throw new Error("Authorized endpoint rejected");
  }
});
Deno.test("contingency exception does not allow other ports", () => {
  rejects("http://187.111.23.22:8002");
  rejects("http://187.111.23.22");
});
Deno.test("contingency exception does not allow adjacent IPs", () => {
  rejects("http://187.111.23.23:8001");
});
Deno.test("authorized host still rejects credentials query and fragment", () => {
  rejects("http://user@187.111.23.22:8001");
  rejects("http://187.111.23.22:8001?value=test");
  rejects("http://187.111.23.22:8001#test");
});