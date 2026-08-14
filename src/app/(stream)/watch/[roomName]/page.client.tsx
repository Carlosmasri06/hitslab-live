"use client";

import { StreamPlayer } from "@/components/stream-player";
import { TokenContext } from "@/components/token-context";
import { JoinStreamResponse } from "@/lib/controller";
import { cn } from "@/lib/utils";
import { LiveKitRoom } from "@livekit/components-react";
import { ArrowRightIcon, PersonIcon } from "@radix-ui/react-icons";
import {
  Avatar,
  Button,
  Card,
  Flex,
  Heading,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";
import { Spinner } from "@/components/spinner";

export default function WatchPage({
  roomName,
  serverUrl,
}: {
  roomName: string;
  serverUrl: string;
}) {
  const [name, setName] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [roomToken, setRoomToken] = useState("");
  const [loading, setLoading] = useState(false);

  const onJoin = async () => {
    setLoading(true);
    const res = await fetch("/api/join_stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room_name: roomName,
        identity: name,
      }),
    });
    const {
      auth_token,
      connection_details: { token },
    } = (await res.json()) as JoinStreamResponse;

    setAuthToken(auth_token);
    setRoomToken(token);
  };

  if (!authToken || !roomToken) {
    return (
      <Flex
        align="center"
        justify="center"
        className="min-h-[100dvh] p-4 bg-black"
      >
        <Card className="p-4 w-full max-w-[380px]">
          <Flex justify="center" mb="4">
            <img
              src="/hitslab-logo.png"
              alt="HITS LAB"
              className="h-14 w-auto"
            />
          </Flex>
          <Heading size="4" align="center" className="mb-1">
            {decodeURI(roomName)}
          </Heading>
          <Text as="div" size="2" align="center" className="mb-4 text-gray-11">
            Entra al en vivo
          </Text>
          <label>
            <Text as="div" size="2" mb="1" weight="bold">
              Tu nombre
            </Text>
            <TextField.Root>
              <TextField.Slot>
                <Avatar
                  size="1"
                  radius="full"
                  fallback={name ? name[0] : <PersonIcon />}
                />
              </TextField.Slot>
              <TextField.Input
                style={{ fontSize: 16 }}
                placeholder="Escribe tu nombre"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </TextField.Root>
          </label>
          <Flex mt="5" justify="center">
            <Button
              size="3"
              disabled={!name || loading}
              onClick={onJoin}
              className="w-full"
            >
              {loading ? (
                <Flex gap="2" align="center">
                  <Spinner />
                  <Text>Entrando...</Text>
                </Flex>
              ) : (
                <>
                  Entrar al en vivo{" "}
                  <ArrowRightIcon className={cn(name && "animate-wiggle")} />
                </>
              )}
            </Button>
          </Flex>
        </Card>
      </Flex>
    );
  }

  return (
    <TokenContext.Provider value={authToken}>
      <LiveKitRoom serverUrl={serverUrl} token={roomToken}>
        <div className="w-full h-[100dvh] bg-black">
          <StreamPlayer />
        </div>
      </LiveKitRoom>
    </TokenContext.Provider>
  );
}
