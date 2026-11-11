import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { currentCommand, matchingCommands, type CommandChoice } from "../../../../shared/integration-commands.ts";
import { t as translate } from "../../../../shared/localization/index.ts";
import { Icon } from "../../components/ui.tsx";

export function useCommandSuggestions(text: string, choices: CommandChoice[], change: (text: string) => void, input: RefObject<HTMLTextAreaElement | null>, loading = false) {
  const id = useId();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (dismissed !== text) setDismissed(null); }, [text, dismissed]);
  const [selection, setSelection] = useState({ text: "", index: 0 });
  const matches = focused && dismissed !== text ? matchingCommands(text, choices) : [];
  const selected = selection.text === text ? Math.min(selection.index, Math.max(0, matches.length - 1)) : 0;
  const current = focused ? currentCommand(text, choices) : undefined;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [selected, text]);
  const pick = (choice: CommandChoice) => {
    const value = `${choice.path} `;
    change(value);
    setDismissed(value);
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(value.length, value.length); });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (event.nativeEvent.isComposing || !matches.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelection({ text, index: (selected + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length });
      return true;
    }
    if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey)) {
      event.preventDefault();
      pick(matches[selected]!);
      return true;
    }
    if (event.key === "Escape") { event.preventDefault(); setDismissed(text); return true; }
    return false;
  };
  const open = !!matches.length;
  return {
    onKeyDown,
    inputProps: {
      "aria-autocomplete": "list" as const,
      "aria-controls": open ? id : undefined,
      "aria-activedescendant": open ? `${id}-${selected}` : undefined,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
    },
    menu: open ? (
      <div className="suggestions command-suggestions" id={id} role="listbox" aria-label={translate("integrations.commands")} ref={list}>
        <div className="command-suggestions-title"><Icon name="cable" size={15} /><strong>{translate("integrations.commands")}</strong><span>{translate("integrations.commandKeys")}</span></div>
        {matches.map((choice, index) => <button type="button" role="option" id={`${id}-${index}`} aria-selected={index === selected} key={choice.id} className={index === selected ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => pick(choice)}>
          <span className="command-symbol" aria-hidden="true">/</span>
          <span className="command-suggestion-content"><strong>{choice.path}</strong><span className="command-usage">{choice.usage}</span><small>{choice.description}</small></span>
          <span className="command-integration">{choice.integration}</span>
        </button>)}
      </div>
    ) : focused && loading && text.startsWith("/") ? <div className="command-hint" role="status">{translate("common.6cc1bbba0f84")}</div>
      : current ? <div className="command-hint"><code>{current.usage}</code><span>{current.integration}</span></div> : null,
  };
}
