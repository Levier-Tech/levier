import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Supabase configuration missing" }, { status: 500 });
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/pons_tokens?select=*&eligible=eq.true&order=market_cap_usd.desc`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      },
      next: { revalidate: 15 } // Cache for 15 seconds
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("Supabase fetch error:", errorText);
      return NextResponse.json({ error: "Failed to fetch Pons tokens" }, { status: 500 });
    }

    const dbTokens = await res.json();
    const markets = (Array.isArray(dbTokens) ? dbTokens : []).map((t: any) => ({
      address: t.token_address || "",
      symbol: t.symbol || "UNKNOWN",
      name: t.name || t.symbol || "Unknown Token",
      image: t.logo_url || "",
      description: t.description || `Graduated Pons Asset: ${t.name || t.symbol || ""}`,
      websiteUrl: t.website_url || null,
      twitterUrl: t.twitter_url || null,
      telegramUrl: t.telegram_url || null,
      discordUrl: t.discord_url || null,
      graduated: t.graduation_status === 'GRADUATED' || t.graduation_phase === 2,
      eligible: Boolean(t.eligible),
      liquidity: Number(t.circulating_supply) || 0,
      marketCap: Number(t.market_cap_usd) || 0,
      volume24h: 0,
      price: Number(t.token_price_usd) || 0,
      change24h: 0,
      maxLeverage: 10,
      leverageEnabled: true,
      ineligibleReason: null,
      coingeckoId: undefined,
    }));

    return NextResponse.json({ tokens: markets, markets, updatedAt: Date.now() });
  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
