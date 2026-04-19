// ──────────────────────────────────────────────
// Game: Session Lifecycle Service
// ──────────────────────────────────────────────

import type { SessionSummary } from "@marinara-engine/shared";

/**
 * Build the context string that is injected into a new session's chat
 * so the GM and agents have continuity from prior sessions.
 */
export function buildSessionCarryoverContext(summaries: SessionSummary[]): string {
  if (summaries.length === 0) return "";

  const sections: string[] = [
    `<previous_session_summaries>`,
    `The following are summaries of past sessions. Use them to maintain continuity:`,
  ];

  for (const s of summaries) {
    sections.push(
      ``,
      `--- Session ${s.sessionNumber} ---`,
      s.summary,
      `Party dynamics: ${s.partyDynamics}`,
      `Party state: ${s.partyState}`,
      `Key discoveries: ${s.keyDiscoveries.join(", ")}`,
      `NPC updates: ${s.npcUpdates.join(", ")}`,
    );
  }

  sections.push(`</previous_session_summaries>`);
  return sections.join("\n");
}

/**
 * Create a "Previously on..." recap narration prompt for the GM
 * when starting a new session.
 */
export function buildRecapPrompt(summaries: SessionSummary[]): string {
  const latest = summaries[summaries.length - 1];
  if (!latest) return "";

  return [
    `Write a dramatic "Previously on..." recap for the players.`,
    `Base it on this session summary:`,
    ``,
    latest.summary,
    ``,
    `Party dynamics: ${latest.partyDynamics}`,
    `Key discoveries: ${latest.keyDiscoveries.join(", ")}`,
    ``,
    `Write 2–3 paragraphs of engaging recap narration. End with a hook that transitions into the new session.`,
  ].join("\n");
}
