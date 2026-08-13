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
import { PresenceDialog } from "./presence-dialog";
import { useAuthToken } from "./token-context";

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

  return (
    <canvas ref={canvasEl} className="absolute inset-0 h-full w-full z-10" />
  );
}

const CHAT_LIFETIME = 10000;
const CHAT_FADE = 2000;

function ChatOverlay() {
  const { chatMessages } = useChat();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const recent = useMemo(() => {
    const seen = new Set<number>();
    const unique = chatMessages.filter((m) => {
      if (seen.has(m.timestamp)) return false;
      seen.add(m.timestamp);
      return true;
    });
    return unique
      .filter((m) => now - m.timestamp < CHAT_LIFETIME)
      .slice(-6);
  }, [chatMessages, now]);

  return (
    <div className="absolute left-3 right-20 bottom-28 z-20 flex flex-col items-start gap-1.5 pointer-events-none">
      {recent.map((msg) => {
        const age = now - msg.timestamp;
        const opacity =
          age > CHAT_LIFETIME - CHAT_FADE
            ? Math.max(0, (CHAT_LIFETIME - age) / CHAT_FADE)
            : 1;
        return (
          <div
            key={msg.timestamp}
            style={{ opacity }}
            className="max-w-full rounded-2xl bg-black/55 backdrop-blur-sm px-3 py-1.5 transition-opacity duration-500"
          >
            <Text size="1" weight="bold" className="text-accent-11 mr-1">
              {msg.from?.identity ?? "?"}
            </Text>
            <Text size="1" className="text-white">
              {msg.message}
            </Text>
          </div>
        );
      })}
    </div>
  );
}

function RightRail() {
  const [_, copy] = useCopyToClipboard();
  const { name: roomName } = useRoomContext();

  const share = () => {
    const url = `${process.env.NEXT_PUBLIC_SITE_URL}/watch/${roomName}`;
    if (typeof navigator !== "undefined" && (navigator as any).share) {
      void (navigator as any).share({ title: "HITS LAB Live", url });
    } else {
      copy(url);
    }
  };

  return (
    <div className="absolute right-3 bottom-28 z-20 flex flex-col items-center gap-5">
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
  );
}

function CameraControls() {
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const { state: roomState } = useRoomContext();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (roomState === ConnectionState.Connected) {
      void localParticipant.setMicrophoneEnabled(micEnabled);
      void localParticipant.setCameraEnabled(camEnabled);
    }
  }, [micEnabled, camEnabled, localParticipant, roomState]);

  const { devices, activeDeviceId, setActiveMediaDevice } =
    useMediaDeviceSelect({ kind: "videoinput" });

  const isFront = (label: string) => label.toLowerCase().includes("front");
  const frontDevices = devices.filter((d) => isFront(d.label));
  const backDevices = devices.filter((d) => !isFront(d.label));

  const activeLabel =
    devices.find((d) => d.deviceId === activeDeviceId)?.label ?? "";
  const onFront = isFront(activeLabel);

  const pickWide = () =>
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
  const wide = pickWide();
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
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack>();
  const localVideoEl = useRef<HTMLVideoElement>(null);

  const { name: roomName, state: roomState } = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const localMetadata = (localParticipant.metadata &&
    JSON.parse(localParticipant.metadata)) as ParticipantMetadata;
  const canHost =
    isHost || (localMetadata?.invited_to_stage && localMetadata?.hand_raised);
  const participants = useParticipants();
  const showNotification = isHost
    ? participants.some((p) => {
        const metadata = (p.metadata &&
          JSON.parse(p.metadata)) as ParticipantMetadata;
        return metadata?.hand_raised && !metadata?.invited_to_stage;
      })
    : localMetadata?.invited_to_stage && !localMetadata?.hand_raised;

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

  const { devices: cameraDevices, activeDeviceId: activeCameraDeviceId } =
    useMediaDeviceSelect({
      kind: "videoinput",
    });

  useEffect(() => {
    if (localVideoTrack) {
      void localVideoTrack.setDeviceId(activeCameraDeviceId);
    }
  }, [localVideoTrack, activeCameraDeviceId]);

  const activeCamLabel =
    cameraDevices.find((d) => d.deviceId === activeCameraDeviceId)?.label ?? "";
  const mirrorSelf = activeCamLabel.toLowerCase().includes("front");

  const remoteVideoTracks = useTracks([Track.Source.Camera]).filter(
    (t) => t.participant.identity !== localParticipant.identity
  );

  const remoteAudioTracks = useTracks([Track.Source.Microphone]).filter(
    (t) => t.participant.identity !== localParticipant.identity
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
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
              className={
                "absolute inset-0 w-full h-full object-cover bg-transparent " +
                (mirrorSelf ? "-scale-x-100" : "")
              }
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
      <div className="pointer-events-none absolute bottom-0 inset-x-0 h-44 z-10 bg-gradient-to-t from-black/70 to-transparent" />

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
          </Flex>
          <PresenceDialog isHost={isHost}>
            <div className="relative">
              {showNotification && (
                <div className="absolute flex h-3 w-3 -top-1 -right-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-11 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-accent-11"></span>
                </div>
              )}
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
        </Flex>
      </div>

      <ChatOverlay />
      {!isHost && <RightRail />}

      <div className="absolute bottom-0 inset-x-0 p-3 z-30">
        <BottomBar isHost={isHost} />
      </div>
    </div>
  );
}
