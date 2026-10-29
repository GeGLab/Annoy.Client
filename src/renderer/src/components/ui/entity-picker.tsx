import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Search, Shield, UserRound } from "lucide-react";
import { useState } from "react";

export interface PickerEntity {
  id: string;
  label: string;
  description?: string;
  group: string;
  color?: string | null;
  avatarUrl?: string | null;
  customized?: boolean;
}
/** Searchable, grouped selection shared by permissions and other people/role filters. */
export function EntityPicker({
  items,
  value,
  onValueChange,
  label,
  placeholder = "Selecionar…",
  disabled = false,
}: {
  items: PickerEntity[];
  value: string;
  onValueChange: (id: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value);
  const groups = [...new Set(items.map((item) => item.group))];
  const visual = (item: PickerEntity) =>
    item.avatarUrl ? (
      <img className="entity-avatar" src={item.avatarUrl} alt="" />
    ) : (
      <span className="entity-avatar" style={{ color: item.color ?? undefined }}>
        {item.group === "Cargos" ? <Shield size={17} /> : <UserRound size={17} />}
      </span>
    );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="entity-trigger" role="combobox" aria-label={label} aria-expanded={open} disabled={disabled}>
          {selected && visual(selected)}
          <span className="entity-copy">
            <strong>{selected?.label ?? placeholder}</strong>
            {selected && (
              <small>
                {selected.group}
                {selected.customized ? " · Permissões personalizadas" : ""}
              </small>
            )}
          </span>
          <ChevronsUpDown size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="entity-popover" align="start" sideOffset={6} collisionPadding={12}>
          <Command label={label} loop>
            <div className="entity-search">
              <Search size={17} />
              <Command.Input placeholder="Buscar por nome ou usuário…" />
            </div>
            <Command.List>
              <Command.Empty>Nenhum resultado. Tente outro nome.</Command.Empty>
              {groups.map((group) => (
                <Command.Group key={group} heading={group}>
                  {items
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`${item.label} ${item.description ?? ""} ${item.id}`}
                        onSelect={() => {
                          onValueChange(item.id);
                          setOpen(false);
                        }}
                      >
                        {visual(item)}
                        <span className="entity-copy">
                          <strong>{item.label}</strong>
                          {item.description && <small>{item.description}</small>}
                        </span>
                        {item.customized && <span className="entity-custom">Personalizado</span>}
                        {value === item.id && <Check size={16} />}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
          <p className="entity-hint">Escolha quem terá as permissões abaixo.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
