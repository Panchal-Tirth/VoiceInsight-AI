"use client";
import Explorer from "@/components/Explorer";
import { PageHead } from "@/components/Charts";

export default function Calls() {
  return (
    <>
      <PageHead title="Call Explorer" sub="Search, filter and open any analysed call. Filters above apply to every page." />
      <Explorer />
    </>
  );
}
