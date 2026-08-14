"use client";

import { Auction, supabase } from "@/lib/supabase";
import { useLocalParticipant, useRoomContext } from "@livekit/components-react";
import { Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { useCallback, useEffect, useState } from "react";

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
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [increment, setIncrement] = useState("10");
  const [duration, setDuration] = useState("30");
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    await supabase.rpc("create_auction", {
      p_room: roomName,
      p_title: title || "Artículo",
      p_image_url: null,
      p_start_price: Number(price) || 0,
      p_increment: Number(increment) || 10,
      p_duration_seconds: Number(duration) || 30,
    });
    setBusy(false);
    setOpen(false);
    setTitle("");
    setPrice("");
    onStarted();
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger>
        <Button size="2" radius="full" className="w-full">
          ➕ Subastar artículo
        </Button>
      </Dialog.Trigger>
      <Dialog.Content style={{ maxWidth: 400 }}>
        <Dialog.Title>Nueva subasta</Dialog.Title>
        <Flex direction="column" gap="3" mt="2">
          <label>
            <Text as="div" size="1" weight="bold" mb="1">
              Artículo
            </Text>
            <TextField.Input
              style={{ fontSize: 16 }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej. Pikachu VMAX PSA 10"
            />
          </label>
          <Flex gap="3">
            <label style={{ flex: 1 }}>
              <Text as="div" size="1" weight="bold" mb="1">
                Precio inicial
              </Text>
              <TextField.Input
                style={{ fontSize: 16 }}
                type="number"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
              />
            </label>
            <label style={{ flex: 1 }}>
              <Text as="div" size="1" weight="bold" mb="1">
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
          </Flex>
          <label>
            <Text as="div" size="1" weight="bold" mb="1">
              Duración (segundos)
            </Text>
            <TextField.Input
              style={{ fontSize: 16 }}
              type="number"
              inputMode="numeric"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </label>
          <Button size="3" disabled={busy || !title} onClick={start}>
            {busy ? "Iniciando..." : "Iniciar subasta"}
          </Button>
        </Flex>
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
      p_bidder: localParticipant.identity,
      p_bidder_name: localParticipant.identity,
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
        <Flex align="center" justify="between" gap="2">
          <Flex direction="column" className="min-w-0">
            <Text size="2" weight="bold" className="text-white truncate">
              {auction!.title}
            </Text>
            <Text size="1" className="text-white/70 truncate">
              {auction!.current_bidder_name
                ? `Va ganando: ${auction!.current_bidder_name}`
                : "Sé el primero en pujar"}
            </Text>
          </Flex>
          <Flex direction="column" align="end">
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
          <Button
            size="3"
            radius="full"
            className="w-full mt-2"
            disabled={busy}
            onClick={bid}
          >
            {busy ? "..." : `Pujar $${nextBid.toLocaleString()}`}
          </Button>
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
        <Text size="2" weight="bold" className="text-white">
          🔨 Vendido: {auction!.title}
        </Text>
        <Text as="div" size="1" className="text-accent-11">
          a {auction!.current_bidder_name} por $
          {Number(auction!.current_price).toLocaleString()}
        </Text>
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
