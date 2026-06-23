import type { Metadata } from "next";
import { Editor } from "@/components/editor/editor";

export const metadata: Metadata = {
  title: "Visual Automation Builder — H0 Hackathon",
  description:
    "Design, version, and execute automation workflows on an infinite canvas. Built for the H0 Hackathon.",
};

export default function Home() {
  return <Editor />;
}
