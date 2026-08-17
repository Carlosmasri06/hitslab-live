import { NextResponse } from "next/server";
import { admin } from "@/lib/stripe";

const STORE_SHIPPING_URL = "https://www.hitslabtcg.com/api/shipping";

export async function POST(req: Request) {
  try {
    const { auction_id, zip, state, city, colonia } = await req.json();
    if (!auction_id || !zip || String(zip).length < 5) {
      return NextResponse.json({ ok: false, error: "bad_input" }, { status: 400 });
    }

    const { data: auction } = await admin
      .from("auctions")
      .select("product_id")
      .eq("id", auction_id)
      .maybeSingle();
    if (!auction?.product_id) {
      return NextResponse.json({ ok: false, error: "no_product" });
    }

    const { data: product } = await admin
      .from("products")
      .select(
        "id,name,price,category,sku,weight_kg,length_cm,width_cm,height_cm"
      )
      .eq("id", auction.product_id)
      .maybeSingle();
    if (!product) {
      return NextResponse.json({ ok: false, error: "no_product" });
    }

    const res = await fetch(STORE_SHIPPING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        zip_to: String(zip),
        country: "MX",
        state: state || "",
        city: city || "",
        colonia: colonia || "",
        items: [
          {
            id: product.id,
            name: product.name,
            qty: 1,
            price: Number(product.price) || 0,
            category: product.category || "",
            sku: product.sku || "",
            weight_kg: product.weight_kg,
            length_cm: product.length_cm,
            width_cm: product.width_cm,
            height_cm: product.height_cm,
          },
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    const rates = Array.isArray(data?.rates) ? data.rates : [];
    if (!rates.length) {
      return NextResponse.json({ ok: false, error: "no_rates" });
    }
    const cheapest = rates.reduce(
      (m: { price: number }, r: { price: number }) =>
        Number(r.price) < Number(m.price) ? r : m,
      rates[0]
    );
    return NextResponse.json({
      ok: true,
      shipping: Math.ceil(Number(cheapest.price)),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return NextResponse.json({ ok: false, error: "server", detail: msg }, {
      status: 500,
    });
  }
}
