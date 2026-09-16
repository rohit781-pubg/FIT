/* FitMeal India — AI assistant endpoint (P2)
 *
 * This exists so the model API key NEVER reaches the browser. The client
 * calls /api/assistant; this function adds the key server-side.
 *
 * Required environment variable (set in Netlify → Site settings →
 * Environment variables, NOT in any file you commit):
 *
 *   ANTHROPIC_API_KEY   your key from console.anthropic.com
 *
 * Until that variable is set, this endpoint returns 503 and the client
 * shows "the assistant isn't connected yet" rather than failing silently.
 *
 * The client sends a compact context object built from the user's own
 * data. It deliberately does NOT send email, user id, or anything the
 * model does not need to answer a food question.
 */

const MODEL = "claude-sonnet-4-6";

export default async (req) => {
  if (req.method !== "POST")
    return json({ error: "Use POST" }, 405);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return json({
      error: "not_configured",
      message: "The assistant isn't connected yet. Add ANTHROPIC_API_KEY in Netlify environment variables.",
    }, 503);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Body must be JSON" }, 400); }

  const { messages = [], context = {} } = body;
  if (!Array.isArray(messages) || !messages.length)
    return json({ error: "messages is required" }, 400);
  if (messages.length > 24)
    return json({ error: "Conversation too long" }, 400);

  // Only these fields ever leave the browser.
  const safe = {
    goal: context.goal, diet: context.diet,
    target_kcal: context.target_kcal, target_protein: context.target_protein,
    eaten_kcal: context.eaten_kcal, eaten_protein: context.eaten_protein,
    allergies: (context.allergies || []).slice(0, 20),
    dislikes: (context.dislikes || []).slice(0, 20),
    pantry: (context.pantry || []).slice(0, 60),
    budget_inr: context.budget_inr, appliances: context.appliances,
  };

  const system = [
    "You are the nutrition assistant inside FitMeal India, an Indian meal planning app.",
    "Answer about Indian food, portions, and practical cooking. Keep replies short and specific.",
    "All nutrition figures you give are estimates — say so when you give numbers.",
    "You are not a medical professional. Do not diagnose, do not promise weight-loss results,",
    "and do not recommend intakes below 1200 kcal. If the user describes a medical condition,",
    "pregnancy, or disordered eating, say plainly that this needs a doctor or registered dietitian.",
    "Respect the user's dietary preference, allergies and dislikes without exception.",
    "",
    "The user's context, as JSON:",
    JSON.stringify(safe),
  ].join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: 900, system,
        messages: messages.map(m => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content || "").slice(0, 4000),
        })),
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error("model api error", r.status, detail.slice(0, 500));
      return json({ error: "upstream", message: "The assistant is unavailable right now." }, 502);
    }
    const data = await r.json();
    const text = (data.content || [])
      .filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    return json({ text });
  } catch (e) {
    console.error(e);
    return json({ error: "upstream", message: "The assistant is unavailable right now." }, 502);
  }
};

export const config = { path: "/api/assistant" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json" },
  });
}
