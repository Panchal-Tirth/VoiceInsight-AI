"use client";
import { ReactNode } from "react";
import { StoreProvider } from "@/lib/store";
import { TipProvider } from "./Tip";
import Shell from "./Shell";

export default function Providers({ children }: { children: ReactNode }) {
  return <TipProvider><StoreProvider><Shell>{children}</Shell></StoreProvider></TipProvider>;
}
