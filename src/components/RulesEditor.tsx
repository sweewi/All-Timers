"use client";

import { useState, useTransition } from "react";
import { saveRules } from "@/app/me/actions";

/** The rules a list is held to: shown as an inscription, editable by its owner. */
export function RulesEditor({ initial, editable }: { initial: string | null; editable: boolean }) {
  const [rules, setRules] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rules);
  const [pending, start] = useTransition();
  if (editing)
    return (
      <form
        className="rules-form"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            setRules(await saveRules(draft));
            setEditing(false);
          });
        }}
      >
        <label htmlFor="rules-input">What earns a spot on this list?</label>
        <textarea
          id="rules-input"
          className="field"
          rows={2}
          maxLength={200}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Songs I'd still play at 80. If I ever skipped it, it's out."
          autoFocus
        />
        <div className="flex justify-center gap-2">
          <button type="submit" className="btn btn-gold btn-sm" disabled={pending}>
            Save the rules
          </button>
          <button type="button" className="btn btn-marble btn-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </form>
    );
  return (
    <div className="mon-rules">
      {rules && <q>{rules}</q>}
      {editable && (
        <button
          type="button"
          className="rules-edit"
          onClick={() => {
            setDraft(rules);
            setEditing(true);
          }}
        >
          {rules ? "Edit my rules" : "Add my rules: what earns a spot?"}
        </button>
      )}
    </div>
  );
}
