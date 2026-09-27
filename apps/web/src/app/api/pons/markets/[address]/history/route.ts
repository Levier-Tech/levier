import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  const headers = { "cache-control": "no-store" };
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const address = params.address;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase configuration missing" },
      { status: 500, headers }
    );
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/pons_market_history?token_address=ilike.${address}&select=price_usd,recorded_at&order=recorded_at.desc&limit=100`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      },
      next: { revalidate: 60 }
    });

    if (!res.ok) {
      throw new Error(`Supabase API error: ${res.status}`);
    }

    const history = await res.json();
    
    // Sort ascending for chart (oldest to newest)
    history.sort((a: any, b: any) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    
    // Format for lightweight-charts: { time: number (unix timestamp), value: number }
    const formattedHistory = history.map((h: any) => ({
      time: Math.floor(new Date(h.recorded_at).getTime() / 1000),
      value: h.price_usd
    }));
    
    // Ensure uniqueness by time
    const unique = formattedHistory.filter((v: any, i: number, a: any[]) => a.findIndex((t: any) => t.time === v.time) === i);

    return NextResponse.json({ history: unique }, { headers });
  } catch (err) {
    console.error("Failed to fetch history:", err);
    return NextResponse.json(
      { error: "History service unavailable", details: String(err) },
      { status: 503, headers }
    );
  }
}
