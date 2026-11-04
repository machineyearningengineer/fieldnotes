// Looseleaf, MIT. See ui/looseleaf/LICENSE.
"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";

import { Icon } from "@/ui/looseleaf/components/ui/icon";
import { Paper, type PaperProps } from "@/ui/looseleaf/components/ui/paper";
import { Separator } from "@/ui/looseleaf/components/ui/separator";
import { useInk, useInkScope, useMergedRef } from "@/ui/looseleaf/lib/ink/react";
import { selectRecipe } from "@/ui/looseleaf/lib/ink/recipes/select-ink";
import { cn } from "@/ui/looseleaf/lib/utils";

const SelectDisabledContext = React.createContext(false);

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return (
    <SelectDisabledContext.Provider value={!!props.disabled}>
      <SelectPrimitive.Root data-slot="select" {...props} />
    </SelectDisabledContext.Provider>
  );
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1", className)}
      {...props}
    />
  );
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  seed,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
  seed?: string | number;
}) {
  const invalid = props["aria-invalid"] === true || props["aria-invalid"] === "true";
  const disabled = React.useContext(SelectDisabledContext) || !!props.disabled;
  const { hostRef, hostProps, node } = useInk({
    recipe: selectRecipe,
    params: { disabled, invalid },
    kind: "field",
    seed,
    still: true,
  });
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      ref={useMergedRef<HTMLButtonElement>(hostRef, ref)}
      {...hostProps}
      className={cn(
        "group/select-trigger relative isolate flex h-9 w-fit items-center justify-between gap-2 ps-3 text-start font-hand text-base whitespace-nowrap text-(--ll-input-ink) compact:h-8 calm:h-7 calm:text-[15px] data-[size=sm]:h-8 data-[size=sm]:text-[15px] compact:data-[size=sm]:h-7 disabled:cursor-not-allowed disabled:text-pencil-text data-[placeholder]:text-(--ll-placeholder) forced-colors:aria-invalid:underline forced-colors:aria-invalid:decoration-wavy",
        "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not(.absolute):not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {node}
      {children}
      <SelectPrimitive.Icon
        data-slot="select-icon"
        className="grid h-full w-8 shrink-0 place-items-center text-ink-soft transition-transform duration-(--ll-dur-pop) ease-pop group-data-[state=open]/select-trigger:rotate-180 group-disabled/select-trigger:text-pencil-text"
      >
        <Icon name="chevron-down" size={16} />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  stock = "slip",
  edge,
  tilt = true,
  tape,
  seed,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> &
  Pick<PaperProps, "stock" | "edge" | "tilt" | "tape" | "seed">) {
  const scope = useInkScope();
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content asChild position={position} align={align} {...props}>
        <Paper
          data-slot="select-content"
          stock={stock}
          edge={edge}
          tilt={tilt}
          tape={tape}
          rules="none"
          seed={seed}
          {...scope}
          className={cn(
            "z-(--ll-z-popover) max-h-(--radix-select-content-available-height) min-w-32 origin-(--radix-select-content-transform-origin) text-popover-foreground outline-hidden",
            "duration-(--ll-dur-pop) data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className,
          )}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            className={cn(
              "p-1 compact:p-0.5 calm:p-0.5",
              position === "popper" &&
                "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width) scroll-my-1",
            )}
          >
            {children}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </Paper>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 font-type text-sm tracking-wide text-ink-muted", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-8 w-full cursor-default items-center gap-2 py-1.5 ps-2 pe-8 font-hand text-base outline-hidden select-none compact:min-h-7 compact:py-1 calm:min-h-7 calm:py-1 calm:text-[15px]",
        "data-[highlighted]:ll-swipe data-[state=checked]:font-bold data-[disabled]:pointer-events-none data-[disabled]:text-pencil-text",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not(.absolute):not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className,
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute end-2 flex size-4 items-center justify-center"
      >
        <SelectPrimitive.ItemIndicator className="flex animate-[ll-wipe_var(--ll-dur-sheet)_var(--ll-ease-out)_both]">
          <Icon name="check" size={16} className="text-ink-you forced-colors:text-[CanvasText]" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator asChild {...props}>
      <Separator
        data-slot="select-separator"
        className={cn("pointer-events-none -mx-1 my-1.5 w-auto", className)}
      />
    </SelectPrimitive.Separator>
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-ink-soft",
        className,
      )}
      {...props}
    >
      <Icon name="chevron-up" size={16} />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1 text-ink-soft",
        className,
      )}
      {...props}
    >
      <Icon name="chevron-down" size={16} />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
