/**
 * AWS SigV4 request signing for Lightsail's JSON protocol - hand-rolled
 * (no aws-sdk dependency), ported from Bicom's internal AWS Monitor tool
 * (daily2/aws_lightsail_client.php, confirmed working live against real
 * Lightsail accounts). Every Lightsail action is a POST to "/" with the
 * action name in X-Amz-Target, not the URL/body, and no query string - so
 * the canonical request's query-string line is always empty.
 */
import { createHash, createHmac } from "node:crypto";

function hmac(key: Buffer | string, msg: string): Buffer {
  return createHmac("sha256", key).update(msg, "utf8").digest();
}

function signingKey(secretKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export interface SignedLightsailRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Builds a fully-signed POST request for one Lightsail action in one region. */
export function signLightsailRequest(
  accessKeyId: string,
  secretAccessKey: string,
  region: string,
  action: string,
  params: Record<string, unknown>,
): SignedLightsailRequest {
  const service = "lightsail";
  const host = `lightsail.${region}.amazonaws.com`;
  const amzTarget = `Lightsail_20161128.${action}`;
  const body = JSON.stringify(params);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${amzTarget}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const payloadHash = createHash("sha256").update(body, "utf8").digest("hex");

  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign =
    `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n` +
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex");

  const key = signingKey(secretAccessKey, dateStamp, region, service);
  const signature = hmac(key, stringToSign).toString("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}/`,
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Date": amzDate,
      "X-Amz-Target": amzTarget,
      Authorization: authHeader,
    },
    body,
  };
}
