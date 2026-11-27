"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { saveBallotAction, withdrawAction } from "./actions";

export type PoolCard = {
  id: string;
  name: string;
  artists: string;
  imageUrl: string | null;
  nominatedBy: string | null;
  mine: boolean;
  from: { name: string; color: string; rank: number; streams: number | null }[];
};

/**
 * The pool on the left, your ballot on the right. Tap a song to rank it; drag to
 * reorder; save when you're happy. Nobody sees how you voted until the reveal.
 */
export function Ballot({
  month,
  pool,
  initial,
}: {
  month: string;
  pool: PoolCard[];
  initial: string[];
}) {
  const byId = new Map(pool.map((p) => [p.id, p]));
  const [order, setOrder] = useState(() =>
    initial.filter((id) => byId.has(id)),
  );
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [listening, setListening] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 160, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const change = (next: string[]) => {
    setOrder(next);
    setDirty(true);
    setMsg(null);
  };
  const toggle = (id: string) =>
    change(order.includes(id) ? order.filter((x) => x !== id) : [...order, id]);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    change(
      arrayMove(
        order,
        order.indexOf(String(e.active.id)),
        order.indexOf(String(e.over.id)),
      ),
    );
  };
  const save = () =>
    start(async () => {
      const r = await saveBallotAction(month, order);
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved") : r.message });
      if (r.ok) setDirty(false);
    });

  return (
    <div className="ballot-grid">
      <div className="pool">
        {pool.map((p, i) => {
          const at = order.indexOf(p.id);
          return (
            <div
              key={p.id}
              className={`pool-card ${at >= 0 ? "is-ranked" : ""}`}
              style={{
                rotate: `${[-1.2, 0.8, -0.4, 1.4, -0.9, 0.5][i % 6]}deg`,
              }}
            >
              <button
                type="button"
                className="pool-art"
                onClick={() => toggle(p.id)}
                aria-pressed={at >= 0}
                aria-label={at >= 0 ? `Unrank ${p.name}` : `Rank ${p.name}`}
              >
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" />
                ) : (
                  <span className="block h-full w-full bg-stone-300" />
                )}
                <span className="pool-badge">
                  {at >= 0 ? `#${at + 1}` : "+"}
                </span>
              </button>
              <button
                type="button"
                className={`pool-play ${listening === p.id ? "is-on" : ""}`}
                onClick={() => setListening(listening === p.id ? null : p.id)}
                aria-label={
                  listening === p.id
                    ? `Stop listening to ${p.name}`
                    : `Listen to ${p.name}`
                }
              >
                {listening === p.id ? "■" : "▶"}
              </button>
              <b>{p.name}</b>
              <small>{p.artists}</small>
              <span className="mt-2 flex flex-wrap gap-1">
                {p.from.map((f) => (
                  <span
                    key={f.name}
                    className="sticker sticker-friend"
                    style={{ ["--c" as string]: f.color }}
                    title={f.streams != null ? `${f.streams} plays this month` : `their #${f.rank} this month`}
                  >
                    {f.name} #{f.rank}
                    {f.streams != null && ` · ${f.streams} ${f.streams === 1 ? "play" : "plays"}`}
                  </span>
                ))}
                {p.nominatedBy && (
                  <span className="sticker sticker-paper">
                    picked by {p.nominatedBy}
                  </span>
                )}
              </span>
              {p.mine && p.from.length === 0 && (
                <button
                  type="button"
                  className="mt-2 self-start text-xs text-[#8a7f6d] underline-offset-2 hover:underline"
                  onClick={() =>
                    start(async () => {
                      const r = await withdrawAction(month, p.id);
                      if (!r.ok) setMsg({ ok: false, text: r.message });
                      else setOrder((o) => o.filter((x) => x !== p.id));
                    })
                  }
                >
                  withdraw
                </button>
              )}
            </div>
          );
        })}
      </div>

      <aside className="ballot">
        <div className="flex items-baseline justify-between">
          <h2 className="font-[family-name:var(--font-garamond)] text-2xl font-semibold">
            Your ballot
          </h2>
          <span className="text-xs text-[#8a7f6d]">secret till the reveal</span>
        </div>
        {order.length === 0 ? (
          <p className="mt-3 text-sm text-[#6e624f]">
            Tap songs in the pool to rank them, best first. Rank as many or as
            few as you like.
          </p>
        ) : (
          <DndContext
            id="ballot"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={order}
              strategy={verticalListSortingStrategy}
            >
              <ol className="mt-3 space-y-1.5">
                {order.map((id, i) => {
                  const p = byId.get(id);
                  return p ? (
                    <BallotRow key={id} p={p} i={i} remove={() => toggle(id)} />
                  ) : null;
                })}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            className="sticker sticker-steal sticker-lg"
            disabled={pending || !dirty}
            onClick={save}
          >
            {pending ? "Saving…" : dirty ? "Save ballot" : "Saved"}
          </button>
          {msg && (
            <span
              className={`text-sm ${msg.ok ? "text-[#2f8f5b]" : "text-red-700"}`}
            >
              {msg.text}
            </span>
          )}
        </div>
      </aside>

      {listening &&
        createPortal(
          <div className="quick-listen" role="region" aria-label="Quick listen">
            <iframe
              key={listening}
              title="Spotify player"
              src={`https://open.spotify.com/embed/track/${listening}?utm_source=generator&theme=0`}
              width="100%"
              height="80"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
            />
            <button
              type="button"
              onClick={() => setListening(null)}
              aria-label="Close player"
            >
              ×
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function BallotRow({
  p,
  i,
  remove,
}: {
  p: PoolCard;
  i: number;
  remove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: p.id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`ballot-row ${isDragging ? "is-dragging" : ""}`}
      {...attributes}
      {...listeners}
    >
      <span className="ballot-num">{i + 1}</span>
      {p.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.imageUrl}
          alt=""
          className="h-9 w-9 rounded-sm object-cover"
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{p.name}</span>
        <span className="block truncate text-xs text-[#8a7f6d]">
          {p.artists}
        </span>
      </span>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={remove}
        className="px-1 text-lg leading-none text-[#a3977f] hover:text-red-700"
        aria-label={`Remove ${p.name}`}
      >
        ×
      </button>
    </li>
  );
}
