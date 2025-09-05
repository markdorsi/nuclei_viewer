import type { Handler } from "@netlify/functions";
import jwt from "jsonwebtoken";
import { getStore } from "@netlify/blobs";

const STORE = "scans-meta";
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

    const JWT_SECRET = process.env.JWT_SECRET;
    let claims: any = {};
    try {
      claims = JWT_SECRET ? jwt.verify(token, JWT_SECRET) : jwt.decode(token) || {};
    } catch {
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid token" }) };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const { key, bucket, size, contentType, originalName } = body;
    if (!key) {
      return { statusCode: 400, body: JSON.stringify({ error: "key is required" }) };
    }

    const tenantId = sanitize(claims.tenantId || claims.tenant || claims.sub || "unknown");
    const recordKey = `${tenantId}/records/${key}.json`;

    const store = getStore({ name: STORE, consistency: "strong" });
    const now = new Date().toISOString();

    await store.setJSON(recordKey, {
      tenantId,
      key,
      bucket,
      size,
      contentType,
      originalName,
      createdAt: now,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, recordKey }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Failed to record metadata", message: err?.message }),
    };
  }
};

export { handler };