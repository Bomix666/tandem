import { NextResponse } from "next/server";
import { buildLeadFacts, getProposalGenerator } from "@/lib/leads/proposal";
import { getLead, saveProposal } from "@/lib/leads/repository";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";

// POST /api/leads/:id/proposal — «✨ Создать предложение» по фактам лида.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { workspace } = await leadsAuth(request);
    const lead = await getLead(params.id, workspace.id);
    if (!lead) return notFound();

    const { generator, note } = getProposalGenerator();
    const text = await generator.generate(buildLeadFacts(lead));
    await saveProposal(lead.id, text);
    return NextResponse.json({ text, engine: generator.label, note });
  } catch (err) {
    return leadsError(err);
  }
}
