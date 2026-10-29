// Envio leve ao S3 (SigV4 via aws4fetch) — substitui o AWS SDK, que não inicia no runtime.
import { AwsClient } from "npm:aws4fetch@1.0.20";

export type S3PutOptions = {
  contentType?: string;
  sha256?: string;
  lockDays?: number;
};

export function s3Client(region: string, accessKeyId: string, secretAccessKey: string) {
  return new AwsClient({ accessKeyId, secretAccessKey, region, service: "s3" });
}

export async function s3Put(
  aws: AwsClient, region: string, bucket: string, key: string, body: Uint8Array, opts: S3PutOptions = {},
): Promise<void> {
  const path = key.split("/").map(encodeURIComponent).join("/");
  const url = `https://${bucket}.s3.${region}.amazonaws.com/${path}`;
  const headers: Record<string, string> = {
    "Content-Type": opts.contentType || "application/octet-stream",
    "x-amz-server-side-encryption": "AES256",
  };
  if (opts.sha256) headers["x-amz-meta-sha256"] = opts.sha256;
  if (opts.lockDays && opts.lockDays > 0) {
    headers["x-amz-object-lock-mode"] = "COMPLIANCE";
    headers["x-amz-object-lock-retain-until-date"] = new Date(Date.now() + opts.lockDays * 86400_000).toISOString();
  }
  const r = await aws.fetch(url, { method: "PUT", headers, body });
  if (!r.ok) throw new Error(`S3 PUT ${key} [${r.status}]: ${(await r.text()).slice(0, 300)}`);
}

export async function s3Exists(aws: AwsClient, region: string, bucket: string, key: string): Promise<boolean> {
  const path = key.split("/").map(encodeURIComponent).join("/");
  const r = await aws.fetch(`https://${bucket}.s3.${region}.amazonaws.com/${path}`, { method: "HEAD" });
  return r.ok;
}

/** Lista chaves e tamanhos sob um prefixo (ListObjectsV2, paginado). */
export async function s3ListSizes(
  aws: AwsClient, region: string, bucket: string, prefix: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let token: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const qs = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
    if (token) qs.set("continuation-token", token);
    const r = await aws.fetch(`https://${bucket}.s3.${region}.amazonaws.com/?${qs}`);
    if (!r.ok) throw new Error(`S3 LIST ${prefix} [${r.status}]: ${(await r.text()).slice(0, 200)}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const key = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
      const size = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? "-1");
      if (key) out.set(decodeXml(key), size);
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
      ? decodeXml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] || "") || null
      : null;
    if (!token) break;
  }
  return out;
}

export async function s3Get(aws: AwsClient, region: string, bucket: string, key: string) {
  const path = key.split("/").map(encodeURIComponent).join("/");
  const r = await aws.fetch(`https://${bucket}.s3.${region}.amazonaws.com/${path}`);
  if (!r.ok) throw new Error(`S3 GET ${key} [${r.status}]`);
  return { body: new Uint8Array(await r.arrayBuffer()), sha256Meta: r.headers.get("x-amz-meta-sha256") };
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
