import { NextResponse } from "next/server";
import { stripe, admin } from "@/lib/stripe";

const STORE_SHIPPING_URL = "https://www.hitslabtcg.com/api/shipping";

export async function POST(req: Request) {
  try {
    const { auction_id } = await req.json();
    if (!auction_id) {
      return NextResponse.json({ ok: false, error: "no_auction" }, { status: 400 });
    }

    const { data: auction } = await admin
      .from("auctions")
      .select(
        "id,current_price,current_bidder,current_bidder_name,ends_at,payment_intent_id,product_id"
      )
      .eq("id", auction_id)
      .maybeSingle();

    if (!auction) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    // Ya cobrada -> idempotente
    if (auction.payment_intent_id) {
      return NextResponse.json({ ok: true, already: true });
    }
    if (!auction.current_bidder) {
      return NextResponse.json({ ok: false, error: "no_winner" });
    }
    // Solo cobra si de verdad ya terminó
    if (
      auction.ends_at &&
      new Date(auction.ends_at).getTime() > Date.now() + 10000
    ) {
      return NextResponse.json({ ok: false, error: "not_ended" });
    }

    // Tarjeta guardada + dirección del ganador
    const { data: bidder } = await admin
      .from("bidders")
      .select(
        "stripe_customer_id,payment_method_id,ship_zip,ship_state,ship_city,ship_neighborhood"
      )
      .eq("user_id", auction.current_bidder)
      .maybeSingle();

    if (!bidder?.stripe_customer_id || !bidder?.payment_method_id) {
      await admin
        .from("auctions")
        .update({ charge_status: "sin_tarjeta" })
        .eq("id", auction_id);
      return NextResponse.json({ ok: false, error: "no_card" });
    }

    // Cotiza el envío (reusa el endpoint de la tienda) para cobrar puja + envío
    let shippingCost = 0;
    if (auction.product_id && bidder.ship_zip) {
      try {
        const { data: product } = await admin
          .from("products")
          .select(
            "id,name,price,category,sku,weight_kg,length_cm,width_cm,height_cm"
          )
          .eq("id", auction.product_id)
          .maybeSingle();
        if (product) {
          const shipRes = await fetch(STORE_SHIPPING_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              zip_to: bidder.ship_zip,
              country: "MX",
              state: bidder.ship_state || "",
              city: bidder.ship_city || "",
              colonia: bidder.ship_neighborhood || "",
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
          const shipData = await shipRes.json();
          const rates = Array.isArray(shipData?.rates) ? shipData.rates : [];
          if (rates.length) {
            const cheapest = rates.reduce(
              (m: { price: number }, r: { price: number }) =>
                Number(r.price) < Number(m.price) ? r : m,
              rates[0]
            );
            shippingCost = Math.ceil(Number(cheapest.price));
          }
        }
      } catch {
        // Si la cotización falla, cobra solo la puja (no bloquea la venta)
      }
    }

    const bid = Number(auction.current_price);
    const total = bid + shippingCost;
    const amount = Math.round(total * 100);

    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount,
          currency: "mxn",
          customer: bidder.stripe_customer_id,
          payment_method: bidder.payment_method_id,
          off_session: true,
          confirm: true,
          metadata: {
            auction_id: String(auction_id),
            bid: String(bid),
            shipping: String(shippingCost),
          },
        },
        { idempotencyKey: `settle_${auction_id}` }
      );

      await admin
        .from("auctions")
        .update({
          payment_intent_id: pi.id,
          charge_status: pi.status === "succeeded" ? "pagado" : pi.status,
          charge_error: null,
        })
        .eq("id", auction_id);

      return NextResponse.json({
        ok: true,
        status: pi.status,
        bid,
        shipping: shippingCost,
        total,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "charge_failed";
      await admin
        .from("auctions")
        .update({ charge_status: "fallido", charge_error: msg })
        .eq("id", auction_id);
      return NextResponse.json({ ok: false, error: "charge_failed", detail: msg });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "server_error";
    return NextResponse.json({ ok: false, error: "server", detail: msg }, {
      status: 500,
    });
  }
}
