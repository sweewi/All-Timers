"use client";

import { useEffect, useState, useTransition } from "react";
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
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ListKind } from "@/db/schema";
import { StoryForm, type StoryValues } from "@/components/StoryForm";
import { moveToList, saveOrder } from "./actions";

export type EditItem = {
  id: string;
  name: string;
  artists: string;
  version: string;
  imageUrl: string | null;
  story: StoryValues;
  hasStory: boolean;
};

type Member = { id: string; name: string; color: string };

export function EditClient({
  kind,
  initial,
  members,
  inviteCode,
}: {
  kind: ListKind;
  initial: EditItem[];
  members: Member[];
  inviteCode: string;
}) {
  const [items, setItems] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // After a save the server sends fresh data; adopt it unless there are unsaved moves.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from server props after refresh
    if (!dirty) setItems(initial);
  }, [initial, dirty]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === e.active.id);
      const to = prev.findIndex((i) => i.id === e.over!.id);
      return arrayMove(prev, from, to);
    });
    setDirty(true);
  };

  const moveTo = (id: string, rank: number) => {
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === id);
      const to = Math.max(0, Math.min(prev.length - 1, rank - 1));
      return arrayMove(prev, from, to);
    });
    setDirty(true);
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    setDirty(true);
  };

  const save = () =>
    start(async () => {
      await saveOrder(
        kind,
        items.map((i) => i.id),
      );
      setDirty(false);
    });

  const other: ListKind = kind === "all_time" ? "on_deck" : "all_time";

  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-muted">
        This list is empty.{" "}
        <a href={`/me/import?list=${kind}`} className="text-accent">
          Import from Spotify →
        </a>
      </p>
    );
  }

  return (
    <div className="mt-6">
      <div className="sticky top-0 z-10 -mx-5 flex items-center gap-3 border-b border-line bg-background/90 px-5 py-3 backdrop-blur">
        <span className="text-sm text-muted">{dirty ? "Unsaved changes" : `${items.length} songs`}</span>
        <span className="flex-1" />
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setItems(initial);
              setDirty(false);
            }}
            className="text-sm text-muted"
          >
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className="rounded-full bg-accent px-5 py-2 text-sm font-medium text-black disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save order"}
        </button>
      </div>

      <DndContext id="edit-list" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ol>
            {items.map((item, idx) => (
              <SortableRow
                key={item.id}
                item={item}
                rank={idx + 1}
                total={items.length}
                open={openId === item.id}
                onToggle={() => setOpenId(openId === item.id ? null : item.id)}
                onMoveTo={(r) => moveTo(item.id, r)}
                onRemove={() => remove(item.id)}
                onSwitchList={
                  dirty
                    ? undefined
                    : () =>
                        start(async () => {
                          await moveToList(item.id, kind, other);
                        })
                }
                otherLabel={other === "on_deck" ? "Move to On Deck" : "Promote to All-Time"}
                members={members}
                inviteCode={inviteCode}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableRow(props: {
  item: EditItem;
  rank: number;
  total: number;
  open: boolean;
  onToggle: () => void;
  onMoveTo: (rank: number) => void;
  onRemove: () => void;
  onSwitchList?: () => void;
  otherLabel: string;
  members: Member[];
  inviteCode: string;
}) {
  const { item, rank } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const hasStory = item.hasStory;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border-b border-line bg-background ${isDragging ? "relative z-20 shadow-2xl" : ""}`}
    >
      <div className="flex items-center gap-3 py-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none px-1 text-muted active:cursor-grabbing"
          aria-label={`Drag ${item.name}`}
        >
          ⋮⋮
        </button>
        <input
          key={rank}
          defaultValue={rank}
          inputMode="numeric"
          aria-label="Rank"
          onBlur={(e) => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n !== rank) props.onMoveTo(n);
            else e.target.value = String(rank);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="rank-num w-12 rounded bg-transparent text-right text-2xl text-muted focus:bg-surface focus:text-foreground focus:outline-none"
        />
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.imageUrl} alt="" className="h-11 w-11 rounded object-cover" />
        ) : (
          <div className="h-11 w-11 rounded bg-surface-2" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{item.name}</div>
          <div className="truncate text-sm text-muted">
            {item.artists}
            {item.version && ` — ${item.version}`}
          </div>
        </div>
        <button
          type="button"
          onClick={props.onToggle}
          className={`rounded-full border px-3 py-1 text-xs ${hasStory ? "border-accent/60 text-accent" : "border-line text-muted"}`}
        >
          {hasStory ? "Why ✓" : "+ Why it's here"}
        </button>
      </div>
      {props.open && (
        <div className="mb-4 ml-8 rounded-2xl border border-line bg-surface p-4">
          <StoryForm
            trackId={item.id}
            trackName={item.name}
            initial={item.story}
            members={props.members}
            inviteCode={props.inviteCode}
          />
          <div className="mt-4 flex gap-4 border-t border-line pt-3 text-xs text-muted">
            {props.onSwitchList ? (
              <button type="button" onClick={props.onSwitchList} className="hover:text-foreground">
                {props.otherLabel}
              </button>
            ) : (
              <span>Save the order first to move songs between lists</span>
            )}
            <button type="button" onClick={props.onRemove} className="hover:text-red-700">
              Remove from list
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
