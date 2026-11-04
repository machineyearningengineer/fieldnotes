"use client";
import { type ReactNode } from "react";
import { Drawer, DrawerContent } from "../ui/looseleaf/components/ui/drawer";
import { useSmallScreen } from "../lib/use-small-screen";
export function SourceSheet({
  open,
  onClose,
  onReturn,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onReturn: () => void;
  children: ReactNode;
}) {
  const mobile = useSmallScreen();
  return (
    <Drawer
      open={open}
      direction={mobile ? "bottom" : "right"}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      shouldScaleBackground={false}
    >
      <DrawerContent
        className="source-panel"
        edge="cut"
        stock="slip"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturn();
        }}
      >
        {mobile && <span className="sheet-handle" aria-hidden="true" />}
        {children}
      </DrawerContent>
    </Drawer>
  );
}

export { DrawerTitle as SourceTitle } from "../ui/looseleaf/components/ui/drawer";
