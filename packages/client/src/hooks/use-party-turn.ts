// ──────────────────────────────────────────────
// Hook: usePartyTurn
//
// Calls the party-turn endpoint to generate
// party member reactions to the GM narration.
// ──────────────────────────────────────────────

import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api-client";
import { parsePartyDialogue } from "../lib/party-dialogue-parser";
import type { PartyDialogueLine } from "@marinara-engine/shared";

interface PartyTurnInput {
  chatId: string;
  narration: string;
  playerAction?: string;
  connectionId?: string;
}

interface PartyTurnResponse {
  raw: string;
}

export interface PartyTurnResult {
  raw: string;
  lines: PartyDialogueLine[];
}

async function generatePartyTurn(input: PartyTurnInput): Promise<PartyTurnResult> {
  const res = await api.post<PartyTurnResponse>("/game/party-turn", input);
  const lines = parsePartyDialogue(res.raw);
  return { raw: res.raw, lines };
}

export function usePartyTurn() {
  return useMutation({
    mutationFn: generatePartyTurn,
  });
}
