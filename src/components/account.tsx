"use client";

import { supabase } from "@/lib/supabase";
import { Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import type { User } from "@supabase/supabase-js";
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
      <Text size="2" className="text-gray-11">
        {mode === "signup"
          ? "Crea tu cuenta para pujar"
          : "Inicia sesión para pujar"}
      </Text>
      <TextField.Input
        style={{ fontSize: 16 }}
        type="email"
        inputMode="email"
        placeholder="Correo"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField.Input
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
        size="3"
        disabled={busy || !email || pw.length < 6}
        onClick={submit}
      >
        {busy ? "..." : mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}
      </Button>
      <button
        className="text-xs text-accent-11 underline"
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
      <Button size="3" disabled={busy} onClick={submit}>
        {busy ? "Guardando..." : "Guardar tarjeta"}
      </Button>
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
      <Text size="2" className="text-gray-11">
        Cargando...
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
      <Text size="2" className="text-gray-11">
        ¿A dónde te lo enviamos si ganas?
      </Text>
      <TextField.Input style={S} placeholder="Nombre completo" value={f.ship_name} onChange={upd("ship_name")} />
      <TextField.Input style={S} inputMode="tel" placeholder="Teléfono" value={f.ship_phone} onChange={upd("ship_phone")} />
      <TextField.Input style={S} placeholder="Calle" value={f.ship_street} onChange={upd("ship_street")} />
      <Flex gap="2">
        <TextField.Input style={S} placeholder="No. ext" value={f.ship_ext} onChange={upd("ship_ext")} />
        <TextField.Input style={S} placeholder="No. int (opc)" value={f.ship_int} onChange={upd("ship_int")} />
      </Flex>
      <TextField.Input style={S} placeholder="Colonia" value={f.ship_neighborhood} onChange={upd("ship_neighborhood")} />
      <Flex gap="2">
        <TextField.Input style={S} placeholder="Ciudad" value={f.ship_city} onChange={upd("ship_city")} />
        <TextField.Input style={S} placeholder="Estado" value={f.ship_state} onChange={upd("ship_state")} />
      </Flex>
      <TextField.Input style={S} inputMode="numeric" placeholder="Código postal" value={f.ship_zip} onChange={upd("ship_zip")} />
      <Button size="3" disabled={busy || !ok} onClick={save}>
        {busy ? "Guardando..." : "Guardar dirección"}
      </Button>
    </Flex>
  );
}

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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 420 }}>
        <Dialog.Title>
          {step === "auth"
            ? "Cuenta"
            : step === "card"
            ? "Agrega tu tarjeta"
            : step === "address"
            ? "Dirección de envío"
            : "¡Listo!"}
        </Dialog.Title>
        {step === "auth" && <AuthStep onDone={refresh} />}
        {step === "card" && <CardStep onDone={refresh} />}
        {step === "address" && <AddressStep onDone={refresh} />}
        {step === "done" && (
          <Flex direction="column" gap="3">
            <Text size="2">✅ Cuenta lista. Ya puedes pujar.</Text>
            <Button size="3" onClick={() => onOpenChange(false)}>
              Empezar a pujar
            </Button>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
