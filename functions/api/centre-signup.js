/**
 * Cloudflare Pages Function — POST /api/centre-signup
 *
 * Same-origin endpoint for public/centres.html. A centre that wants to offer its
 * programme through Lotus submits its details here. The Function validates the
 * submission, runs spam checks, then fires a repository_dispatch to the private
 * lotus repo, where a GitHub Action creates a labelled lead issue. The GitHub
 * token never reaches the browser.
 *
 * Env (Pages -> Settings -> Variables and Secrets) — shared with feedback.js:
 *   LOTUS_TOKEN                (secret) token with dispatch rights on GITHUB_REPO
 *   GITHUB_REPO                "MetaProvide/lotus"   (dispatch target)
 *   TURNSTILE_SECRET           (secret) Turnstile secret key   (optional)
 *   SIGNUP_DISPATCH_EVENT_TYPE defaults to "centre-signup"     (optional)
 */

const VALID_CENTRE_TYPES = {
  residential: "Residential",
  urban: "Urban / city",
  retreat: "Retreat-only",
  virtual: "Online",
};

const MAX_NEEDS = 12;

export async function onRequestPost(context) {
  const request = context.request;
  const env = context.env;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid request." }, 400);
  }

  if (body.website) return json({ ok: true }, 200); // honeypot

  const centreType = String(body.centre_type || "").toLowerCase();
  const centreName = clip(body.centre_name, 120);
  const country = clip(body.country, 60);
  const contactName = clip(body.contact_name, 80);
  const email = clip(body.email, 120);

  if (!VALID_CENTRE_TYPES[centreType] || !centreName || !country || !contactName || !email) {
    return json({ error: "Please complete the required fields." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Please enter a valid email address." }, 400);
  }
  if (!body.consent) {
    return json({ error: "Consent is required so we may contact you." }, 400);
  }

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body["cf-turnstile-response"], request);
    if (!ok) return json({ error: "Spam check failed. Please try again." }, 400);
  }

  const cf = request.cf || {};

  const payload = {
    centre_type: VALID_CENTRE_TYPES[centreType],
    centre_type_key: centreType,
    centre_name: centreName,
    country: country,
    network: clip(body.network, 80),
    website_url: clipUrl(body.website_url, 200),
    contact_name: contactName,
    role: clip(body.role, 80),
    email: email,
    size: clip(body.size, 60),
    needs: normalizeNeeds(body.needs),
    current_tools: clip(body.current_tools, 160),
    timeline: clip(body.timeline, 60),
    notes: clip(body.notes, 2000),
    submitted_at: new Date().toISOString(),
    source_country: clip(cf.country, 8),
  };

  const eventType = env.SIGNUP_DISPATCH_EVENT_TYPE || "centre-signup";
  const res = await fetch("https://api.github.com/repos/" + env.GITHUB_REPO + "/dispatches", {
    method: "POST",
    headers: ghHeaders(env.LOTUS_TOKEN),
    body: JSON.stringify({ event_type: eventType, client_payload: payload }),
  });

  if (!res.ok) {
    console.log("dispatch error", res.status, await res.text());
    return json({ error: "Could not submit right now. Please try again shortly." }, 502);
  }
  return json({ ok: true }, 202);
}

// Accepts an array (from the form) or a comma-joined string, returns a clean array.
function normalizeNeeds(v) {
  let list = [];
  if (Array.isArray(v)) list = v;
  else if (typeof v === "string" && v) list = v.split(",");
  return list
    .map(function (n) { return clip(n, 60); })
    .filter(Boolean)
    .slice(0, MAX_NEEDS);
}

// Keep only http(s) URLs so nothing odd ends up rendered as a link in the issue.
function clipUrl(v, max) {
  const s = clip(v, max);
  if (!s) return "";
  return /^https?:\/\/[^\s]+$/i.test(s) ? s : "";
}

function ghHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "lotus-centre-signup",
    "Content-Type": "application/json",
  };
}

function clip(v, max) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: { "Content-Type": "application/json" },
  });
}

async function verifyTurnstile(secret, token, request) {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const d = await r.json();
    return !!d.success;
  } catch (e) {
    return false;
  }
}
