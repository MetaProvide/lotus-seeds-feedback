/**
 * Cloudflare Pages Function — POST /api/feedback
 *
 * Same-origin endpoint for public/index.html. Validates the submission, runs
 * spam checks, optionally stores an annotated screenshot in the public assets
 * repo, then fires a repository_dispatch to the private lotus repo. A GitHub
 * Action there creates the issue. The GitHub token never reaches the browser.
 *
 * Env (Pages -> Settings -> Variables and Secrets):
 *   LOTUS_TOKEN      (secret) classic toke (dispatch)
 *   ASSETS_TOKEN     (secret) fine-grained PAT for ASSETS_REPO, Contents R/W (image upload)
 *   GITHUB_REPO      "MetaProvide/lotus"                (dispatch target)
 *   ASSETS_REPO      "MetaProvide/lotus-seeds-feedback" (public repo storing images)
 *   ASSETS_BRANCH    "uploads"                          (branch for images)
 *   TURNSTILE_SECRET (secret) Turnstile secret key      (optional)
 *   DISPATCH_EVENT_TYPE  defaults to "seeds-feedback"   (optional)
 */

const VALID_TYPES = { feature: true, improvement: true, bug: true };
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

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

  const type = String(body.type || "").toLowerCase();
  const centre = clip(body.centre, 80);
  const title = clip(body.title, 120);
  const description = clip(body.description, 5000);
  if (!VALID_TYPES[type] || !centre || !title || !description) {
    return json({ error: "Please complete the required fields." }, 400);
  }

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body["cf-turnstile-response"], request);
    if (!ok) return json({ error: "Spam check failed. Please try again." }, 400);
  }

  let imageUrl = "";
  if (body.image && env.ASSETS_REPO) {
    try {
      imageUrl = await uploadImage(env, body.image);
    } catch (e) {
      console.log("image upload skipped:", e && e.message);
    }
  }

  const payload = {
    type: type,
    centre: centre,
    title: title,
    description: description,
    impact: clip(body.impact, 200),
    name: clip(body.name, 80),
    email: clip(body.email, 120),
    image_url: imageUrl,
  };

  const eventType = env.DISPATCH_EVENT_TYPE || "seeds-feedback";
  const res = await fetch("https://api.github.com/repos/" + env.GITHUB_REPO + "/dispatches", {
    method: "POST",
    headers: ghHeaders(lotusToken(env)),
    body: JSON.stringify({ event_type: eventType, client_payload: payload }),
  });

  if (!res.ok) {
    console.log("dispatch error", res.status, await res.text());
    return json({ error: "Could not submit right now. Please try again shortly." }, 502);
  }
  return json({ ok: true }, 202);
}

async function uploadImage(env, dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m) throw new Error("unsupported image format");
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const b64 = m[2];
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) throw new Error("image too large");

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const path = "uploads/" + yyyy + "/" + mm + "/" + crypto.randomUUID() + "." + ext;
  const branch = env.ASSETS_BRANCH || "uploads";

  const url = "https://api.github.com/repos/" + env.ASSETS_REPO + "/contents/" + path;
  const r = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(assetsToken(env)),
    body: JSON.stringify({ message: "[CF-Pages-Skip] feedback screenshot " + path, content: b64, branch: branch }),
  });
  if (!r.ok) throw new Error("contents api " + r.status + ": " + (await r.text()));
  const data = await r.json();
  return (data && data.content && data.content.download_url) || "";
}

// Token for the dispatch target (lotus).
function lotusToken(env) {
  return env.LOTUS_TOKEN;
}

// Token for the assets repo (lotus-seeds-feedback).
function assetsToken(env) {
  return env.ASSETS_TOKEN;
}

function ghHeaders(token) {
  return {
    Authorization: "Bearer " + token,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "lotus-seeds-feedback",
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
