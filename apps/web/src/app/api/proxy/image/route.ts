import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const IPFS_GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://dweb.link/ipfs/",
  "https://w3s.link/ipfs/",
];

function extractIpfsCid(url: string): string | null {
  if (url.startsWith("ipfs://")) {
    return url.slice(7);
  }
  const match = url.match(/\/ipfs\/([a-zA-Z0-9_-]+.*)/);
  return match ? match[1] : null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const ipfsCid = extractIpfsCid(targetUrl);
  const candidateUrls: string[] = [];

  if (ipfsCid) {
    for (const gw of IPFS_GATEWAYS) {
      candidateUrls.push(`${gw}${ipfsCid}`);
    }
  } else if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
    candidateUrls.push(targetUrl);
  } else {
    return NextResponse.json({ error: "Invalid url protocol" }, { status: 400 });
  }

  const standardHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  };

  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers: standardHeaders,
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        const contentType = res.headers.get("content-type") || "image/png";
        const buffer = await res.arrayBuffer();

        return new Response(buffer, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=604800, stale-while-revalidate=2592000",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    } catch {
      // Try next candidate gateway
      continue;
    }
  }

  return NextResponse.json({ error: "Image could not be fetched" }, { status: 404 });
}
