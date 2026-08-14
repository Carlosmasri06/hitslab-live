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
  const trackRef = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const HANDLE = 52;

  const maxX = () =>
    Math.max(0, (trackRef.current?.clientWidth ?? 0) - HANDLE);

  const onDown = (e: React.PointerEvent) => {
    if (locked) {
      onLocked?.();
      return;
    }
    if (disabled) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(maxX(), e.clientX - rect.left - HANDLE / 2));
    setX(nx);
  };
  const finish = () => {
    if (!dragging) return;
    setDragging(false);
    const reached = x >= maxX() * 0.9 && maxX() > 0;
    setX(0);
    if (reached) onConfirm();
  };

  return (
    <div
      ref={trackRef}
      style={{ touchAction: "none" }}
      className={
        "relative h-[52px] rounded-full overflow-hidden select-none " +
        (locked ? "bg-white/10" : "bg-white/15")
      }
    >
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-14">
        <Text size="2" weight="bold" className="text-white/90 truncate">
          {label}
        </Text>
      </div>
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{
          width: HANDLE,
          height: HANDLE,
          transform: `translateX(${x}px)`,
          touchAction: "none",
        }}
        className={
          "absolute left-0 top-0 rounded-full flex items-center justify-center text-xl font-bold " +
          (locked ? "bg-gray-7 text-gray-11 " : "bg-accent-9 text-black ") +
          (disabled ? "opacity-50 " : "") +
          (dragging ? "" : "transition-transform")
        }
      >
        →
      </div>
    </div>
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

  const live = !!auction && auction.status === "live" && left > 0;
  const ended = !!auction && auction.status === "live" && left <= 0;

  const nextBid = auction
    ? auction.current_bidder
      ? Number(auction.current_price) + Number(auction.bid_increment)
      : Number(auction.start_price)
    : 0;

  const bid = async () => {
    if (!auction) return;
    setBusy(true);
    setErr("");
    const { data } = await supabase.rpc("place_bid", {
      p_auction_id: auction.id,
      p_bidder: user?.id ?? localParticipant.identity,
      p_bidder_name:
        bidder?.ship_name || user?.email || localParticipant.identity,
      p_amount: nextBid,
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

  if (live) {
    return (
      <div className="pointer-events-auto mb-2 rounded-2xl bg-black/70 backdrop-blur px-3 py-2">
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
            <Text size="5" weight="bold" className="text-accent-11">
              ${Number(auction!.current_price).toLocaleString()}
            </Text>
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
          <div className="mt-2">
            <SlideToBid
              label={
                canBid
                  ? busy
                    ? "Pujando..."
                    : `Desliza para pujar $${nextBid.toLocaleString()}`
                  : "🔒 Agrega tu tarjeta para pujar"
              }
              onConfirm={bid}
              disabled={busy}
              locked={!canBid}
              onLocked={() => setGateOpen(true)}
            />
            <AccountGate
              open={gateOpen}
              onOpenChange={setGateOpen}
              user={user}
              bidder={bidder}
              refresh={refresh}
            />
          </div>
        )}
        {err && (
          <Text as="div" size="1" className="text-red-9 mt-1">
            {err}
          </Text>
        )}
      </div>
    );
  }

  if (ended && auction!.current_bidder_name) {
    return (
      <div className="pointer-events-auto mb-2 rounded-2xl bg-black/70 backdrop-blur px-3 py-2">
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
          </div>
        </Flex>
        {isHost && (
          <div className="mt-2">
            <StartAuctionDialog roomName={roomName!} onStarted={reload} />
          </div>
        )}
      </div>
    );
  }

  if (isHost && roomName) {
    return (
      <div className="pointer-events-auto mb-2">
        <StartAuctionDialog roomName={roomName} onStarted={reload} />
      </div>
    );
  }

  return null;
}
