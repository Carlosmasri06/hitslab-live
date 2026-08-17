"use client";

import { useCopyToClipboard } from "@/lib/clipboard";
import { ParticipantMetadata } from "@/lib/controller";
import {
  AudioTrack,
  StartAudio,
  VideoTrack,
  useChat,
  useDataChannel,
  useLocalParticipant,
  useMediaDeviceSelect,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import {
  EyeClosedIcon,
  EyeOpenIcon,
  PaperPlaneIcon,
} from "@radix-ui/react-icons";
import {
  Avatar,
  Box,
  Button,
  Flex,
  Grid,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import Confetti from "js-confetti";
import {
  ConnectionState,
  DataPacket_Kind,
  LocalVideoTrack,
  Track,
  createLocalTracks,
} from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuctionBar } from "./auction";
import { AccountGate, useBidder } from "./account";
import { PresenceDialog } from "./presence-dialog";
import { useAuthToken } from "./token-context";

// Fits the app to the visible area (above the keyboard) and hard-locks the
// page so iOS Safari can't push everything up / leave a gap.
function useVisualViewport() {
  const [vp, setVp] = useState<{ height: string | number; top: number }>({
    height: "100dvh",
    top: 0,
  });
  useEffect(() => {
    const body = document.body;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      bottom: body.style.bottom,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = "fixed";
    body.style.top = "0";
    body.style.left = "0";
    body.style.right = "0";
    body.style.bottom = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";

    const vv = window.visualViewport;
    const onChange = () => {
      if (vv) setVp({ height: vv.height, top: vv.offsetTop });
    };
    if (vv) {
      vv.addEventListener("resize", onChange);
      vv.addEventListener("scroll", onChange);
      onChange();
    }
    return () => {
      if (vv) {
        vv.removeEventListener("resize", onChange);
        vv.removeEventListener("scroll", onChange);
      }
      Object.assign(body.style, prev);
    };
  }, []);
  return vp;
}

function useMeasuredHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(120);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  return { ref, height };
}

function ConfettiCanvas() {
  const [confetti, setConfetti] = useState<Confetti>();
  const [decoder] = useState(() => new TextDecoder());
  const canvasEl = useRef<HTMLCanvasElement>(null);
  useDataChannel("reactions", (data) => {
    const options: { emojis?: string[]; confettiNumber?: number } = {};
    if (decoder.decode(data.payload) !== "🎉") {
      options.emojis = [decoder.decode(data.payload)];
      options.confettiNumber = 12;
    }
    confetti?.addConfetti(options);
  });
  useEffect(() => {
    setConfetti(new Confetti({ canvas: canvasEl?.current ?? undefined }));
  }, []);
  return <canvas ref={canvasEl} className="absolute inset-0 h-full w-full" />;
}

const CHAT_LIFETIME = 10000;
const CHAT_FADE = 2000;

type FeedItem = {
  key: string;
  kind: "chat" | "join";
  name: string;
  text: string;
  timestamp: number;
};

function ChatOverlay({ bottomOffset }: { bottomOffset: number }) {
  const { chatMessages } = useChat();
  const participants = useParticipants();
  const [now, setNow] = useState(() => Date.now());
  const [joins, setJoins] = useState<
    { id: string; identity: string; timestamp: number }[]
  >([]);
  const seen = useRef<Set<string>>(new Set());
  const inited = useRef(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ids = participants.map((p) => p.identity).filter(Boolean);
    if (!inited.current) {
      ids.forEach((i) => seen.current.add(i));
      inited.current = true;
      return;
    }
    const fresh = ids.filter((i) => !seen.current.has(i));
    if (fresh.length) {
      fresh.forEach((i) => seen.current.add(i));
      const ts = Date.now();
      setJoins((prev) => [
        ...prev,
        ...fresh.map((i, idx) => ({
          id: `${i}-${ts}-${idx}`,
          identity: i,
          timestamp: ts,
        })),
      ]);
    }
  }, [participants]);

  const feed = useMemo<FeedItem[]>(() => {
    const seenTs = new Set<number>();
    const chat: FeedItem[] = chatMessages
      .filter((m) => {
        if (seenTs.has(m.timestamp)) return false;
        seenTs.add(m.timestamp);
        return true;
      })
      .map((m) => ({
        key: `c-${m.timestamp}`,
        kind: "chat",
        name: m.from?.identity ?? "?",
        text: m.message,
        timestamp: m.timestamp,
      }));
    const joinItems: FeedItem[] = joins.map((j) => ({
      key: `j-${j.id}`,
      kind: "join",
      name: j.identity,
      text: "",
      timestamp: j.timestamp,
    }));
    return [...chat, ...joinItems]
      .filter((it) => now - it.timestamp < CHAT_LIFETIME)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-6);
  }, [chatMessages, joins, now]);

  return (
    <div
      style={{ bottom: bottomOffset }}
      className="absolute left-3 right-20 z-20 flex flex-col items-start gap-1.5 pointer-events-none"
    >
      {feed.map((it) => {
        const age = now - it.timestamp;
        const opacity =
          age > CHAT_LIFETIME - CHAT_FADE
            ? Math.max(0, (CHAT_LIFETIME - age) / CHAT_FADE)
            : 1;
        if (it.kind === "join") {
          return (
            <div
              key={it.key}
              style={{ opacity }}
              className="rounded-2xl bg-black/45 backdrop-blur-sm px-3 py-1 transition-opacity duration-500"
            >
              <Text size="1" weight="bold" className="text-accent-11 mr-1">
                {it.name}
              </Text>
              <Text size="1" className="text-white/80">
                se unió 👋
              </Text>
            </div>
          );
        }
        return (
          <div
            key={it.key}
            style={{ opacity }}
            className="max-w-full rounded-2xl bg-black/55 backdrop-blur-sm px-3 py-1.5 transition-opacity duration-500"
          >
            <Text size="1" weight="bold" className="text-accent-11 mr-1">
              {it.name}
            </Text>
            <Text size="1" className="text-white">
              {it.text}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function RightRail({ bottomOffset }: { bottomOffset: number }) {
  const [_, copy] = useCopyToClipboard();
  const { name: roomName } = useRoomContext();
  const { user, bidder, refresh } = useBidder();
  const [walletOpen, setWalletOpen] = useState(false);

  const share = () => {
    const base =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const url = `${base}/watch/${roomName}`;
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      void (navigator as any).share({ title: "HITS LAB Live", url });
    } else {
      copy(url);
    }
  };

  return (
    <>
    <div
      style={{ bottom: bottomOffset }}
      className="absolute right-3 z-20 flex flex-col items-center gap-5 pointer-events-auto"
    >
      <Flex direction="column" align="center" gap="1">
        <button
          onClick={share}
          className="h-11 w-11 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-xl"
        >
          🔗
        </button>
        <Text size="1" className="text-white">
          Compartir
        </Text>
      </Flex>
      <Flex direction="column" align="center" gap="1">
        <button
          onClick={() => setWalletOpen(true)}
          className="h-11 w-11 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-xl"
        >
          💳
        </button>
        <Text size="1" className="text-white">
          Wallet
        </Text>
      </Flex>
      <Flex direction="column" align="center" gap="1">
        <a
          href="https://www.hitslabtcg.com"
          target="_blank"
          rel="noopener noreferrer"
          className="h-11 w-11 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-xl"
        >
          🛍️
        </a>
        <Text size="1" className="text-white">
          Tienda
        </Text>
      </Flex>
    </div>
    <AccountGate
      open={walletOpen}
      onOpenChange={setWalletOpen}
      user={user}
      bidder={bidder}
      refresh={refresh}
    />
    </>
  );
}

function CameraControls() {
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const { state: roomState, name: roomName } = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const authToken = useAuthToken();
  const [ending, setEnding] = useState(false);
  const endLive = async () => {
    if (!window.confirm("¿Terminar el live? Se cerrará para todos.")) return;
    setEnding(true);
    try {
      await fetch("/api/stop_stream", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
    } catch {
      // ignore
    }
    window.location.href = "/";
  };

  const [, copyLink] = useCopyToClipboard();
  const [copied, setCopied] = useState(false);
  const shareLink = () => {
    const base =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (typeof window !== "undefined" ? window.location.origin : "");
    const url = `${base}/watch/${roomName}`;
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      void (navigator as any).share({ title: "HITS LAB Live", url });
    } else {
      copyLink(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    if (roomState === ConnectionState.Connected) {
      void localParticipant.setMicrophoneEnabled(micEnabled);
      void localParticipant.setCameraEnabled(camEnabled);
    }
  }, [micEnabled, camEnabled, localParticipant, roomState]);

  const { devices, activeDeviceId, setActiveMediaDevice } =
    useMediaDeviceSelect({ kind: "videoinput", requestPermissions: false });

  const isFront = (label: string) => label.toLowerCase().includes("front");
  const frontDevices = devices.filter((d) => isFront(d.label));
  const backDevices = devices.filter((d) => !isFront(d.label));
  const activeLabel =
    devices.find((d) => d.deviceId === activeDeviceId)?.label ?? "";
  const onFront = isFront(activeLabel);

  const wide =
    backDevices.find((d) => {
      const l = d.label.toLowerCase();
      return (
        !l.includes("ultra") &&
        !l.includes("tele") &&
        !l.includes("dual") &&
        !l.includes("triple")
      );
    }) ?? backDevices[0];
  const ultra = backDevices.find((d) =>
    d.label.toLowerCase().includes("ultra")
  );
  const tele = backDevices.find((d) => d.label.toLowerCase().includes("tele"));

  const flip = () => {
    const target = onFront ? wide ?? backDevices[0] : frontDevices[0];
    if (target) setActiveMediaDevice(target.deviceId);
  };

  const zoomOptions = [
    { label: "0.5", device: ultra },
    { label: "1", device: wide },
    { label: "2", device: tele },
  ].filter((z) => z.device);

  return (
    <Flex align="center" gap="2" wrap="wrap">
      <Button
        size="1"
        radius="full"
        variant={micEnabled ? "soft" : "surface"}
        onClick={() => setMicEnabled(!micEnabled)}
      >
        {micEnabled ? "🎙️ On" : "🔇 Off"}
      </Button>
      <Button
        size="1"
        radius="full"
        variant={camEnabled ? "soft" : "surface"}
        onClick={() => setCamEnabled(!camEnabled)}
      >
        {camEnabled ? "📷 On" : "🚫 Off"}
      </Button>
      <Button size="1" radius="full" variant="soft" onClick={flip}>
        🔄 Voltear
      </Button>
      <Button size="1" radius="full" variant="soft" onClick={shareLink}>
        {copied ? "✓ Liga copiada" : "🔗 Liga"}
      </Button>
      {!onFront && zoomOptions.length > 1 && (
        <Flex
          align="center"
          gap="1"
          className="rounded-full bg-black/40 backdrop-blur p-1"
        >
          {zoomOptions.map((z) => {
            const active = z.device?.deviceId === activeDeviceId;
            return (
              <button
                key={z.label}
                onClick={() =>
                  z.device && setActiveMediaDevice(z.device.deviceId)
                }
                className={
                  "h-8 min-w-[34px] px-2 rounded-full text-xs font-bold transition-colors " +
                  (active
                    ? "bg-accent-9 text-black"
                    : "bg-transparent text-white")
                }
              >
                {z.label}×
              </button>
            );
          })}
        </Flex>
      )}
      <Button
        size="1"
        radius="full"
        color="red"
        variant="solid"
        disabled={ending}
        onClick={endLive}
      >
        {ending ? "Terminando…" : "⏹ Terminar"}
      </Button>
    </Flex>
  );
}

function BottomBar({ isHost }: { isHost: boolean }) {
  const [draft, setDraft] = useState("");
  const { send: sendChat } = useChat();
  const { send: sendReaction } = useDataChannel("reactions");
  const [encoder] = useState(() => new TextEncoder());

  const onSend = async () => {
    if (draft.trim().length && sendChat) {
      setDraft("");
      await sendChat(draft);
    }
  };

  const react = (emoji: string) => {
    if (sendReaction) {
      sendReaction(encoder.encode(emoji), { kind: DataPacket_Kind.LOSSY });
    }
    if (sendChat) {
      void sendChat(emoji);
    }
  };

  return (
    <Flex direction="column" gap="2">
      {isHost && <CameraControls />}
      <Flex gap="2" align="center">
        <Box className="flex-1">
          <TextField.Input
            radius="full"
            style={{ fontSize: 16 }}
            placeholder="Escribe algo..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyUp={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSend();
              }
            }}
          />
        </Box>
        <IconButton
          radius="full"
          onClick={onSend}
          disabled={!draft.trim().length}
        >
          <PaperPlaneIcon />
        </IconButton>
        {!isHost && (
          <>
            <IconButton
              radius="full"
              variant="soft"
              onClick={() => react("❤️")}
            >
              ❤️
            </IconButton>
            <IconButton
              radius="full"
              variant="soft"
              onClick={() => react("🔥")}
            >
              🔥
            </IconButton>
          </>
        )}
      </Flex>
    </Flex>
  );
}

export function StreamPlayer({ isHost = false }) {
  const vp = useVisualViewport();
  const bottom = useMeasuredHeight();
  const [following, setFollowing] = useState(false);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack>();
  const localVideoEl = useRef<HTMLVideoElement>(null);

  const { name: roomName, state: roomState } = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const localMetadata = (localParticipant.metadata &&
    JSON.parse(localParticipant.metadata)) as ParticipantMetadata;
  const canHost =
    isHost || (localMetadata?.invited_to_stage && localMetadata?.hand_raised);
  const participants = useParticipants();

  useEffect(() => {
    if (canHost) {
      const createTracks = async () => {
        const tracks = await createLocalTracks({ audio: true, video: true });
        const camTrack = tracks.find((t) => t.kind === Track.Kind.Video);
        if (camTrack && localVideoEl?.current) {
          camTrack.attach(localVideoEl.current);
        }
        setLocalVideoTrack(camTrack as LocalVideoTrack);
      };
      void createTracks();
    }
  }, [canHost]);

  const { activeDeviceId: activeCameraDeviceId } = useMediaDeviceSelect({
    kind: "videoinput",
    requestPermissions: false,
  });

  useEffect(() => {
    if (localVideoTrack) {
      void localVideoTrack.setDeviceId(activeCameraDeviceId);
    }
  }, [localVideoTrack, activeCameraDeviceId]);

  const allCameraTracks = useTracks([Track.Source.Camera]);
  const seenRemote = new Set<string>();
  const remoteVideoTracks = allCameraTracks
    .filter((t) => t.participant.identity !== localParticipant.identity)
    .filter((t) => {
      if (seenRemote.has(t.participant.identity)) return false;
      seenRemote.add(t.participant.identity);
      return true;
    });
  const remoteAudioTracks = useTracks([Track.Source.Microphone]).filter(
    (t) => t.participant.identity !== localParticipant.identity
  );

  const overlayOffset = bottom.height + 8;

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        top: vp.top,
        height: vp.height,
      }}
      className="overflow-hidden bg-black"
    >
      <Grid className="absolute inset-0 w-full h-full">
        {canHost && (
          <div className="relative">
            <Flex className="absolute inset-0" align="center" justify="center">
              <Avatar
                size="9"
                fallback={localParticipant.identity[0] ?? "?"}
                radius="full"
              />
            </Flex>
            <video
              ref={localVideoEl}
              className="absolute inset-0 w-full h-full object-cover bg-transparent"
            />
          </div>
        )}
        {remoteVideoTracks.map((t) => (
          <div key={t.participant.identity} className="relative">
            <Flex className="absolute inset-0" align="center" justify="center">
              <Avatar
                size="9"
                fallback={t.participant.identity[0] ?? "?"}
                radius="full"
              />
            </Flex>
            <VideoTrack
              trackRef={t}
              className="absolute inset-0 w-full h-full object-cover bg-transparent"
            />
          </div>
        ))}
      </Grid>

      {remoteAudioTracks.map((t) => (
        <AudioTrack trackRef={t} key={t.participant.identity} />
      ))}

      <ConfettiCanvas />
      <StartAudio
        label="Toca para activar el audio"
        className="absolute inset-0 w-full h-full bg-gray-2-translucent text-white z-40"
      />

      <div className="pointer-events-none absolute top-0 inset-x-0 h-28 z-10 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute bottom-0 inset-x-0 h-52 z-10 bg-gradient-to-t from-black/75 to-transparent" />

      <div className="absolute top-0 inset-x-0 p-3 z-30">
        <Flex justify="between" align="center" gap="2">
          <Flex align="center" gap="2">
            <img
              src="/hitslab-logo.png"
              alt="HITS LAB"
              className="h-9 w-auto pointer-events-none select-none drop-shadow"
            />
            {roomState === ConnectionState.Connected && (
              <Flex
                align="center"
                gap="1"
                className="rounded-full bg-black/40 backdrop-blur px-2 py-1"
              >
                <div className="rounded-full bg-red-9 w-2 h-2 animate-pulse" />
                <Text size="1" weight="bold" className="uppercase text-white">
                  Live
                </Text>
              </Flex>
            )}
            {!isHost && (
              <button
                onClick={() => setFollowing((f) => !f)}
                className={
                  "rounded-full px-3 py-1 text-xs font-bold " +
                  (following
                    ? "bg-black/40 text-white backdrop-blur"
                    : "bg-accent-9 text-black")
                }
              >
                {following ? "Siguiendo" : "Seguir"}
              </button>
            )}
          </Flex>
          {isHost ? (
            <PresenceDialog isHost={isHost}>
              <div className="relative">
                <Button
                  size="1"
                  variant="soft"
                  radius="full"
                  disabled={roomState !== ConnectionState.Connected}
                >
                  {roomState === ConnectionState.Connected ? (
                    <EyeOpenIcon />
                  ) : (
                    <EyeClosedIcon />
                  )}
                  {roomState === ConnectionState.Connected
                    ? participants.length
                    : ""}
                </Button>
              </div>
            </PresenceDialog>
          ) : (
            <div className="relative">
              <Button
                size="1"
                variant="soft"
                radius="full"
                style={{ pointerEvents: "none" }}
                disabled={roomState !== ConnectionState.Connected}
              >
                {roomState === ConnectionState.Connected ? (
                  <EyeOpenIcon />
                ) : (
                  <EyeClosedIcon />
                )}
                {roomState === ConnectionState.Connected
                  ? participants.length
                  : ""}
              </Button>
            </div>
          )}
        </Flex>
      </div>

      <ChatOverlay bottomOffset={overlayOffset} />
      {!isHost && <RightRail bottomOffset={overlayOffset} />}

      <div
        ref={bottom.ref}
        className="absolute bottom-0 inset-x-0 p-3 z-30 pointer-events-none"
      >
        <AuctionBar isHost={isHost} />
        <div className="pointer-events-auto">
          <BottomBar isHost={isHost} />
        </div>
      </div>
    </div>
  );
}
