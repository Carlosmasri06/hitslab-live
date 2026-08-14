import { admin, getUserFromReq, stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const user = await getUserFromReq(req);
    if (!user) return new Response("no_auth", { status: 401 });

    const { setup_intent_id } = await req.json();
    const si = await stripe.setupIntents.retrieve(setup_intent_id);

    if (si.status !== "succeeded" || !si.payment_method) {
      return new Response("not_succeeded", { status: 400 });
    }

    const pmId =
      typeof si.payment_method === "string"
        ? si.payment_method
        : si.payment_method.id;

    await admin
      .from("bidders")
      .update({
        payment_method_id: pmId,
        has_payment: true,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id);

    return Response.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return new Response(msg, { status: 500 });
  }
}
