import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "cache-control": "no-store" };
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase configuration missing" },
      { status: 500, headers }
    );
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/pons_tokens?select=*&order=market_data_updated_at.desc`, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      },
      next: { revalidate: 15 }
    });

    if (!res.ok) {
      throw new Error(`Supabase API error: ${res.status}`);
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

    return NextResponse.json(
      { markets, tokens: markets, updatedAt: Date.now() },
      { headers },
    );
  } catch (err) {
    console.error("Failed to fetch pons markets:", err);
    return NextResponse.json(
      { error: "Pons market service unavailable.", details: String(err) },
      { status: 503, headers },
    );
  }
}
