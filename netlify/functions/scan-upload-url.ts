import type { Handler } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Required env: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, UPLOAD_BUCKET
// Optional: UPLOAD_SSE ("AES256")

// Multi-tenant: we expect a JWT "tenantId" (or "tenant") claim, else fallback to "unknown".
const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, "_");

const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const auth = event.headers.authorization || event.headers.Authorization;
    if (!auth?.startsWith("Bearer ")) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing token" }) };
    }
    const token = auth.split(" ")[1];

    // NOTE: replace with your real verification secret or JWKS if applicable.
    // For now, we accept unsigned tokens for dev if no secret is set.
    const JWT_SECRET = process.env.JWT_SECRET;
    let claims: any = {};
    try {
      claims = JWT_SECRET ? jwt.verify(token, JWT_SECRET) : jwt.decode(token) || {};
    } catch (e) {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid token" }) };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { fileName, contentType, fileSize, scanName } = body;

    if (!fileName || !contentType || !Number.isFinite(fileSize)) {
      return { statusCode: 400, body: JSON.stringify({ error: "fileName, contentType, fileSize are required" }) };
    }

    // Hard guard: block absurd sizes; tune as needed
    if (fileSize > 5 * 1024 * 1024 * 1024) {
      return { statusCode: 400, body: JSON.stringify({ error: "File too large" }) };
    }

    const tenantId = sanitize(claims.tenantId || claims.tenant || claims.sub || "unknown");
    const date = new Date().toISOString().split("T")[0];
    const safeName = sanitize(scanName || fileName);

    const key = `${tenantId}/${date}/${safeName}`;

    const Bucket = process.env.UPLOAD_BUCKET!;
    if (!Bucket) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing UPLOAD_BUCKET env" }) };
    }

    const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

    const command = new PutObjectCommand({
      Bucket,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: process.env.UPLOAD_SSE as any, // e.g. "AES256"
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 }); // 10 minutes

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadUrl,
        key,
        bucket: Bucket,
        contentType,
        expiresInSeconds: 600,
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to create upload URL", message: err?.message }),
    };
  }
};

export { handler };