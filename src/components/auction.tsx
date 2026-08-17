"use client";

import { Auction, supabase } from "@/lib/supabase";
import { AccountGate, useBidder } from "./account";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { useCallback, useEffect, useRef, useState } from "react";

type Product = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  stock: number;
};

function useAuction(roomName?: string) {
  const [auction, setAuction] = useState<Auction | null>(null);

  const load = useCallback(async () => {
    if (!roomName) return;
    const { data } = await supabase
      .from("auctions")
      .select("*")
      .eq("room_name", roomName)
      .order("created_at", { ascending: false })
      .limit(1);
    setAuction((data && (data[0] as Auction)) || null);
  }, [roomName]);

  useEffect(() => {
    if (!roomName) return;
    load();
    const channel = supabase
      .channel(`auctions-${roomName}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "auctions",
          filter: `room_name=eq.${roomName}`,
        },
        () => load()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomName, load]);

  return { auction, reload: load };
}

function useCountdown(endsAt?: string | null) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!endsAt) {
      setLeft(0);
      return;
    }
    const tick = () => {
      const ms = new Date(endsAt).getTime() - Date.now();
      setLeft(Math.max(0, Math.ceil(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

function SlideToBid({
  label,
  onConfirm,
  disabled,
  locked,
  onLocked,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  locked?: boolean;
  onLocked?: () => void;
}) {
  const startPx = useRef(0);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const TRAVEL = 80;

  const onDown = (e: React.PointerEvent) => {
    if (locked) {
      onLocked?.();
      return;
    }
    if (disabled) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    startPx.current = e.clientX;
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const nx = Math.max(0, Math.min(TRAVEL, e.clientX - startPx.current));
    setX(nx);
  };
  const finish = () => {
    if (!dragging) return;
    setDragging(false);
    const reached = x >= TRAVEL * 0.82;
    setX(0);
    if (reached) onConfirm();
  };

  return (
    <div
      style={{
        touchAction: "none",
        borderRadius: 9999,
        background: "#1c1c1c",
        border: locked
          ? "1px solid rgba(255,255,255,0.12)"
          : "1px solid rgba(245,179,1,0.45)",
      }}
      className="relative h-14 overflow-hidden select-none"
    >
      {!locked && (
        <div
          className="absolute right-6 top-0 bottom-0 flex items-center pointer-events-none"
          style={{
            color: "rgba(245,179,1,0.55)",
            fontSize: 22,
            fontWeight: 900,
            letterSpacing: "-3px",
          }}
        >
          »»
        </div>
      )}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{
          position: "absolute",
          left: 4,
          top: 4,
          bottom: 4,
          width: locked ? "calc(100% - 8px)" : "calc(100% - 88px)",
          transform: `translateX(${x}px)`,
          touchAction: "none",
          borderRadius: 9999,
          background: locked ? "#555" : "#f5b301",
          transition: dragging ? "none" : "transform .2s ease",
          boxShadow: locked ? "none" : "0 2px 8px rgba(0,0,0,0.4)",
        }}
        className="flex items-center justify-center gap-1"
      >
        <Text
          size="4"
          weight="bold"
          className="truncate px-2"
          style={{ color: locked ? "rgba(255,255,255,0.7)" : "#000" }}
        >
          {label}
        </Text>
        {!locked && (
          <span
            style={{
              color: "#000",
              fontSize: 20,
              fontWeight: 900,
              letterSpacing: "-3px",
            }}
          >
            »
          </span>
        )}
      </div>
    </div>
  );
}

function CustomBidDialog({
  open,
  onOpenChange,
  min,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  min: number;
  busy?: boolean;
  onConfirm: (amount: number) => void;
}) {
  const [val, setVal] = useState("");
  useEffect(() => {
    if (open) setVal(String(min));
  }, [open, min]);
  const amount = Math.floor(Number(val) || 0);
  const valid = amount >= min;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content style={{ maxWidth: 340 }}>
        <Dialog.Title>Puja personalizada</Dialog.Title>
        <Text as="div" size="2" mb="3" className="text-white/60">
          Mínimo ${min.toLocaleString()}
        </Text>
        <input
          autoFocus
          inputMode="numeric"
          value={val}
          onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))}
          style={{
            width: "100%",
            boxSizing: "border-box",
            fontSize: 22,
            fontWeight: 700,
            padding: "12px 16px",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(245,179,1,0.55)",
            borderRadius: 12,
            color: "#fff",
            outline: "none",
          }}
        />
        <Flex gap="2" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray" size="3">
              Cancelar
            </Button>
          </Dialog.Close>
          <Button
            size="3"
            disabled={!valid || busy}
            onClick={() => onConfirm(amount)}
          >
            Pujar ${amount.toLocaleString()}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function StartAuctionDialog({
  roomName,
  onStarted,
}: {
  roomName: string;
  onStarted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [price, setPrice] = useState("");
  const [increment, setIncrement] = useState("50");
  const [duration, setDuration] = useState("15");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    supabase
      .from("products")
      .select("id,name,price,images,stock")
      .eq("active", true)
      .order("featured", { ascending: false })
      .order("name")
      .limit(300)
      .then(({ data }) => setProducts((data as Product[]) || []));
  }, [open]);

  const filtered = products.filter((p) =>
    p.name.toLowerCase().includes(q.toLowerCase())
  );

  const pick = (p: Product) => {
    setSelected(p);
    setPrice(p.price != null ? String(Math.round(p.price * 0.6)) : "");
  };

  const start = async () => {
    if (!selected) return;
    setBusy(true);
    await supabase.rpc("create_auction", {
      p_room: roomName,
      p_title: selected.name.trim(),
      p_image_url: selected.images?.[0] ?? null,
      p_start_price: Number(price) || 0,
      p_increment: Number(increment) || 10,
      p_duration_seconds: Number(duration) || 30,
    });
    await supabase.rpc("set_auction_product", {
      p_room: roomName,
      p_product_id: selected.id,
    });
    setBusy(false);
    setOpen(false);
    setSelected(null);
    setQ("");
    onStarted();
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button size="2" radius="full" className="w-full">
          ➕ Subastar artículo
        </Button>
      </Dialog.Trigger>
      <Dialog.Content style={{ maxWidth: 460 }}>
        <Dialog.Title>Subastar artículo</Dialog.Title>
        <TextField.Input
          style={{ fontSize: 16 }}
          placeholder="Buscar en tu tienda..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div
          style={{ maxHeight: 260, overflowY: "auto" }}
          className="mt-2 flex flex-col gap-1"
        >
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => pick(p)}
              className={
                "flex items-center gap-2 rounded-lg p-2 text-left transition-colors " +
                (selected?.id === p.id ? "bg-accent-4" : "hover:bg-gray-3")
              }
            >
              <img
                src={p.images?.[0] || ""}
                alt=""
                className="h-10 w-10 rounded object-cover bg-gray-4 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm truncate">{p.name}</div>
                <div className="text-xs text-gray-11">
                  ${Number(p.price).toLocaleString()} · stock {p.stock}
                </div>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <Text size="1" className="text-gray-11 p-2">
              Sin resultados
            </Text>
          )}
        </div>

        {selected && (
          <Flex direction="column" gap="2" mt="3">
            <Text size="1" weight="bold">
              Subastando: {selected.name}
            </Text>
            <Flex gap="2">
              <label style={{ flex: 1 }}>
                <Text as="div" size="1" mb="1">
                  Precio inicial
                </Text>
                <TextField.Input
                  style={{ fontSize: 16 }}
                  type="number"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>
              <label style={{ flex: 1 }}>
                <Text as="div" size="1" mb="1">
                  Incremento
                </Text>
                <TextField.Input
                  style={{ fontSize: 16 }}
                  type="number"
                  inputMode="decimal"
                  value={increment}
                  onChange={(e) => setIncrement(e.target.value)}
                />
              </label>
              <label style={{ flex: 1 }}>
                <Text as="div" size="1" mb="1">
                  Segundos
                </Text>
                <TextField.Input
                  style={{ fontSize: 16 }}
                  type="number"
                  inputMode="numeric"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
            </Flex>
            <Button size="3" disabled={busy} onClick={start}>
              {busy ? "Iniciando..." : "Iniciar subasta"}
            </Button>
          </Flex>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function AuctionBar({ isHost }: { isHost: boolean }) {
  const { name: roomName } = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const { auction, reload } = useAuction(roomName);
  const left = useCountdown(auction?.ends_at);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { user, bidder, canBid, refresh } = useBidder();
  const [gateOpen, setGateOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [shipping, setShipping] = useState<number | null>(null);
  const settledRef = useRef<Set<string>>(new Set());

  const live = !!auction && auction.status === "live" && left > 0;
  const ended = !!auction && auction.status === "live" && left <= 0;
  const chargeStatus = (
    auction as unknown as { charge_status?: string } | null
  )?.charge_status;

  useEffect(() => {
    if (
      isHost &&
      ended &&
      auction?.id &&
      auction.current_bidder &&
      !settledRef.current.has(auction.id)
    ) {
      const aid = auction.id;
      settledRef.current.add(aid);
      setTimeout(() => {
        fetch("/api/auction/settle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ auction_id: aid }),
        }).catch(() => {});
      }, 2000);
    }
  }, [isHost, ended, auction?.id, auction?.current_bidder]);

  const productId = (auction as unknown as { product_id?: string } | null)
    ?.product_id;
  useEffect(() => {
    setShipping(null);
    const zip = bidder?.ship_zip;
    if (!live || !productId || !auction?.id || !zip) return;
    let cancelled = false;
    fetch("/api/shipping/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auction_id: auction.id,
        zip,
        state: bidder?.ship_state || "",
        city: bidder?.ship_city || "",
        colonia: bidder?.ship_neighborhood || "",
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d?.ok) setShipping(d.shipping);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [live, auction?.id, productId, bidder?.ship_zip]);

  const nextBid = auction
    ? auction.current_bidder
      ? Number(auction.current_price) + Number(auction.bid_increment)
      : Number(auction.start_price)
    : 0;

  const bid = async (amount: number) => {
    if (!auction) return;
    setBusy(true);
    setErr("");
    const { data } = await supabase.rpc("place_bid", {
      p_auction_id: auction.id,
      p_bidder: user?.id ?? localParticipant.identity,
      p_bidder_name:
        bidder?.ship_name || user?.email || localParticipant.identity,
      p_amount: amount,
    });
    setBusy(false);
    const res = data as { ok: boolean; error?: string } | null;
    if (res && !res.ok) {
      setErr(
        res.error === "muy_baja"
          ? "Puja muy baja, recarga"
          : res.error === "cerrada"
          ? "Subasta cerrada"
          : "Error, intenta de nuevo"
      );
      reload();
    }
  };

  const gate = !isHost ? (
    <AccountGate
      open={gateOpen}
      onOpenChange={setGateOpen}
      user={user}
      bidder={bidder}
      refresh={refresh}
    />
  ) : null;

  let content: React.ReactNode = null;

  if (live) {
    content = (
      <div className="pointer-events-auto mb-2 rounded-2xl px-3 py-3" style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.08)" }}>
        <Flex align="center" gap="2">
          {auction!.image_url && (
            <img
              src={auction!.image_url}
              alt=""
              className="h-12 w-12 rounded-lg object-cover shrink-0"
            />
          )}
          <Flex direction="column" className="min-w-0 flex-1">
            <Text size="2" weight="bold" className="text-white truncate">
              {auction!.title}
            </Text>
            <Text size="1" className="text-white/70 truncate">
              {auction!.current_bidder_name
                ? `Va ganando: ${auction!.current_bidder_name}`
                : "Sé el primero en pujar"}
            </Text>
          </Flex>
          <Flex direction="column" align="end" className="shrink-0">
            <Text size="6" weight="bold" className="text-accent-11">
              ${Number(auction!.current_price).toLocaleString()}
            </Text>
            {shipping != null && (
              <Text size="1" weight="bold" className="text-white/55">
                +${shipping.toLocaleString()} de envío
              </Text>
            )}
            <Text
              size="1"
              weight="bold"
              className={left <= 10 ? "text-red-9" : "text-white/70"}
            >
              {left}s
            </Text>
          </Flex>
        </Flex>
        {!isHost && (
          <Flex gap="2" align="center" className="mt-2">
            <button
              type="button"
              onClick={() => (canBid ? setCustomOpen(true) : setGateOpen(true))}
              disabled={busy}
              style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 9999 }}
              className="shrink-0 h-14 px-5 text-sm font-bold text-white"
            >
              Personalizar
            </button>
            <div className="flex-1">
              <SlideToBid
                label={
                  canBid
                    ? busy
                      ? "Pujando..."
                      : `Pujar $${nextBid.toLocaleString()}`
                    : "🔒 Agrega tu tarjeta"
                }
                onConfirm={() => bid(nextBid)}
                disabled={busy}
                locked={!canBid}
                onLocked={() => setGateOpen(true)}
              />
            </div>
          </Flex>
        )}
        {err && (
          <Text as="div" size="1" className="text-red-9 mt-1">
            {err}
          </Text>
        )}
      </div>
    );
  } else if (ended && auction!.current_bidder_name) {
    content = (
      <div className="pointer-events-auto mb-2 rounded-2xl px-3 py-3" style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.08)" }}>
        <Flex align="center" gap="2">
          {auction!.image_url && (
            <img
              src={auction!.image_url}
              alt=""
              className="h-10 w-10 rounded-lg object-cover shrink-0"
            />
          )}
          <div className="min-w-0">
            <Text size="2" weight="bold" className="text-white truncate">
              🔨 Vendido: {auction!.title}
            </Text>
            <Text as="div" size="1" className="text-accent-11">
              a {auction!.current_bidder_name} por $
              {Number(auction!.current_price).toLocaleString()}
            </Text>
            {isHost && chargeStatus === "pagado" && (
              <Text as="div" size="1" style={{ color: "#4ade80" }}>
                💳 Pago cobrado
              </Text>
            )}
            {isHost && chargeStatus === "fallido" && (
              <Text as="div" size="1" className="text-red-9">
                ⚠️ La tarjeta no se pudo cobrar
              </Text>
            )}
            {isHost && chargeStatus === "sin_tarjeta" && (
              <Text as="div" size="1" className="text-red-9">
                ⚠️ El ganador no tiene tarjeta guardada
              </Text>
            )}
            {isHost && !chargeStatus && auction!.current_bidder && (
              <Text as="div" size="1" className="text-white/50">
                Procesando cobro…
              </Text>
            )}
          </div>
        </Flex>
        {isHost && (
          <div className="mt-2">
            <StartAuctionDialog roomName={roomName!} onStarted={reload} />
          </div>
        )}
      </div>
    );
  } else if (isHost && roomName) {
    content = (
      <div className="pointer-events-auto mb-2">
        <StartAuctionDialog roomName={roomName} onStarted={reload} />
      </div>
    );
  } else if (!isHost) {
    content = (
      <div
        className="pointer-events-auto mb-2 rounded-full px-4 py-3"
        style={{ background: "rgba(255,255,255,0.12)" }}
      >
        <Text
          as="div"
          size="2"
          weight="bold"
          align="center"
          className="text-white/70"
        >
          Esperando siguiente producto…
        </Text>
      </div>
    );
  }

  return (
    <>
      {gate}
      <CustomBidDialog
        open={customOpen}
        onOpenChange={setCustomOpen}
        min={nextBid}
        busy={busy}
        onConfirm={(amt) => {
          setCustomOpen(false);
          void bid(amt);
        }}
      />
      {content}
    </>
  );
}
