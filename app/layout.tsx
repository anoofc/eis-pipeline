import type { Metadata } from "next";
import "./styles.css";
export const metadata: Metadata = {
  title: "EIS Workspace",
  description: "Event Innovation Systems · Pipeline and Quotation Manager",
  robots: { index:false, follow:false },
};

export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>;
}
