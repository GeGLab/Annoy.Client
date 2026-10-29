import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { ptBR } from "react-day-picker/locale";
import { CalendarDays } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useState } from "react";
import { Button } from "./button.tsx";
export function DatePicker({ value, onValueChange, label }: { value: string; onValueChange: (value: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="date-trigger" aria-label={label}>
          <CalendarDays size={16} />
          {value ? format(parseISO(value), "dd/MM/yyyy") : "Selecionar data"}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="calendar-popover"
          align="start"
          sideOffset={6}
          collisionPadding={{ top: 48, bottom: 12, left: 12, right: 12 }}
          sticky="always"
        >
          <DayPicker
            mode="single"
            locale={ptBR}
            selected={value ? parseISO(value) : undefined}
            onSelect={(date) => {
              onValueChange(date ? format(date, "yyyy-MM-dd") : "");
              setOpen(false);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onValueChange("");
              setOpen(false);
            }}
          >
            Limpar data
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
