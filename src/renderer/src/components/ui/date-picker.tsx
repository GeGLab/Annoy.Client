import {t as translate} from "../../../../shared/localization/index.ts";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker } from "react-day-picker";
import { ptBR,enUS,es,fr,it,ja,zhCN } from "react-day-picker/locale";
import {date,localizationPreferences} from "../../../../shared/localization/index.ts";
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
          {value ? date(parseISO(value)) : translate("common.9fc6d9e12bf9")}
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
            locale={{"pt-BR":ptBR,en:enUS,es,fr,it,ja,"zh-Hans":zhCN}[localizationPreferences().language]}
            labels={{labelNext:()=>translate("calendar.next"),labelPrevious:()=>translate("calendar.previous"),labelMonthDropdown:()=>translate("calendar.month"),labelYearDropdown:()=>translate("calendar.year"),labelDayButton:d=>date(d,{dateStyle:"full"}),labelWeekday:d=>date(d,{weekday:"long"}),labelNav:()=>translate("calendar.navigation")}}
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
          >{translate("common.39a564e644f9")}</Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}


