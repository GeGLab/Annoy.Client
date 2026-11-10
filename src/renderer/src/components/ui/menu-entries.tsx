import * as Menu from "@radix-ui/react-menu";
import type { OverlayMenuEntry, OverlayMenuPick } from "../../../../shared/overlay-menu.ts";
import { Icon, type IconName } from "./icon.tsx";

/** Rows of a data menu, shared by the page and the overlay layer. */
export function MenuEntries({ entries, onPick }: { entries: OverlayMenuEntry[]; onPick: (pick: OverlayMenuPick) => void }) {
  return <>{entries.map((entry, index) => {
    if (entry.kind === "separator") return <Menu.Separator key={index} className="ui-dropdown-separator" />;
    if (entry.kind === "label") return <Menu.Label key={index} className="ui-menu-label">{entry.text}</Menu.Label>;
    if (entry.kind === "item") return <Menu.Item key={entry.id} disabled={entry.disabled} className={`ui-dropdown-item${entry.destructive ? " destructive" : ""}`} onSelect={() => onPick({ id: entry.id })}>
      {entry.icon && <Icon name={entry.icon as IconName} />}{entry.text}
    </Menu.Item>;
    return <Menu.RadioGroup key={entry.id} value={entry.value} onValueChange={(value) => onPick({ id: entry.id, value })}>
      {entry.options.map((option) => <Menu.RadioItem key={option.value} value={option.value} className="ui-dropdown-item ui-dropdown-radio">
        <span className="dropdown-radio-indicator"><Menu.ItemIndicator>•</Menu.ItemIndicator></span>{option.text}
      </Menu.RadioItem>)}
    </Menu.RadioGroup>;
  })}</>;
}
