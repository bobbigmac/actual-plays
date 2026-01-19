"use client";

import { useMemo, useState } from "react";
import { SignInButton, useUser } from "@clerk/nextjs";

type CreateShowPayload = {
  slug: string;
  title: string;
  rssUrl: string;
  siteUrl?: string;
  imageUrl?: string;
  description?: string;
  tags?: string[];
};

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function NewShowForm() {
  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!clerkConfigured) return null;
  return <NewShowFormClerk />;
}

function NewShowFormClerk() {
  const { isLoaded, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tags = useMemo(
    () =>
      tagsRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20),
    [tagsRaw]
  );

  async function submit() {
    setErr(null);
    setOk(null);
    setSubmitting(true);
    try {
      const payload: CreateShowPayload = {
        title: title.trim(),
        slug: (slug.trim() || slugify(title)).trim(),
        rssUrl: rssUrl.trim(),
        ...(siteUrl.trim() ? { siteUrl: siteUrl.trim() } : {}),
        ...(desc.trim() ? { description: desc.trim() } : {}),
        ...(tags.length ? { tags } : {})
      };

      const res = await fetch("/api/shows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to submit show");

      setOk(
        json?.admin
          ? "Show created (unapproved=true). As admin you can approve it from the show page."
          : "Submitted for approval (unapproved=true)."
      );
      setTitle("");
      setSlug("");
      setRssUrl("");
      setSiteUrl("");
      setTagsRaw("");
      setDesc("");
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!isLoaded) return null;

  if (!isSignedIn) {
    return (
      <div className="card">
        <div className="row">
          <small>Want to submit a show?</small>
          <SignInButton mode="modal">
            <button>Sign in</button>
          </SignInButton>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>Submit a show</h3>
        <button onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Add"}</button>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Error:</b> {err}
        </div>
      ) : null}
      {ok ? (
        <div className="card" style={{ marginTop: 12 }}>
          {ok}
        </div>
      ) : null}

      {open ? (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Slug (optional; auto from title)"
          />
          <input value={rssUrl} onChange={(e) => setRssUrl(e.target.value)} placeholder="RSS URL" />
          <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="Site URL (optional)" />
          <input
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="Tags (comma-separated, optional)"
          />
          <textarea
            rows={4}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Description (optional)"
          />
          <div style={{ display: "flex", gap: 10 }}>
            <button disabled={submitting || !title.trim() || !rssUrl.trim()} onClick={() => void submit()}>
              Submit
            </button>
            <button disabled={submitting} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <small>New shows are created with unapproved=true.</small>
        </div>
      ) : null}
    </div>
  );
}
