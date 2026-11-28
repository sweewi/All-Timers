"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { markGuideSeen } from "@/app/actions";
import { connectStatsfmAction, makeMyLoginLink } from "@/app/settings/actions";
import { ShareSheet } from "./ShareSheet";

/**
 * The walkthrough: first get set up (list, phone, stats.fm), then a tour of what to do
 * here, with examples. Opens by itself on someone's first visit, and any time from the
 * "?" in the header. The checklist reads live status, so done steps show as done.
 */

type Status = {
  name: string;
  handle: string;
  crewName: string;
  inviteCode: string;
  members: number;
  devices: number;
  songs: number;
  onDeck: number;
  stories: number;
  statsfm: boolean;
  setInStone: boolean;
};

type Step = {
  chapter: "Get set up" | "How it works" | "Welcome in";
  title: string;
  done?: (s: Status) => boolean;
  render: (ctx: { s: Status | null; close: () => void; reload: () => void; path: string }) => React.ReactNode;
};

const OPEN_EVENT = "alltimers:open-guide";
const STEP_KEY = "alltimers.guide.step";
const RESUME_KEY = "alltimers.guide.resume";

/** Close the guide to go do a setup step; it picks up at `step` once you've left `awayFrom`. */
function resumeLater(step: number, awayFrom: string) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ step, awayFrom, at: Date.now() }));
  } catch {}
}

export function openGuide() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function HelpButton() {
  return (
    <button type="button" onClick={openGuide} className="help-btn" aria-label="Open the guide" title="Guide">
      ?
    </button>
  );
}

export function Guide({ autoOpen }: { autoOpen: boolean }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [needsSeen, setNeedsSeen] = useState(autoOpen);
  const path = usePathname();
  const card = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/guide", { cache: "no-store" });
      if (r.ok) setStatus((await r.json()) as Status);
    } catch {
      /* the checklist just shows without ticks */
    }
  }, []);

  const show = useCallback(
    (from?: number) => {
      let at = from ?? 0;
      if (from === undefined) {
        try {
          at = Number(localStorage.getItem(STEP_KEY) ?? 0) || 0;
        } catch {}
      }
      setI(Math.min(Math.max(0, at), STEPS.length - 1));
      setOpen(true);
      reload();
    },
    [reload],
  );

  // first visit: open once by itself (a moment after the page settles)
  useEffect(() => {
    if (!autoOpen) return;
    const t = setTimeout(() => show(0), 700);
    return () => clearTimeout(t);
  }, [autoOpen, show]);

  // came back from a setup step (e.g. the import page): continue the tour where it left off
  useEffect(() => {
    let r: { step: number; awayFrom: string; at: number } | null = null;
    try {
      r = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null");
    } catch {}
    if (!r || path.startsWith(r.awayFrom)) return;
    try {
      localStorage.removeItem(RESUME_KEY);
    } catch {}
    if (Date.now() - r.at > 6 * 3_600_000) return; // stale: don't ambush someone tomorrow
    const step = r.step;
    const t = setTimeout(() => show(step), 900);
    return () => clearTimeout(t);
  }, [path, show]);

  useEffect(() => {
    const h = () => show();
    window.addEventListener(OPEN_EVENT, h);
    return () => window.removeEventListener(OPEN_EVENT, h);
  }, [show]);

  const close = useCallback(() => {
    setOpen(false);
    if (needsSeen) {
      setNeedsSeen(false);
      markGuideSeen().catch(() => {});
    }
  }, [needsSeen]);

  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(STEP_KEY, String(i));
    } catch {}
    card.current?.scrollTo({ top: 0 });
  }, [i, open]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setI((x) => Math.min(STEPS.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  if (!open) return null;
  const step = STEPS[i];
  const setupSteps = STEPS.filter((s) => s.done);
  const doneCount = status ? setupSteps.filter((s) => s.done!(status)).length : 0;
  const last = i === STEPS.length - 1;

  return createPortal(
    <div className="guide-backdrop" onClick={close} role="dialog" aria-modal aria-label="All-Timers guide">
      <div className="guide-card" ref={card} onClick={(e) => e.stopPropagation()}>
        <div className="guide-top">
          <span className="sticker sticker-blue">{step.chapter}</span>
          {status && step.chapter === "Get set up" && (
            <span className="text-xs text-[#8a7f6d]">
              {doneCount} of {setupSteps.length} done
            </span>
          )}
          <button type="button" onClick={close} className="guide-x" aria-label="Close the guide">
            ×
          </button>
        </div>
        <h2 className="guide-title">
          {step.done && status && step.done(status) && <span className="guide-check">✓</span>}
          {step.title}
        </h2>
        <div className="guide-body">{step.render({ s: status, close, reload, path })}</div>
        <div className="guide-nav">
          <button type="button" onClick={() => setI(i - 1)} disabled={i === 0} className="guide-back">
            ← Back
          </button>
          <div className="guide-dots" aria-hidden>
            {STEPS.map((st, k) => (
              <button
                key={k}
                type="button"
                tabIndex={-1}
                onClick={() => setI(k)}
                className={`${k === i ? "is-on" : ""} ${st.done && status && st.done(status) ? "is-done" : ""}`}
              />
            ))}
          </div>
          {last ? (
            <button type="button" onClick={close} className="sticker sticker-steal sticker-lg">
              Let&apos;s go
            </button>
          ) : (
            <button type="button" onClick={() => setI(i + 1)} className="sticker sticker-steal sticker-lg">
              {i === 0 ? "Show me" : "Next →"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ the steps

function Tip({ children }: { children: React.ReactNode }) {
  return <p className="guide-tip">{children}</p>;
}

function Go({ href, label, close }: { href: string; label: string; close: () => void }) {
  return (
    <Link href={href} onClick={close} className="guide-go">
      {label} →
    </Link>
  );
}

function PhoneLink({ reload }: { reload: () => void }) {
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  if (!link) {
    return (
      <button
        type="button"
        disabled={pending}
        className="guide-go"
        onClick={() =>
          start(async () => {
            setLink(new URL(await makeMyLoginLink(), window.location.origin).toString());
          })
        }
      >
        {pending ? "Making a link…" : "Make a sign-in link for my phone →"}
      </button>
    );
  }
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  return (
    <div className="guide-linkbox">
      <code>{link}</code>
      <div className="mt-2 flex flex-wrap gap-2">
        {canShare && (
          <button type="button" className="sticker sticker-steal" onClick={() => navigator.share({ url: link }).catch(() => {})}>
            Send it…
          </button>
        )}
        <button
          type="button"
          className="sticker sticker-paper"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
            } catch {}
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <button type="button" className="text-xs text-[#8a7f6d] underline" onClick={reload}>
          I opened it, check again
        </button>
      </div>
      <p className="mt-2 text-xs text-[#8a7f6d]">Text, email or AirDrop it to yourself and open it on your phone. Works once, for 24 hours.</p>
    </div>
  );
}

function StatsfmInline({ reload }: { reload: () => void }) {
  const [v, setV] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="guide-form"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        start(async () => {
          const r = await connectStatsfmAction(v);
          if (!r.ok) setMsg(r.message);
          else {
            setMsg("Linked. Your numbers fill in over the next minute.");
            reload();
          }
        });
      }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="stats.fm username or profile link"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={300}
      />
      <button disabled={pending || !v.trim()} className="sticker sticker-steal">
        {pending ? "Checking…" : "Link"}
      </button>
      {msg && <p className="w-full text-sm text-[#6e624f]">{msg}</p>}
    </form>
  );
}

const STEPS: Step[] = [
  {
    chapter: "Get set up",
    title: "Welcome to All-Timers",
    render: ({ s }) => (
      <>
        <div className="guide-art guide-art-columns" aria-hidden>
          <span style={{ height: 70 }} />
          <span style={{ height: 110 }} />
          <span style={{ height: 88 }} />
        </div>
        <p>
          {s ? `${s.name}, this` : "This"} is where {s?.crewName ?? "your crew"} keeps everyone&apos;s favorite songs of all time, ranked. Each
          person&apos;s list stands as a marble column on the plaza: their #1 at the top, in the stars.
        </p>
        <p>
          The point isn&apos;t the list, it&apos;s the arguments: <i>that&apos;s</i> your #1? How is this not on yours? Who put you on to that?
        </p>
        <Tip>First a minute of setup, then a quick tour. You can reopen this any time with the ? at the top.</Tip>
      </>
    ),
  },
  {
    chapter: "Get set up",
    title: "Raise your column",
    done: (s) => s.songs > 0,
    render: ({ s, close, path }) => (
      <>
        {s && s.songs > 0 ? (
          <p>
            Your column has <b>{s.songs} songs</b>. You can reorder, add or drop songs any time from <b>My column → List &amp; reorder</b>.
          </p>
        ) : (
          <>
            <p>
              Make a Spotify playlist of your all-timers in order, <b>#1 at the top</b>, then paste its link. That&apos;s it: one link, works
              from your phone.
            </p>
            {path.startsWith("/me/import") ? (
              <button
                type="button"
                className="guide-go"
                onClick={() => {
                  resumeLater(2, "/me/import");
                  close();
                }}
              >
                I&apos;m on the right page, let me paste it →
              </button>
            ) : (
              <Go
                href="/me/import"
                label="Bring in my list"
                close={() => {
                  resumeLater(2, "/me/import");
                  close();
                }}
              />
            )}
            <p className="text-sm text-[#8a7f6d]">The tour picks up again once your list is in.</p>
          </>
        )}
        <Tip>
          Order matters more than length: 10 songs or 100 are both fine. Every move you make shows up in the feed, so moving a song up is a
          small announcement. Expect questions.
        </Tip>
      </>
    ),
  },
  {
    chapter: "Get set up",
    title: "Get it on your phone",
    done: (s) => s.devices > 1,
    render: ({ s, reload }) => (
      <>
        <p>
          There are no passwords here. This device is signed in{s && s.devices > 1 ? `, and so are ${s.devices - 1} more` : ""}. To sign
          in somewhere else, make a sign-in link here and open it there.
        </p>
        {s && s.devices > 1 ? <p>You&apos;re signed in on {s.devices} devices. You&apos;re set.</p> : <PhoneLink reload={reload} />}
        <Tip>Lost a phone? An admin can make you a new link from Settings.</Tip>
      </>
    ),
  },
  {
    chapter: "Get set up",
    title: "Link stats.fm",
    done: (s) => s.statsfm,
    render: ({ s, reload }) => (
      <>
        <p>If you use stats.fm, link it. It makes building the list easier:</p>
        <ul className="guide-list">
          <li>
            <b>Suggestions</b>: the songs you&apos;ve played most, ready to add
          </li>
          <li>
            <b>Receipts</b>: real play counts on your column (&ldquo;412 plays&rdquo;), if you want them shown
          </li>
        </ul>
        {s?.statsfm ? <p>✓ Linked. Fine-tune what friends see in Settings.</p> : <StatsfmInline reload={reload} />}
        <Tip>Optional. Your stats.fm privacy settings always win, and unlinking deletes everything the site saved.</Tip>
      </>
    ),
  },
  {
    chapter: "How it works",
    title: "Climb each other's columns",
    render: ({ close }) => (
      <>
        <div className="guide-art">
          <div className="guide-plate">
            <small>III</small>
            <b>Dreams</b>
            <span>FLEETWOOD MAC</span>
            <em>92 PLAYS</em>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            <span className="sticker sticker-friend" style={{ ["--c" as string]: "#2f8f5b" }}>
              Sam #1
            </span>
            <span className="sticker sticker-friend" style={{ ["--c" as string]: "#3a6fd8" }}>
              Ava #7
            </span>
            <span className="sticker sticker-paper">🌿2 🔥</span>
          </div>
        </div>
        <p>
          Tap a column on the plaza to climb it. Each song shows who else has it and where they rank it (above: Sam has it at #1), plus
          friends&apos; reactions.
        </p>
        <p>
          React to songs and to moves in the feed: <b>🌿 laurel</b> deserves its place, <b>🔥</b> banger, <b>😭</b> gets me, <b>🤝</b>{" "}
          same.
        </p>
        <Go href="/" label="Walk the plaza" close={close} />
      </>
    ),
  },
  {
    chapter: "How it works",
    title: "Say why it's here",
    done: (s) => s.stories > 0,
    render: ({ close }) => (
      <>
        <div className="guide-art">
          <blockquote className="guide-quote">
            &ldquo;The guitar comes in at 4:12 and I lose it every time.&rdquo;
            <span className="mt-2 flex flex-wrap justify-center gap-1">
              <span className="sticker sticker-paper">♪ the solo</span>
              <span className="sticker sticker-paper">put on by Sam</span>
            </span>
          </blockquote>
        </div>
        <p>
          The best part of the site. For any song, say what you love about it, the moment in it, and how it found you. If a friend put you on
          to it, credit them: those credits are how you see who shaped whose taste.
        </p>
        <Go href="/me/stories" label="Open the why room" close={close} />
        <Tip>One line is plenty. Start with your top three.</Tip>
      </>
    ),
  },
  {
    chapter: "How it works",
    title: "Steal from friends",
    render: ({ close }) => (
      <>
        <div className="guide-art">
          <span className="sticker sticker-steal sticker-lg -rotate-2">Steal it</span>
          <span className="guide-arrow">→</span>
          <span className="sticker sticker-paper sticker-lg rotate-1">On Deck · put on by Ava</span>
        </div>
        <p>
          Love a song on someone&apos;s column? <b>Steal it.</b> It lands on your <b>On Deck</b> list, credited to them. On Deck is for
          songs knocking on the door; move one up to your all-timers when it earns it.
        </p>
        <p>With stats.fm linked, On Deck also suggests songs you keep replaying that aren&apos;t on either list.</p>
        <Go href="/me/edit?list=on_deck" label="See my On Deck" close={close} />
      </>
    ),
  },
  {
    chapter: "Welcome in",
    title: "Bring people in",
    render: ({ s }) => (
      <>
        <p>
          Columns get interesting in a crowd{s ? `: ${s.crewName} has ${s.members} so far` : ""}. Anyone can invite people with this link.
        </p>
        {s?.inviteCode && (
          <ShareSheet path={`/join/${s.inviteCode}`} label="Share the invite" message={`Come put your all-time favorite songs next to ours on All-Timers (${s.crewName}):`} />
        )}
        <Tip>Bring this guide back any time with the ? at the top of every page.</Tip>
      </>
    ),
  },
];
