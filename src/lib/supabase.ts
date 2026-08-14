import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(url, anon);

export type Auction = {
  id: string;
  room_name: string;
  title: string;
  image_url: string | null;
  start_price: number;
  current_price: number;
  current_bidder: string | null;
  current_bidder_name: string | null;
  bid_increment: number;
  status: string;
  ends_at: string | null;
  created_at: string;
};
