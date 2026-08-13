import "@/styles/globals.css";

import { Theme, ThemePanel } from "@radix-ui/themes";
import type { Metadata } from "next";
import { Sora } from "next/font/google";

const sora = Sora({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HITS LAB — Live",
  description: "Compra en vivo de HITS LAB TCG",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={sora.className}>
        <Theme
          appearance="dark"
          accentColor="amber"
          grayColor="sand"
          radius="large"
        >
          {children}
          <ThemePanel defaultOpen={false} />
        </Theme>
      </body>
    </html>
  );
}
