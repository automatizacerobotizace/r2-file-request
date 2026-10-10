import { describe, expect, it } from "vitest";
import { canonicalRequest, presignUrl, uriEncode, type PresignInput } from "../src/presign";

const awsExample: PresignInput = {
  method: "GET",
  endpoint: "https://examplebucket.s3.amazonaws.com",
  bucket: "",
  key: "test.txt",
  region: "us-east-1",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  now: new Date("2013-05-24T00:00:00Z"),
  expiresSeconds: 86400,
};

describe("uriEncode", () => {
  it("encodes everything except unreserved characters", () => {
    expect(uriEncode("a b/č!'()*~._-")).toBe("a%20b%2F%C4%8D%21%27%28%29%2A~._-");
  });
});

describe("presignUrl", () => {
  it("matches the AWS documentation example signature", async () => {
    const url = await presignUrl(awsExample);
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("uses path-style bucket, region auto and signs extra headers for PUT", async () => {
    const input: PresignInput = {
      method: "PUT",
      endpoint: "https://acc.eu.r2.cloudflarestorage.com",
      bucket: "files",
      key: "in/0b9c",
      accessKeyId: "AK",
      secretAccessKey: "SK",
      now: new Date("2026-09-28T10:00:00Z"),
      expiresSeconds: 120,
      headers: { "x-amz-meta-filename": "n%C3%A1vrh.zip", "if-none-match": "*", "content-length": "42" },
    };
    const cr = canonicalRequest(input, "20260928T100000Z");
    expect(cr.split("\n")).toEqual([
      "PUT",
      "/files/in/0b9c",
      "X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AK%2F20260928%2Fauto%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20260928T100000Z&X-Amz-Expires=120" +
        "&X-Amz-SignedHeaders=content-length%3Bhost%3Bif-none-match%3Bx-amz-meta-filename",
      "content-length:42",
      "host:acc.eu.r2.cloudflarestorage.com",
      "if-none-match:*",
      "x-amz-meta-filename:n%C3%A1vrh.zip",
      "",
      "content-length;host;if-none-match;x-amz-meta-filename",
      "UNSIGNED-PAYLOAD",
    ]);
    const url = new URL(await presignUrl(input));
    expect(url.pathname).toBe("/files/in/0b9c");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs extra query parameters in sorted order", async () => {
    const input: PresignInput = {
      ...awsExample,
      query: {
        "response-content-type": "application/octet-stream",
        "response-content-disposition": "attachment; filename*=UTF-8''a%20b.zip",
      },
    };
    const cr = canonicalRequest(input, "20130524T000000Z");
    const q = cr.split("\n")[2]!;
    expect(q.endsWith(
      "&response-content-disposition=attachment%3B%20filename%2A%3DUTF-8%27%27a%2520b.zip" +
        "&response-content-type=application%2Foctet-stream",
    )).toBe(true);
  });

  it("rejects non-positive expiry", async () => {
    await expect(presignUrl({ ...awsExample, expiresSeconds: 0 })).rejects.toThrow();
  });
});
