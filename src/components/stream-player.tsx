"use client";

import { useCopyToClipboard } from "@/lib/clipboard";
import { ParticipantMetadata, RoomMetadata } from "@/lib/controller";
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
  useRoomInfo,
  useTracks,
} from "@livekit/components-react";
import {
  CopyIcon,
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
import { MediaDeviceSettings } from "./media-device-settings";
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

function ChatOverlay() {
  const { chatMessages } = useChat();

  const recent = useMemo(() => {
    const seen = new Set<number>();
    const unique = chatMessages.filter((m) => {
      if (seen.has(m.timestamp)) return false;
      seen.add(m.timestamp);
      return true;
    });
    return unique.slice(-6);
  }, [chatMessages]);

  return (
    <div className="absolute left-3 right-20 bottom-28 z-20 flex flex-col items-start gap-1.5 pointer-events-none">
      {recent.map((msg) => (
        <div
          key={msg.timestamp}
          className="max-w-full rounded-2xl bg-black/55 backdrop-blur-sm px-3 py-1.5"
        >
          <Text size="1" weight="bold" className="text-accent-11 mr-1">
            {msg.from?.identity ?? "?"}
          </Text>
          <Text size="1" className="text-white">
            {msg.message}
          </Text>
        </div>
      ))}
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
        <div className="h-11 w-11 rounded-full bg-black/45 backdrop-blur flex items-center justify-center text-xl opacity-70">
          🛍️
        </div>
        <Text size="1" className="text-white opacity-70">
          Tienda
        </Text>
      </Flex>
    </div>
  );
}

function BottomBar({ isHost }: { isHost: boolean }) {
  const [draft, setDraft] = useState("");
  const { send: sendChat } = useChat();
  const { send: sendReaction } = useDataChannel("reactions");
  const { metadata } = useRoomInfo();
  const [encoder] = useState(() => new TextEncoder());

  const { enable_chat: chatEnabled } = (
    metadata ? JSON.parse(metadata) : {}
  ) as RoomMetadata;

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
      {isHost && (
        <Flex gap="2" align="center" wrap="wrap">
          <MediaDeviceSettings />
        </Flex>
      )}
      <Flex gap="2" align="center">
        <Box className="flex-1">
          <TextField.Input
            radius="full"
            disabled={!chatEnabled}
            placeholder={chatEnabled ? "Escribe algo..." : "Chat desactivado"}
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

  const { activeDeviceId: activeCameraDeviceId } = useMediaDeviceSelect({
    kind: "videoinput",
  });

  useEffect(() => {
    if (localVideoTrack) {
      void localVideoTrack.setDeviceId(activeCameraDeviceId);
    }
  }, [localVideoTrack, activeCameraDeviceId]);

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
              className="absolute inset-0 w-full h-full object-cover -scale-x-100 bg-transparent"
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
