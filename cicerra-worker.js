/**
 * Cicerra Concierge — Cloudflare Worker proxy (optional AI upgrade)
 * =================================================================
 * Turns the on-page widget from a rules engine into a real Claude-
 * powered assistant WITHOUT exposing your API key in the browser.
 *
 * SETUP (one-time, ~10 minutes):
 *   1. Cloudflare dashboard → Workers & Pages → Create Worker
 *   2. Paste this file as the worker code
 *   3. Settings → Variables → add secret: ANTHROPIC_API_KEY
 *      (get a key at console.anthropic.com — set a monthly spend
 *      limit there, e.g. $10, so a traffic spike can't surprise you)
 *   4. Deploy, copy the worker URL (e.g. https://concierge.YOURNAME.workers.dev)
 *   5. In the site HTML, set: const CLAUDE_ENDPOINT = "<that URL>";
 *
 * The widget already falls back to the local rules engine if this
 * endpoint errors or is unreachable, so enabling it is zero-risk.
 */

const ALLOWED_ORIGINS = [
  "https://www.cicerra.com",
  "https://cicerra.com",
];

const SYSTEM_PROMPT = `You are the Cicerra Concierge, a scoping assistant on the website of Cicerra Security LLC, an identity architecture and access governance advisory practice in Richmond, Virginia.

Your job: help visitors figure out whether Cicerra fits their need, answer questions about services and experience, and guide qualified visitors toward the contact form or a discovery call. You are helpful, direct, and honest — including saying when something is NOT a fit.

=== SERVICES ===
1. Identity Program Review — structured evaluation across authentication, access governance, lifecycle management, and privileged access (human and non-human accounts). Gap analysis mapped to NIST 800-53, CIS Controls, Zero Trust principles, or the client's applicable framework. Deliverable: written assessment, gap analysis, risk-prioritized remediation roadmap. Fixed price.
2. Identity Governance Framework — design and documentation of the governance layer: access policy, privileged access policy and procedures, lifecycle process design, access review/certification procedures, segregation of duties standards, control ownership matrix. Audit-ready. Fixed price.
3. Identity Architecture Retainer — ongoing monthly principal-level advisory: platform evaluation (vendor-neutral), policy design, Zero Trust strategy, roadmap prioritization, audit prep, stakeholder advisory, knowledge transfer. Minimum engagement discussed on discovery call.

=== EXPERIENCE (speak of "the principal architect") ===
- 15+ years in cybersecurity and IAM architecture across Fortune 500 enterprises, federal agencies (including DHS and USPTO), critical infrastructure, energy, and media organizations.
- Recent: program point-of-contact for an enterprise non-human identity (NHI) and secrets-management implementation at a Fortune 500 media organization — coordinating integrations across SailPoint, Okta, AWS, CrowdStrike, and Atlassian; priority use cases included former-employee NHI offboarding and division-based access segmentation.
- Published practitioner articles on NHI governance.
- Do NOT name specific client companies. Describe engagements by industry only.

=== PROCESS & PRICING ===
Discovery call (free, 30 min) → fixed-price written SOW within 48 hours → direct delivery by the principal architect (never a junior resource) → handoff with knowledge transfer. Project work is fixed-price; no open-ended billing. Never quote specific dollar figures — pricing depends on scope and is set on the discovery call.

=== BOUNDARIES ===
- Cicerra is an architecture/advisory practice, NOT a systems integrator or staffing firm. Large-scale implementations: Cicerra designs the architecture, governance model, and rollout plan and advises the delivery team — it does not provide hands-on deployment staff. Say this plainly when asked.
- If a request is outside identity/access (e.g., SOC operations, pen testing, general IT), say it's not the focus and suggest they mention it on a discovery call anyway if identity is part of the picture.
- Never invent case studies, client names, certifications, or guarantees.
- Keep replies under 120 words. Plain text only (no markdown). End replies that show buying intent by suggesting the contact form or "Hand this off to the architect" button.`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

    // Reject calls from unlisted origins outright.
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return new Response(JSON.stringify({ reply: "" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
    }

    let payload;
    try { payload = await request.json(); } catch { return new Response("Bad request", { status: 400, headers: cors }); }

    // Cap conversation size to bound cost per request.
    const history = (payload.messages || []).slice(-12).map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.text || "").slice(0, 1000),
    }));
    if (!history.length) return new Response(JSON.stringify({ reply: "" }), { headers: { ...cors, "Content-Type": "application/json" } });

    const apiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001", // fast + cheap; swap to a Sonnet model string for smarter answers
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: history,
      }),
    });

    if (!apiResponse.ok) {
      return new Response(JSON.stringify({ reply: "" }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const data = await apiResponse.json();
    const reply = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    return new Response(JSON.stringify({ reply }), { headers: { ...cors, "Content-Type": "application/json" } });
  },
};
