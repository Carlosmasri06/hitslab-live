"use client";

import { supabase } from "@/lib/supabase";
import { Button, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import type { User } from "@supabase/supabase-js";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""
);

export type Bidder = {
  has_payment: boolean;
  ship_name: string | null;
  ship_zip: string | null;
} | null;

export function useBidder() {
  const [user, setUser] = useState<User | null>(null);
  const [bidder, setBidder] = useState<Bidder>(null);
  const [ready, setReady] = useState(false);

  const loadBidder = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("bidders")
      .select("has_payment,ship_name,ship_zip")
      .eq("user_id", uid)
      .maybeSingle();
    setBidder((data as Bidder) ?? null);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      if (u) void loadBidder(u.id);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user ?? null;
      setUser(u);
      if (u) void loadBidder(u.id);
      else setBidder(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadBidder]);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) await loadBidder(data.user.id);
  }, [loadBidder]);

  const canBid = !!user && !!bidder?.has_payment && !!bidder?.ship_zip;
  return { user, bidder, canBid, ready, refresh };
}

function AuthStep({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setBusy(true);
    setErr("");
    const { error } =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password: pw })
        : await supabase.auth.signInWithPassword({ email, password: pw });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    onDone();
  };

  return (
    <Flex direction="column" gap="3">
      <Flex direction="column" gap="2" className="mb-1">
        <Text size="2" className="text-white/70">
          ✓ Puja en vivo por cartas exclusivas
        </Text>
        <Text size="2" className="text-white/70">
          ✓ Pago 100% seguro con Stripe
        </Text>
        <Text size="2" className="text-white/70">
          ✓ Envío a domicilio en cuanto ganes
        </Text>
      </Flex>
      <TextField.Input
        size="3"
        style={{ fontSize: 16 }}
        type="email"
        inputMode="email"
        placeholder="Correo"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField.Input
        size="3"
        style={{ fontSize: 16 }}
        type="password"
        placeholder="Contraseña (mín. 6)"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
      />
      {err && (
        <Text size="1" color="red">
          {err}
        </Text>
      )}
      <Button
        size="4"
        disabled={busy || !email || pw.length < 6}
        onClick={submit}
      >
        {busy ? "..." : mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}
      </Button>
      <button
        className="text-sm text-accent-11 underline"
        onClick={() => setMode(mode === "signup" ? "login" : "signup")}
      >
        {mode === "signup"
          ? "¿Ya tienes cuenta? Inicia sesión"
          : "¿Nuevo? Crea una cuenta"}
      </button>
    </Flex>
  );
}

function CardInner({ onDone }: { onDone: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr("");
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });
    if (error) {
      setErr(error.message || "Error con la tarjeta");
      setBusy(false);
      return;
    }
    const { data } = await supabase.auth.getSession();
    await fetch("/api/account/confirm-card", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session?.access_token}`,
      },
      body: JSON.stringify({ setup_intent_id: setupIntent?.id }),
    });
    setBusy(false);
    onDone();
  };

  return (
    <Flex direction="column" gap="3">
      <PaymentElement />
      {err && (
        <Text size="1" color="red">
          {err}
        </Text>
      )}
      <Button size="4" disabled={busy} onClick={submit}>
        {busy ? "Guardando..." : "Guardar tarjeta"}
      </Button>
      <Text size="1" className="text-white/50 text-center">
        🔒 Tus datos van directo y cifrados a Stripe.
      </Text>
    </Flex>
  );
}

function CardStep({ onDone }: { onDone: () => void }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/account/setup-card", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      if (!res.ok) {
        setErr("No se pudo iniciar el pago, intenta de nuevo");
        return;
      }
      const j = await res.json();
      setClientSecret(j.client_secret);
    })();
  }, []);

  if (err)
    return (
      <Text size="2" color="red">
        {err}
      </Text>
    );
  if (!clientSecret)
    return (
      <Text size="2" className="text-white/60">
        Cargando pago seguro...
      </Text>
    );

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret, appearance: { theme: "night" } }}
    >
      <CardInner onDone={onDone} />
    </Elements>
  );
}

function AddressStep({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    ship_name: "",
    ship_phone: "",
    ship_street: "",
    ship_ext: "",
    ship_int: "",
    ship_neighborhood: "",
    ship_city: "",
    ship_state: "",
    ship_zip: "",
  });
  const [busy, setBusy] = useState(false);

  const upd =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
      setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true);
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      await supabase
        .from("bidders")
        .update({ ...f, updated_at: new Date().toISOString() })
        .eq("user_id", data.user.id);
    }
    setBusy(false);
    onDone();
  };

  const S = { fontSize: 16 } as const;
  const ok =
    !!f.ship_name &&
    !!f.ship_phone &&
    !!f.ship_street &&
    !!f.ship_neighborhood &&
    !!f.ship_city &&
    !!f.ship_state &&
    f.ship_zip.length >= 5;

  return (
    <Flex direction="column" gap="2">
      <TextField.Input size="3" style={S} placeholder="Nombre completo" value={f.ship_name} onChange={upd("ship_name")} />
      <TextField.Input size="3" style={S} inputMode="tel" placeholder="Teléfono" value={f.ship_phone} onChange={upd("ship_phone")} />
      <TextField.Input size="3" style={S} placeholder="Calle" value={f.ship_street} onChange={upd("ship_street")} />
      <Flex gap="2">
        <TextField.Input size="3" style={S} placeholder="No. ext" value={f.ship_ext} onChange={upd("ship_ext")} />
        <TextField.Input size="3" style={S} placeholder="No. int (opc)" value={f.ship_int} onChange={upd("ship_int")} />
      </Flex>
      <TextField.Input size="3" style={S} placeholder="Colonia" value={f.ship_neighborhood} onChange={upd("ship_neighborhood")} />
      <Flex gap="2">
        <TextField.Input size="3" style={S} placeholder="Ciudad" value={f.ship_city} onChange={upd("ship_city")} />
        <TextField.Input size="3" style={S} placeholder="Estado" value={f.ship_state} onChange={upd("ship_state")} />
      </Flex>
      <TextField.Input size="3" style={S} inputMode="numeric" placeholder="Código postal" value={f.ship_zip} onChange={upd("ship_zip")} />
      <Button size="4" disabled={busy || !ok} onClick={save}>
        {busy ? "Guardando..." : "Guardar y empezar a pujar"}
      </Button>
    </Flex>
  );
}

function Steps({ step }: { step: string }) {
  const order = ["auth", "card", "address"];
  const idx = step === "done" ? 3 : order.indexOf(step);
  return (
    <Flex gap="2" justify="center" mt="4">
      {order.map((_, i) => (
        <div
          key={i}
          className={
            "h-1.5 w-12 rounded-full " +
            (i <= idx ? "bg-accent-9" : "bg-white/15")
          }
        />
      ))}
    </Flex>
  );
}

const TITLES: Record<string, string> = {
  auth: "Únete al remate",
  card: "Agrega tu tarjeta",
  address: "¿A dónde te lo enviamos?",
  done: "¡Listo! 🔨",
};
const SUBS: Record<string, string> = {
  auth: "Crea tu cuenta para pujar en vivo",
  card: "Guárdala una vez, puja siempre",
  address: "Tu dirección para cuando ganes",
  done: "Ya puedes pujar en el en vivo",
};

export function AccountGate({
  open,
  onOpenChange,
  user,
  bidder,
  refresh,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: User | null;
  bidder: Bidder;
  refresh: () => void;
}) {
  const step = !user
    ? "auth"
    : !bidder?.has_payment
    ? "card"
    : !bidder?.ship_zip
    ? "address"
    : "done";

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      style={{
        background:
          "radial-gradient(130% 60% at 50% 0%, rgba(245,158,11,0.18), rgba(10,10,10,0) 55%), #0a0a0a",
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-5 pb-10 pt-5">
        <button
          onClick={() => onOpenChange(false)}
          className="self-end text-2xl leading-none text-white/60"
          aria-label="Cerrar"
        >
          ✕
        </button>

        <img
          src="/hitslab-logo.png"
          alt="HITS LAB"
          className="mx-auto h-16 w-auto drop-shadow"
        />

        <div className="mt-3 text-center">
          <Heading size="7" className="text-white">
            {TITLES[step]}
          </Heading>
          <Text as="div" size="2" className="mt-1 text-white/60">
            {SUBS[step]}
          </Text>
        </div>

        <Steps step={step} />

        <div className="mt-6">
          {step === "auth" && <AuthStep onDone={refresh} />}
          {step === "card" && <CardStep onDone={refresh} />}
          {step === "address" && <AddressStep onDone={refresh} />}
          {step === "done" && (
            <Flex direction="column" gap="3">
              <Text size="3" align="center" className="text-white">
                Tu cuenta está lista y tu tarjeta guardada de forma segura.
              </Text>
              <Button size="4" onClick={() => onOpenChange(false)}>
                Empezar a pujar
              </Button>
            </Flex>
          )}
        </div>

        {step === "auth" && (
          <button
            onClick={() => onOpenChange(false)}
            className="mt-6 text-center text-sm text-white/40"
          >
            Solo quiero ver el en vivo →
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
