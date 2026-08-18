import { NextResponse } from "next/server";
import { stripe, admin } from "@/lib/stripe";

const STORE_SHIPPING_URL = "https://www.hitslabtcg.com/api/shipping";

type Product = {
  id: string;
  name: string;
  price: number | null;
  category: string | null;
  sku: string | null;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
};

function orderNumber() {
  return "HL-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function POST(req: Request) {
  try {
    const { auction_id } = await req.json();
    if (!auction_id) {
      return NextResponse.json({ ok: false, error: "no_auction" }, { status: 400 });
    }

    const { data: auction } = await admin
      .from("auctions")
      .select(
        "id,title,image_url,current_price,current_bidder,current_bidder_name,ends_at,payment_intent_id,product_id"
      )
      .eq("id", auction_id)
      .maybeSingle();

    if (!auction) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (auction.payment_intent_id) {
      return NextResponse.json({ ok: true, already: true });
    }
    if (!auction.current_bidder) {
      return NextResponse.json({ ok: false, error: "no_winner" });
    }
    if (
      auction.ends_at &&
      new Date(auction.ends_at).getTime() > Date.now() + 10000
    ) {
      return NextResponse.json({ ok: false, error: "not_ended" });
    }

    const { data: bidder } = await admin
      .from("bidders")
      .select(
        "stripe_customer_id,payment_method_id,email,ship_name,ship_phone,ship_street,ship_ext,ship_int,ship_neighborhood,ship_city,ship_state,ship_zip"
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

    // Producto de la subasta (para envío + orden)
    let product: Product | null = null;
    if (auction.product_id) {
      const { data: p } = await admin
        .from("products")
        .select(
          "id,name,price,category,sku,weight_kg,length_cm,width_cm,height_cm"
        )
        .eq("id", auction.product_id)
        .maybeSingle();
      product = (p as Product) || null;
    }

    // Cotiza el envío (reusa el endpoint de la tienda) para cobrar puja + envío
    let shippingCost = 0;
    if (product && bidder.ship_zip) {
      try {
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
      } catch {
        // Si la cotización falla, cobra solo la puja (no bloquea la venta)
      }
    }

    const bid = Number(auction.current_price);
    const total = bid + shippingCost;
    const amount = Math.round(total * 100);

    let pi;
    try {
      pi = await stripe.paymentIntents.create(
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "charge_failed";
      await admin
        .from("auctions")
        .update({ charge_status: "fallido", charge_error: msg })
        .eq("id", auction_id);
      return NextResponse.json({ ok: false, error: "charge_failed", detail: msg });
    }

    await admin
      .from("auctions")
      .update({
        payment_intent_id: pi.id,
        charge_status: pi.status === "succeeded" ? "pagado" : pi.status,
        charge_error: null,
      })
      .eq("id", auction_id);

    // ===== VENTA REAL: crear orden en la tienda + descontar inventario =====
    // Protegido por LIVE_SALES_ENABLED para no tocar tu tienda real durante pruebas.
    if (process.env.LIVE_SALES_ENABLED === "true") {
      try {
        const name =
          bidder.ship_name || auction.current_bidder_name || "Cliente";
        const street = [
          bidder.ship_street,
          bidder.ship_ext,
          bidder.ship_int ? "Int " + bidder.ship_int : "",
        ]
          .filter(Boolean)
          .join(" ");

        await admin.from("orders").insert({
          order_number: orderNumber(),
          customer_snapshot: {
            name,
            email: bidder.email,
            phone: bidder.ship_phone,
            address: street,
            zip: bidder.ship_zip,
            city: bidder.ship_city,
            state: bidder.ship_state,
            colonia: bidder.ship_neighborhood,
            country: "MX",
          },
          items: product
            ? [
                {
                  id: product.id,
                  product_id: product.id,
                  name: product.name,
                  qty: 1,
                  price: bid,
                  weight_kg: product.weight_kg,
                  length_cm: product.length_cm,
                  width_cm: product.width_cm,
                  height_cm: product.height_cm,
                  category: product.category,
                  sku: product.sku,
                },
              ]
            : [{ name: auction.title, qty: 1, price: bid }],
          subtotal: bid,
          shipping_cost: shippingCost,
          total,
          payment_status: "pagado",
          payment_method: "stripe",
          payment_ref: pi.id,
          shipping_status: "pendiente",
          live_opening: true,
          live_opening_status: "pending",
        });

        // Descontar inventario (ruta legacy: resta stock + stock_bodega, sube sold)
        if (product) {
          const { data: prod } = await admin
            .from("products")
            .select("stock,stock_bodega,sold")
            .eq("id", product.id)
            .maybeSingle();
          if (prod) {
            const bodega = prod.stock_bodega ?? prod.stock ?? 0;
            await admin
              .from("products")
              .update({
                stock: Math.max(0, (prod.stock ?? 0) - 1),
                stock_bodega: Math.max(0, bodega - 1),
                sold: (prod.sold ?? 0) + 1,
                updated_at: new Date().toISOString(),
              })
              .eq("id", product.id);
          }
        }
      } catch (opErr) {
        console.error("live sale order/inventory error:", opErr);
        // No bloquea el cobro: si falla la orden, el cargo ya quedó hecho.
      }
    }

    return NextResponse.json({
      ok: true,
      status: pi.status,
      bid,
      shipping: shippingCost,
      total,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "server_error";
    return NextResponse.json({ ok: false, error: "server", detail: msg }, {
      status: 500,
    });
  }
}
