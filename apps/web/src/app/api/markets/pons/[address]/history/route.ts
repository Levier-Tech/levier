import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: { address: string } }
) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const address = params.address;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 });
  }

  try {
    // Fetch last 100 history points for the chart
    const res = await fetch(`${supabaseUrl}/rest/v1/pons_market_history?token_address=eq.${address}&select=price_usd,recorded_at&order=recorded_at.desc&limit=100`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      },
      next: { revalidate: 60 } // Cache for 60 seconds
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Supabase fetch error:", errorText);
      return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
    }

    const history = await res.json();
    
    // Sort ascending for chart (oldest to newest)
    history.sort((a: any, b: any) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
    
    return NextResponse.json({ history });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
