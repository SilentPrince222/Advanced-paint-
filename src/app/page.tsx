"use client";

import { useState } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";
import { Editor } from "@/components/editor/editor";

type Screen =
  | { view: "dashboard" }
  | { view: "editor"; flowId: string };

export default function Home() {
  const [screen, setScreen] = useState<Screen>({ view: "dashboard" });

  if (screen.view === "editor") {
    return (
      <Editor
        flowId={screen.flowId}
        onBack={() => setScreen({ view: "dashboard" })}
      />
    );
  }

  return (
    <Dashboard
      onSelectFlow={(id) => setScreen({ view: "editor", flowId: id })}
    />
  );
}
