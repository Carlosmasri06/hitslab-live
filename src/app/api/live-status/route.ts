import { NextResponse } from "next/server";
import { admin } from "@/lib/stripe";

// El host llama a este endpoint mientras transmite (latido) y al terminar.
export async function POST(req: Request) {
  try {
    const { is_live, room } = await req.json();
    await admin.from("live_state").upsert({
      id: 1,
      is_live: !!is_live,
      room: room || "hitslab",
      updated_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// La tienda puede leer el estado aquí (con CORS abierto).
export async function GET() {
  try {
    const { data } = await admin
      .from("live_state")
      .select("is_live,room,updated_at")
      .eq("id", 1)
      .maybeSingle();
    const fresh = data?.updated_at
      ? Date.now() - new Date(data.updated_at).getTime() < 90000
      : false;
    return NextResponse.json(
      { is_live: !!(data?.is_live && fresh), room: data?.room || "hitslab" },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  } catch {
    return NextResponse.json(
      { is_live: false, room: "hitslab" },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}
