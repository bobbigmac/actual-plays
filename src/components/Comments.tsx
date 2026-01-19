"use client";

import { useEffect, useMemo, useState } from "react";
import { SignInButton, useUser } from "@clerk/nextjs";

type Comment = {
  id: string;
  user: {
    id: string;
    clerkUserId: string;
    name: string | null;
    email: string | null;
    handle: string | null;
  };
  parentId: string | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
};

function buildTree(comments: Comment[]) {
  const byId = new Map<string, Comment & { replies: any[] }>();
  const roots: (Comment & { replies: any[] })[] = [];

  for (const c of comments) byId.set(c.id, { ...c, replies: [] });
  for (const c of comments) {
    const node = byId.get(c.id)!;
    if (c.parentId && byId.has(c.parentId)) byId.get(c.parentId)!.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

function fmtUser(u: Comment["user"]) {
  return u.handle ?? u.name ?? u.email ?? "anon";
}

export default function Comments({ episodeId }: { episodeId: string }) {
  const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!clerkConfigured) return <CommentsNoAuth episodeId={episodeId} />;
  return <CommentsClerk episodeId={episodeId} />;
}

function CommentsNoAuth({ episodeId }: { episodeId: string }) {
  const [items, setItems] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(items), [items]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/comments`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to load comments");
      setItems(json.comments);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  function Node({ c, depth }: { c: any; depth: number }) {
    return (
      <div style={{ marginLeft: depth * 14, marginTop: 10 }}>
        <div className="card">
          <div className="row">
            <small>
              <b>{fmtUser(c.user)}</b> · {new Date(c.createdAt).toLocaleString()}
              {c.editedAt ? " · edited" : ""}
            </small>
          </div>
          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: c.deletedAt ? 0.6 : 1 }}>
            {c.deletedAt ? "[deleted]" : c.body}
          </div>
        </div>

        {c.replies?.length ? (
          <div style={{ marginTop: 8 }}>
            {c.replies.map((r: any) => (
              <Node key={r.id} c={r} depth={depth + 1} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section style={{ marginTop: 22 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>Comments</h3>
        <small>{items.length} total</small>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <small>Auth not configured; comments are read-only.</small>
          <button onClick={() => void load()}>Refresh</button>
        </div>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Error:</b> {err}
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        {loading ? <small>Loading…</small> : null}
        {!loading && tree.length === 0 ? <small>No comments yet.</small> : null}
        {!loading && tree.length ? (
          <div style={{ marginTop: 8 }}>
            {tree.map((c: any) => (
              <Node key={c.id} c={c} depth={0} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CommentsClerk({ episodeId }: { episodeId: string }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const [items, setItems] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(items), [items]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/comments`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to load comments");
      setItems(json.comments);
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  async function submit() {
    setErr(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, parentId: replyTo })
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error("Sign in to comment");
      if (!res.ok) throw new Error(json?.error ?? "Failed to post");
      setBody("");
      setReplyTo(null);
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    }
  }

  async function softDelete(id: string) {
    setErr(null);
    try {
      const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to delete");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    }
  }

  async function edit(id: string, nextBody: string) {
    setErr(null);
    try {
      const res = await fetch(`/api/comments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: nextBody })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Failed to edit");
      await load();
    } catch (e: any) {
      setErr(e?.message ?? "Error");
    }
  }

  function Node({ c, depth }: { c: any; depth: number }) {
    const mine = !!user && user.id === c.user.clerkUserId;
    const canEdit = mine && !c.deletedAt;

    return (
      <div style={{ marginLeft: depth * 14, marginTop: 10 }}>
        <div className="card">
          <div className="row">
            <small>
              <b>{fmtUser(c.user)}</b> · {new Date(c.createdAt).toLocaleString()}
              {c.editedAt ? " · edited" : ""}
            </small>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setReplyTo(c.id)}>Reply</button>
              {mine ? <button onClick={() => void softDelete(c.id)}>Delete</button> : null}
              {canEdit ? (
                <button
                  onClick={() => {
                    const next = prompt("Edit comment:", c.body);
                    if (next !== null) void edit(c.id, next);
                  }}
                >
                  Edit
                </button>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: 8, whiteSpace: "pre-wrap", opacity: c.deletedAt ? 0.6 : 1 }}>
            {c.deletedAt ? "[deleted]" : c.body}
          </div>
        </div>

        {c.replies?.length ? (
          <div style={{ marginTop: 8 }}>
            {c.replies.map((r: any) => (
              <Node key={r.id} c={r} depth={depth + 1} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section style={{ marginTop: 22 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>Comments</h3>
        <small>{items.length} total</small>
      </div>

      {err ? (
        <div className="card" style={{ marginTop: 12 }}>
          <b>Error:</b> {err}
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row">
          <small>
            {replyTo ? (
              <>
                Replying · <button onClick={() => setReplyTo(null)}>Cancel</button>
              </>
            ) : (
              "New comment"
            )}
          </small>
          <small>
            {!isLoaded ? "…" : isSignedIn ? "Signed in" : "Not signed in"}
          </small>
        </div>
        <div style={{ marginTop: 10 }}>
          {!isSignedIn ? (
            <div className="card" style={{ marginBottom: 10 }}>
              <div className="row">
                <small>Sign in to post</small>
                <SignInButton mode="modal">
                  <button>Sign in</button>
                </SignInButton>
              </div>
            </div>
          ) : null}
          <textarea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Say something useful…"
          />
          <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
            <button disabled={!isSignedIn || !body.trim()} onClick={() => void submit()}>
              Post
            </button>
            <button onClick={() => void load()}>Refresh</button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        {loading ? <small>Loading…</small> : null}
        {!loading && tree.length === 0 ? <small>No comments yet.</small> : null}
        {!loading && tree.length ? (
          <div style={{ marginTop: 8 }}>
            {tree.map((c: any) => (
              <Node key={c.id} c={c} depth={0} />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
