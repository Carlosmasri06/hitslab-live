import { admin, getUserFromReq, stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const user = await getUserFromReq(req);
    if (!user) return new Response("no_auth", { status: 401 });

    const { data: bidder } = await admin
      .from("bidders")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = bidder?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await admin.from("bidders").upsert({
        user_id: user.id,
        email: user.email,
        stripe_customer_id: customerId,
        updated_at: new Date().toISOString(),
      });
    }

    const si = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
    });

    return Response.json({ client_secret: si.client_secret });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    return new Response(msg, { status: 500 });
  }
}
