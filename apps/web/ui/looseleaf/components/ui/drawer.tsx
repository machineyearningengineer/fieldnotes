// Looseleaf, MIT. See ui/looseleaf/LICENSE.
"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { Paper, type PaperProps } from "@/ui/looseleaf/components/ui/paper";
import { Tape, type TapeProps } from "@/ui/looseleaf/components/ui/tape";
import { useInkScope, useInkSeed } from "@/ui/looseleaf/lib/ink/react";
import { cn } from "@/ui/looseleaf/lib/utils";

type Direction = "top" | "bottom" | "left" | "right";

const DrawerContext = React.createContext<{ direction: Direction; modal: boolean }>({
  direction: "bottom",
  modal: true,
});

function Drawer({
  direction = "bottom",
  modal = true,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  const value = React.useMemo(
    () => ({ direction: direction as Direction, modal }),
    [direction, modal],
  );
  return (
    <DrawerContext.Provider value={value}>
      <DrawerPrimitive.Root data-slot="drawer" direction={direction} modal={modal} {...props} />
    </DrawerContext.Provider>
  );
}

function DrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerPortal({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />;
}

function DrawerClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  const scope = useInkScope();
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      {...scope}
      className={cn(
        "fixed inset-0 z-(--ll-z-overlay) [background:var(--ll-overlay-dim)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

function DrawerContent({
  className,
  children,
  stock = "slip",
  edge,
  tapeKind = "kraft",
  tapeColor,
  seed: seedProp,
  onOpenAutoFocus,
  onPointerDownOutside,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content> &
  Pick<PaperProps, "stock" | "edge" | "seed"> & {
    tapeKind?: TapeProps["kind"];
    tapeColor?: TapeProps["color"];
  }) {
  const scope = useInkScope();
  const { direction, modal } = React.useContext(DrawerContext);
  const seed = useInkSeed(seedProp);
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        asChild
        {...props}
        onOpenAutoFocus={(e) => {
          onOpenAutoFocus?.(e);
          if (modal && !e.defaultPrevented)
            (e.target as HTMLElement | null)?.focus?.({ preventScroll: true });
        }}
        onPointerDownOutside={(e) => {
          onPointerDownOutside?.(e);
          if ((e.target as Element | null)?.closest?.("[data-sonner-toaster]")) e.preventDefault();
        }}
      >
        <Paper
          data-slot="drawer-content"
          stock={stock}
          edge={edge ?? (direction === "bottom" ? { top: "torn" } : "cut")}
          tilt={false}
          rules="none"
          seed={seed}
          {...scope}
          className={cn(
            "group/drawer-content fixed z-(--ll-z-overlay) flex h-auto flex-col text-foreground outline-hidden",
            "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh]",
            "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh] data-[vaul-drawer-direction=bottom]:pb-[env(safe-area-inset-bottom)]",
            "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:sm:max-w-sm",
            "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:sm:max-w-sm",
            className,
          )}
        >
          <Tape
            kind={tapeKind}
            color={tapeColor}
            length={92}
            height={22}
            angle={-1.5}
            seed={`${seed}:grab`}
            className="absolute -top-3 left-1/2 hidden -translate-x-1/2 group-data-[vaul-drawer-direction=bottom]/drawer-content:block"
          />
          {children}
        </Paper>
      </DrawerPrimitive.Content>
    </DrawerPortal>
  );
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 group-data-[vaul-drawer-direction=bottom]/drawer-content:pt-6 group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5 md:text-start",
        className,
      )}
      {...props}
    />
  );
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn(
        "font-script text-[1.7rem] leading-none font-semibold text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
