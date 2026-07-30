import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterMultiSelectProps {
  options: FilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  ariaLabel?: string;
}

/**
 * Dropdown buscável com múltipla seleção — usado nos filtros de
 * Centro de Custo e Projeto. Mostra apenas as opções realmente
 * disponíveis na lista atual (passadas via `options`).
 */
export function FilterMultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Todos",
  searchPlaceholder = "Buscar...",
  emptyText = "Nenhuma opção disponível",
  ariaLabel,
}: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selecionados`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          className="h-9 w-full justify-between bg-muted/30 border-border font-normal text-xs"
          disabled={options.length === 0}
        >
          <span className={`truncate ${selected.length === 0 ? "text-muted-foreground" : "text-foreground"}`}>
            {options.length === 0 ? emptyText : summary}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="h-9" />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSelected = selected.includes(opt.value);
                return (
                  <CommandItem key={opt.value} value={opt.label} onSelect={() => toggle(opt.value)}>
                    <Check className={`mr-2 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-2 py-1.5">
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {selected.length} selecionado{selected.length > 1 ? "s" : ""}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => onChange([])}
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Limpar
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
