import { NextResponse } from "next/server";
import { stripe, admin } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const { auction_id } = await req.json();
    if (!auction_id) {
      return NextResponse.json(
        { ok: false, error: "no_auction" },
        { status: 400 }
      );
    }

    const { data: auction } = await admin
      .from("auctions")
      .select(
        "id,current_price,current_bidder,current_bidder_name,ends_at,payment_intent_id"
      )
      .eq("id", auction_id)
      .maybeSingle();

    if (!auction) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404 }
      );
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

    // Tarjeta guardada del ganador
    const { data: bidder } = await admin
      .from("bidders")
      .select("stripe_customer_id,payment_method_id")
      .eq("user_id", auction.current_bidder)
      .maybeSingle();

    if (!bidder?.stripe_customer_id || !bidder?.payment_method_id) {
      await admin
        .from("auctions")
        .update({ charge_status: "sin_tarjeta" })
        .eq("id", auction_id);
      return NextResponse.json({ ok: false, error: "no_card" });
    }

    const amount = Math.round(Number(auction.current_price) * 100);

    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount,
          currency: "mxn",
          customer: bidder.stripe_customer_id,
          payment_method: bidder.payment_method_id,
          off_session: true,
          confirm: true,
          metadata: { auction_id: String(auction_id) },
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

      return NextResponse.json({ ok: true, status: pi.status });
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
    return NextResponse.json(
      { ok: false, error: "server", detail: msg },
      { status: 500 }
    );
  }
}
