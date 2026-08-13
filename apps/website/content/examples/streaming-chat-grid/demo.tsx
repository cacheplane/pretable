"use client";

import { ChatGrid } from "./ChatGrid";
import { scriptedResponseEvents } from "./scripted-response";

export default function Demo() {
  return (
    <ChatGrid
      prompt="Summarize the last 10 incidents."
      openResponseEvents={scriptedResponseEvents}
    />
  );
}
